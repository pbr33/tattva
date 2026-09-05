const { verifyAdminSession } = require("./lib/auth");
const { getSupportStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const ALLOWED_STATUSES = new Set(["open", "escalated", "closed"]);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { session_id, status } = payload;
  if (typeof session_id !== "string" || !session_id) return json(400, { error: "Missing session_id" });
  if (!ALLOWED_STATUSES.has(status)) return json(400, { error: "Invalid status" });

  const store = getSupportStore();
  const doc = await store.get(session_id, { type: "json" });
  if (!doc) return json(404, { error: "Conversation not found" });

  doc.status = status;
  doc.updated_at = new Date().toISOString();
  await store.setJSON(session_id, doc);

  return json(200, { ok: true, conversation: doc });
};
