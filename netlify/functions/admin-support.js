const { verifyAdminSession } = require("./lib/auth");
const { getSupportStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  const store = getSupportStore();
  const { blobs } = await store.list();
  const conversations = (
    await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))
  ).filter(Boolean);

  conversations.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return json(200, { conversations });
};
