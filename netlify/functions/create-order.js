const { computeAmountPaise } = require("./lib/pricing");

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

  const receipt = String(payload.receipt || "SOT-" + Date.now().toString(36).toUpperCase()).slice(0, 40);

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
  return json(200, { order_id: order.id, amount: order.amount, currency: order.currency, receipt });
};
