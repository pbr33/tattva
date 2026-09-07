const { verifyAdminSession } = require("./lib/auth");
const { getCatalog } = require("./lib/products");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  const products = await getCatalog();
  return json(200, { products });
};
