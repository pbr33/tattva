const { getOrdersStore, getSessionsStore } = require("./lib/blobs");
const { computeAmountPaise } = require("./lib/pricing");
const { isValidOid, isValidSessionId, sanitizeCustomer, hasRequiredCustomerFields } = require("./lib/validate");

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
  const amount = computeAmountPaise(items);
  if (amount === null) return json(400, { error: "Invalid or empty basket" });
  const customer = sanitizeCustomer(payload.customer);
  if (!hasRequiredCustomerFields(customer)) {
    return json(400, { error: "Missing customer details" });
  }
  const session_id = isValidSessionId(payload.session_id) ? payload.session_id : null;

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
