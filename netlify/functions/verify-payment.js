const crypto = require("crypto");
const { getOrdersStore, getSessionsStore, getCustomersStore } = require("./lib/blobs");
const { createShipment } = require("./lib/shiprocket");
const { recordCouponUsage } = require("./lib/coupons");
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

        // Only record coupon usage once payment is actually confirmed —
        // never at order-creation time — so an abandoned cart never
        // consumes a limited-use code.
        if (doc.coupon && doc.customer && doc.customer.phone) {
          try { await recordCouponUsage(doc.coupon.code, doc.customer.phone); } catch { /* best-effort */ }
        }

        // Auto-create the Shiprocket order now that payment is confirmed.
        // This only creates the order (free) — assigning a courier/AWB and
        // scheduling pickup (the step that costs money) stays a manual
        // action in the Shiprocket dashboard. A failure here is logged into
        // the same activity trail but never affects the payment response.
        try {
          const shipment = await createShipment(doc);
          doc.shiprocket = { ...shipment, error: null, created_at: new Date().toISOString() };
          doc.status_history.push({ status: doc.status, note: `Shiprocket order created: ${shipment.order_id}`, ts: new Date().toISOString() });
        } catch (shipErr) {
          doc.shiprocket = { order_id: null, shipment_id: null, error: shipErr.message, created_at: new Date().toISOString() };
          doc.status_history.push({ status: doc.status, note: `Shiprocket order creation failed: ${shipErr.message}`, ts: new Date().toISOString() });
        }

        await orders.setJSON(oid, doc);
        await updateCustomerProfile(event, doc);

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
