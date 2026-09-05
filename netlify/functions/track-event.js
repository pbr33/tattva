const { getSessionsStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const ALLOWED_TYPES = new Set(["view", "product_view", "add_to_cart", "checkout_start"]);
const MAX_EVENTS = 100;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { session_id, type, product_id } = payload;
  if (typeof session_id !== "string" || session_id.length < 8 || session_id.length > 100) {
    return json(400, { error: "Invalid session_id" });
  }
  if (!ALLOWED_TYPES.has(type)) {
    return json(400, { error: "Invalid event type" });
  }

  const store = getSessionsStore();
  const now = new Date().toISOString();
  let doc = await store.get(session_id, { type: "json" });
  if (!doc) {
    doc = { session_id, first_seen: now, last_seen: now, events: [], converted_order_id: null };
  }
  doc.last_seen = now;
  doc.events.push({ type, product_id: product_id || undefined, ts: now });
  if (doc.events.length > MAX_EVENTS) doc.events = doc.events.slice(-MAX_EVENTS);

  await store.setJSON(session_id, doc);
  return json(200, { ok: true });
};
