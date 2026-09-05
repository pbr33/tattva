const { verifyAdminSession } = require("./lib/auth");
const { getCouponsStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  const store = getCouponsStore();
  const { blobs } = await store.list();
  const coupons = (
    await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))
  ).filter(Boolean);

  coupons.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json(200, { coupons });
};
