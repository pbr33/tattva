const { computeAmountPaise } = require("./lib/pricing");
const { getOrdersStore } = require("./lib/blobs");
const { isValidOid, sanitizeCustomer } = require("./lib/validate");

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
  const amount = computeAmountPaise(payload.items);
  if (amount === null || amount < 100) {
    return json(400, { error: "Invalid or empty basket" });
  }

  let receipt = "SOT-" + Date.now().toString(36).toUpperCase();
  if (payload.receipt !== undefined) {
    if (!isValidOid(payload.receipt)) return json(400, { error: "Invalid receipt" });
    receipt = payload.receipt;
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
    await getOrdersStore().setJSON(receipt, {
      oid: receipt,
      razorpay_order_id: order.id,
      payment_id: null,
      method: "razorpay",
      items: payload.items,
      customer: sanitizeCustomer(payload.customer),
      amount: order.amount,
      currency: order.currency,
      status: "created",
      status_history: [{ status: "created", note: "Razorpay order created, awaiting payment", ts: now }],
      created_at: now,
      updated_at: now
    });
  } catch {
    // tracking is best-effort; payment integrity does not depend on it
  }

  return json(200, { order_id: order.id, amount: order.amount, currency: order.currency, receipt });
};
