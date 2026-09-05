const { getOrdersStore, getSessionsStore } = require("./lib/blobs");
const { computeBreakdown } = require("./lib/pricing");
const { isValidOid, isValidSessionId, sanitizeCustomer, hasRequiredCustomerFields } = require("./lib/validate");
const { evaluateCoupon, recordCouponUsage, normalizeCode } = require("./lib/coupons");

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
  await store.setJSON(oid, order);

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
