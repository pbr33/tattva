const { getCatalog } = require("./lib/products");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Public, unauthenticated — the storefront reads this on load to pick up
// admin-edited prices/stock without needing a code deploy. Name/cat/images
// stay static in index.html; only price and stock are dynamic here.
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const catalog = await getCatalog();
  const products = catalog.map((p) => ({ id: p.id, price: p.price, stock: p.stock }));
  return json(200, { products });
};
