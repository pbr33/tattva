const { verifyAdminSession } = require("./lib/auth");
const { isKnownProduct, saveProductOverride } = require("./lib/products");

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

  const { id, price, stock } = payload;
  if (typeof id !== "string" || !isKnownProduct(id)) return json(400, { error: "Unknown product id" });

  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) return json(400, { error: "Invalid price" });

  // Blank/null/undefined stock means "untracked" (unlimited, current
  // behaviour) — a non-negative integer turns on hard-cap enforcement for
  // just this product.
  let stockValue = null;
  if (stock !== undefined && stock !== null && stock !== "") {
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) return json(400, { error: "Invalid stock — must be a non-negative whole number, or blank for unlimited" });
    stockValue = stockNum;
  }

  const product = await saveProductOverride(id, { price: Math.round(priceNum), stock: stockValue });
  return json(200, { ok: true, product });
};
