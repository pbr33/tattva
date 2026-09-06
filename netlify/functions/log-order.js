const { getOrdersStore, getSessionsStore, getCustomersStore } = require("./lib/blobs");
const { computeBreakdown } = require("./lib/pricing");
const { isValidOid, isValidSessionId, sanitizeCustomer, hasRequiredCustomerFields } = require("./lib/validate");
const { evaluateCoupon, recordCouponUsage, normalizeCode } = require("./lib/coupons");
const { getCustomerFromSession } = require("./lib/auth");

// If this order was placed while signed in, save the freshest name/email/
// address to the account — so checkout keeps auto-filling more accurately
// over time. Best-effort: never blocks order processing if it fails.
async function updateCustomerProfile(event, order) {
  try {
    const sessionPhone = getCustomerFromSession(event);
    if (!sessionPhone || !order.customer) return;
    const store = getCustomersStore();
    const customer = await store.get(sessionPhone, { type: "json" });
    if (!customer) return;
    customer.name = order.customer.name || customer.name;
    customer.email = order.customer.email || customer.email;
    customer.last_address = { addr: order.customer.addr, city: order.customer.city, pin: order.customer.pin };
    customer.updated_at = new Date().toISOString();
    await store.setJSON(sessionPhone, customer);
  } catch {
    // best-effort
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { oid, items } = payload;
  if (!isValidOid(oid)) {
    return json(400, { error: "Invalid order id" });
  }
  const breakdown = computeBreakdown(items);
  if (breakdown === null) return json(400, { error: "Invalid or empty basket" });
  const customer = sanitizeCustomer(payload.customer);
  if (!hasRequiredCustomerFields(customer)) {
    return json(400, { error: "Missing customer details" });
  }
  const session_id = isValidSessionId(payload.session_id) ? payload.session_id : null;

  let discountRupees = 0;
  let appliedCoupon = null;
  if (payload.coupon_code) {
    const result = await evaluateCoupon(payload.coupon_code, breakdown.sub, customer.phone || null);
    if (result.ok) {
      discountRupees = result.discount;
      appliedCoupon = { code: normalizeCode(payload.coupon_code), discount_amount: discountRupees * 100 };
    }
  }
  const amount = Math.max(0, breakdown.sub - discountRupees + breakdown.ship) * 100;

  const now = new Date().toISOString();
  const order = {
    oid,
    razorpay_order_id: null,
    payment_id: null,
    method: "whatsapp",
    items,
    customer,
    amount,
    currency: "INR",
    coupon: appliedCoupon,
    status: "whatsapp_pending",
    status_history: [{
      status: "whatsapp_pending",
      note: appliedCoupon ? `Order sent via WhatsApp, awaiting manual confirmation · Coupon ${appliedCoupon.code} applied (-₹${discountRupees})` : "Order sent via WhatsApp, awaiting manual confirmation",
      ts: now
    }],
    created_at: now,
    updated_at: now
  };

  const store = getOrdersStore();

  // Order IDs are effectively public (shown to the customer, sent over
  // WhatsApp) so they must never double as an access-control token. Refuse
  // to write over an id that's already in use rather than silently
  // overwriting someone else's order — this is a fire-and-forget call from
  // the client, so a rejection here just means no internal record was
  // created; the WhatsApp message itself (sent separately) still carries
  // the full order details.
  const existing = await store.get(oid, { type: "json" });
  if (existing) {
    return json(409, { error: "Order id already in use — please try again" });
  }

  await store.setJSON(oid, order);
  await updateCustomerProfile(event, order);

  if (appliedCoupon) {
    try { await recordCouponUsage(appliedCoupon.code, customer.phone); } catch { /* best-effort */ }
  }

  if (session_id) {
    const sessions = getSessionsStore();
    const sdoc = await sessions.get(session_id, { type: "json" });
    if (sdoc) {
      sdoc.converted_order_id = oid;
      sdoc.last_seen = now;
      await sessions.setJSON(session_id, sdoc);
    }
  }

  return json(200, { ok: true, oid });
};
