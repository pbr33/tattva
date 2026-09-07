const { computeBreakdown } = require("./lib/pricing");
const { getOrdersStore } = require("./lib/blobs");
const { isValidOid, sanitizeCustomer } = require("./lib/validate");
const { evaluateCoupon, normalizeCode } = require("./lib/coupons");
const { checkStockAvailable } = require("./lib/products");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return json(500, { error: "Razorpay is not configured on the server" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Amount is computed here from server-side prices — the client sends only
  // item ids/quantities, never a trusted amount. This is what stops someone
  // from tampering with the price via devtools before paying.
  const breakdown = await computeBreakdown(payload.items);
  if (breakdown === null) {
    return json(400, { error: "Invalid or empty basket" });
  }

  // Advisory only — rejects an obviously-oversold checkout before the
  // customer pays. Stock isn't actually reserved until payment is verified
  // (verify-payment.js), so this doesn't guarantee availability by itself.
  const stockCheck = await checkStockAvailable(payload.items);
  if (!stockCheck.ok) {
    return json(409, { error: "Sorry, an item in your basket just sold out", items: stockCheck.failed });
  }

  const customer = sanitizeCustomer(payload.customer);
  const phone = customer ? customer.phone : "";

  // Coupon discount, computed the same way validate-coupon.js does, so a
  // client can never apply a discount amount of its own choosing — only a
  // real coupon code the server independently evaluates.
  let discountRupees = 0;
  let appliedCoupon = null;
  if (payload.coupon_code) {
    const result = await evaluateCoupon(payload.coupon_code, breakdown.sub, phone || null);
    if (result.ok) {
      discountRupees = result.discount;
      appliedCoupon = { code: normalizeCode(payload.coupon_code), discount_amount: discountRupees * 100 };
    }
    // An invalid/expired coupon at this point is silently ignored rather
    // than failing the order — the checkout UI already validated it live,
    // so this only matters if something changed between "Apply" and
    // "Place Order" (e.g. the coupon was just deactivated).
  }

  const amount = Math.max(0, breakdown.sub - discountRupees + breakdown.ship) * 100;
  if (amount < 100) {
    return json(400, { error: "Order amount too low" });
  }

  let receipt = "SOT-" + Date.now().toString(36).toUpperCase();
  if (payload.receipt !== undefined) {
    if (!isValidOid(payload.receipt)) return json(400, { error: "Invalid receipt" });
    receipt = payload.receipt;
  }

  // Order IDs are effectively public (shown to the customer, sent over
  // WhatsApp, embedded in Razorpay notes) so they must never double as an
  // access-control token. Refuse to create an order under an id that's
  // already in use rather than silently overwriting someone else's order.
  const ordersStore = getOrdersStore();
  const existing = await ordersStore.get(receipt, { type: "json" });
  if (existing) {
    return json(409, { error: "Order id already in use — please try again" });
  }

  let rzpRes;
  try {
    rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64")
      },
      body: JSON.stringify({ amount, currency: "INR", receipt })
    });
  } catch {
    return json(500, { error: "Could not reach Razorpay" });
  }

  if (rzpRes.status === 401) {
    return json(401, { error: "Razorpay authentication failed" });
  }
  if (!rzpRes.ok) {
    return json(500, { error: "Razorpay order creation failed" });
  }

  const order = await rzpRes.json();

  // Persist the order intent now (status "created") so it's tracked even if
  // the customer abandons before paying — verify-payment.js flips this to
  // "paid" once the signature checks out. Never blocks the payment flow if
  // this write fails for some reason.
  try {
    const now = new Date().toISOString();
    await ordersStore.setJSON(receipt, {
      oid: receipt,
      razorpay_order_id: order.id,
      payment_id: null,
      method: "razorpay",
      items: payload.items,
      customer,
      amount: order.amount,
      currency: order.currency,
      coupon: appliedCoupon,
      status: "created",
      status_history: [{
        status: "created",
        note: appliedCoupon ? `Razorpay order created, awaiting payment · Coupon ${appliedCoupon.code} applied (-₹${discountRupees})` : "Razorpay order created, awaiting payment",
        ts: now
      }],
      created_at: now,
      updated_at: now
    });
  } catch {
    // tracking is best-effort; payment integrity does not depend on it
  }

  return json(200, { order_id: order.id, amount: order.amount, currency: order.currency, receipt });
};
