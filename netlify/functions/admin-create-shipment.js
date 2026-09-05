const { verifyAdminSession } = require("./lib/auth");
const { getOrdersStore } = require("./lib/blobs");
const { createShipment } = require("./lib/shiprocket");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { oid } = payload;
  if (typeof oid !== "string" || !oid) return json(400, { error: "Missing oid" });

  const store = getOrdersStore();
  const doc = await store.get(oid, { type: "json" });
  if (!doc) return json(404, { error: "Order not found" });

  const now = new Date().toISOString();
  try {
    const shipment = await createShipment(doc);
    doc.shiprocket = { ...shipment, error: null, created_at: now };
    doc.status_history.push({ status: doc.status, note: `Shiprocket order created (manual): ${shipment.order_id}`, ts: now });
    doc.updated_at = now;
    await store.setJSON(oid, doc);
    return json(200, { ok: true, order: doc });
  } catch (e) {
    doc.shiprocket = { order_id: null, shipment_id: null, error: e.message, created_at: now };
    doc.status_history.push({ status: doc.status, note: `Shiprocket order creation failed (manual): ${e.message}`, ts: now });
    doc.updated_at = now;
    await store.setJSON(oid, doc);
    return json(502, { error: e.message, order: doc });
  }
};
