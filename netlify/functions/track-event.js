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

  const { session_id, type, product_id, meta } = payload;
  if (typeof session_id !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(session_id)) {
    return json(400, { error: "Invalid session_id" });
  }
  if (!ALLOWED_TYPES.has(type)) {
    return json(400, { error: "Invalid event type" });
  }
  if (product_id !== undefined && (typeof product_id !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(product_id))) {
    return json(400, { error: "Invalid product_id" });
  }

  const store = getSessionsStore();
  const now = new Date().toISOString();
  let doc = await store.get(session_id, { type: "json" });
  if (!doc) {
    doc = { session_id, first_seen: now, last_seen: now, events: [], converted_order_id: null, referrer: null, utm: null };
  }
  doc.last_seen = now;

  const ev = { type, product_id: product_id || undefined, ts: now };

  if (type === "view" && meta && !doc.referrer_set) {
    // Only capture how this session *arrived* once — first "view" of the
    // session, not every page reload.
    doc.referrer = typeof meta.referrer === "string" ? meta.referrer.slice(0, 300) : null;
    const utmKeys = ["utm_source", "utm_medium", "utm_campaign"];
    const utm = {};
    let hasUtm = false;
    if (meta.utm && typeof meta.utm === "object") {
      for (const k of utmKeys) {
        if (typeof meta.utm[k] === "string" && meta.utm[k]) { utm[k] = meta.utm[k].slice(0, 100); hasUtm = true; }
      }
    }
    doc.utm = hasUtm ? utm : null;
    doc.referrer_set = true;
  }

  if (type === "checkout_start" && meta && Array.isArray(meta.cart)) {
    ev.cart = meta.cart.slice(0, 30).map(it => ({
      id: typeof it.id === "string" ? it.id.slice(0, 60) : "",
      qty: Number.isFinite(it.qty) ? it.qty : 0
    }));
    ev.cart_value = Number.isFinite(meta.cart_value) ? meta.cart_value : undefined;
  }

  doc.events.push(ev);
  if (doc.events.length > MAX_EVENTS) doc.events = doc.events.slice(-MAX_EVENTS);

  await store.setJSON(session_id, doc);
  return json(200, { ok: true });
};
