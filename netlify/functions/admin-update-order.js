const { verifyAdminSession } = require("./lib/auth");
const { getOrdersStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const ALLOWED_STATUSES = new Set([
  "created",
  "whatsapp_pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "return_requested",
  "return_approved",
  "refunded",
  "replacement_requested",
  "replacement_shipped"
]);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { oid, status, note } = payload;
  if (typeof oid !== "string" || !oid) return json(400, { error: "Missing oid" });
  if (!ALLOWED_STATUSES.has(status)) return json(400, { error: "Invalid status" });

  const store = getOrdersStore();
  const doc = await store.get(oid, { type: "json" });
  if (!doc) return json(404, { error: "Order not found" });

  const now = new Date().toISOString();
  doc.status = status;
  doc.status_history.push({ status, note: note ? String(note).slice(0, 500) : undefined, ts: now });
  doc.updated_at = now;
  await store.setJSON(oid, doc);

  return json(200, { ok: true, order: doc });
};
