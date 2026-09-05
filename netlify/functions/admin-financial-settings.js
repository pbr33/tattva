const { verifyAdminSession } = require("./lib/auth");
const { getMiscStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const KEY = "financial_settings";
const DEFAULTS = { razorpay_fee_pct: 2, default_packaging_cost: 15, default_shipping_cost: 45 };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  const store = getMiscStore();
  const settings = await store.get(KEY, { type: "json" });
  return json(200, { settings: settings || DEFAULTS });
};
