const { verifyAdminSession } = require("./lib/auth");
const { getOrdersStore } = require("./lib/blobs");
const { releaseStock } = require("./lib/products");

const RESTOCK_STATUSES = new Set(["cancelled", "refunded", "return_approved"]);

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

  const { oid, status, note, tracking_number, courier, refund_amount, packaging_cost, shipping_cost } = payload;
  if (typeof oid !== "string" || !oid) return json(400, { error: "Missing oid" });
  if (!ALLOWED_STATUSES.has(status)) return json(400, { error: "Invalid status" });

  const store = getOrdersStore();
  const doc = await store.get(oid, { type: "json" });
  if (!doc) return json(404, { error: "Order not found" });

  const now = new Date().toISOString();
  doc.status = status;

  const noteParts = [];
  if (note) noteParts.push(String(note).slice(0, 500));

  if (typeof tracking_number === "string" && tracking_number.trim()) {
    doc.tracking_number = tracking_number.trim().slice(0, 60);
    noteParts.push(`Tracking #: ${doc.tracking_number}`);
  }
  if (typeof courier === "string" && courier.trim()) {
    doc.courier = courier.trim().slice(0, 60);
    noteParts.push(`Courier: ${doc.courier}`);
  }
  if (status === "refunded" && refund_amount !== undefined && refund_amount !== null && refund_amount !== "") {
    const amt = Number(refund_amount);
    if (!Number.isFinite(amt) || amt < 0) return json(400, { error: "Invalid refund_amount" });
    doc.refund_amount = Math.round(amt * 100); // stored in paise, same unit as `amount`
    noteParts.push(`Refund amount: ₹${amt}`);
  }
  if (packaging_cost !== undefined && packaging_cost !== null && packaging_cost !== "") {
    const amt = Number(packaging_cost);
    if (!Number.isFinite(amt) || amt < 0) return json(400, { error: "Invalid packaging_cost" });
    doc.packaging_cost = Math.round(amt * 100); // paise
  }
  if (shipping_cost !== undefined && shipping_cost !== null && shipping_cost !== "") {
    const amt = Number(shipping_cost);
    if (!Number.isFinite(amt) || amt < 0) return json(400, { error: "Invalid shipping_cost" });
    doc.shipping_cost = Math.round(amt * 100); // paise
  }

  // Release reserved stock back when an order that actually had it reserved
  // (whatsapp_pending or paid — see log-order.js/verify-payment.js) is
  // cancelled/refunded/returned. Guarded by stock_released so re-saving the
  // same terminal status twice (or cancelled -> refunded) never double-frees
  // it. An order that never got past "created" (abandoned Razorpay checkout)
  // never reserved anything, so this is correctly a no-op for those.
  if (RESTOCK_STATUSES.has(status) && doc.stock_reserved && !doc.stock_released) {
    try {
      await releaseStock(doc.items);
      doc.stock_released = true;
      noteParts.push("Stock released back to inventory");
    } catch {
      // best-effort — never blocks the order status update
    }
  }

  doc.status_history.push({ status, note: noteParts.length ? noteParts.join(" · ") : undefined, ts: now });
  doc.updated_at = now;
  await store.setJSON(oid, doc);

  return json(200, { ok: true, order: doc });
};
