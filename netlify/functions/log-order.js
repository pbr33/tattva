const { getOrdersStore, getSessionsStore } = require("./lib/blobs");
const { computeAmountPaise } = require("./lib/pricing");

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

  const { oid, items, customer, session_id } = payload;
  if (typeof oid !== "string" || !oid.startsWith("SOT-")) {
    return json(400, { error: "Invalid order id" });
  }
  const amount = computeAmountPaise(items);
  if (amount === null) return json(400, { error: "Invalid or empty basket" });
  if (!customer || !customer.name || !customer.phone || !customer.addr || !customer.city || !customer.pin) {
    return json(400, { error: "Missing customer details" });
  }

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
    status: "whatsapp_pending",
    status_history: [{ status: "whatsapp_pending", note: "Order sent via WhatsApp, awaiting manual confirmation", ts: now }],
    created_at: now,
    updated_at: now
  };

  const store = getOrdersStore();
  await store.setJSON(oid, order);

  if (typeof session_id === "string" && session_id.length >= 8) {
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
