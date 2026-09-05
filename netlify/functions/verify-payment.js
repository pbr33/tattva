const crypto = require("crypto");
const { getOrdersStore, getSessionsStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return json(500, { error: "Razorpay is not configured on the server" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, oid, session_id } = payload;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return json(400, { error: "Missing required fields" });
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(razorpay_signature), "utf8");
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) {
    return json(400, { verified: false, error: "Signature mismatch" });
  }

  // Payment is verified regardless of what happens below — order tracking is
  // best-effort and must never be able to turn a genuinely verified payment
  // into a failure response.
  if (typeof oid === "string") {
    try {
      const orders = getOrdersStore();
      const doc = await orders.get(oid, { type: "json" });
      if (doc) {
        const now = new Date().toISOString();
        doc.payment_id = razorpay_payment_id;
        doc.razorpay_order_id = razorpay_order_id;
        doc.status = "paid";
        doc.status_history.push({ status: "paid", note: "Payment verified", ts: now });
        doc.updated_at = now;
        await orders.setJSON(oid, doc);

        if (typeof session_id === "string" && session_id.length >= 8) {
          const sessions = getSessionsStore();
          const sdoc = await sessions.get(session_id, { type: "json" });
          if (sdoc) {
            sdoc.converted_order_id = oid;
            sdoc.last_seen = now;
            await sessions.setJSON(session_id, sdoc);
          }
        }
      }
    } catch {
      // ignore — see comment above
    }
  }

  return json(200, { verified: true, payment_id: razorpay_payment_id, order_id: razorpay_order_id });
};
