const { verifyAdminSession } = require("./lib/auth");
const { getMiscStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const KEY = "financial_settings";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);
  const settings = {
    razorpay_fee_pct: num(payload.razorpay_fee_pct, 2),
    default_packaging_cost: num(payload.default_packaging_cost, 15),
    default_shipping_cost: num(payload.default_shipping_cost, 45),
    updated_at: new Date().toISOString()
  };

  await getMiscStore().setJSON(KEY, settings);
  return json(200, { ok: true, settings });
};
