const { verifyAdminSession } = require("./lib/auth");
const { getCouponsStore } = require("./lib/blobs");
const { normalizeCode } = require("./lib/coupons");

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

  const code = normalizeCode(payload.code);
  if (!code || !/^[A-Z0-9_-]{2,30}$/.test(code)) return json(400, { error: "Invalid coupon code" });
  if (!["percent", "flat"].includes(payload.type)) return json(400, { error: "Type must be 'percent' or 'flat'" });
  const value = Number(payload.value);
  if (!Number.isFinite(value) || value <= 0) return json(400, { error: "Invalid discount value" });
  if (payload.type === "percent" && value > 100) return json(400, { error: "Percent discount can't exceed 100" });

  const store = getCouponsStore();
  const existing = await store.get(code, { type: "json" });
  const now = new Date().toISOString();

  const toIntOrNull = (v) => (v === undefined || v === null || v === "" ? null : Math.max(0, Math.round(Number(v))));

  const coupon = {
    code,
    type: payload.type,
    value,
    min_order: toIntOrNull(payload.min_order) || 0,
    max_discount: toIntOrNull(payload.max_discount),
    new_user_only: !!payload.new_user_only,
    active: payload.active === undefined ? true : !!payload.active,
    usage_limit: toIntOrNull(payload.usage_limit),
    per_user_limit: payload.per_user_limit === undefined ? (existing ? existing.per_user_limit : 1) : toIntOrNull(payload.per_user_limit),
    expires_at: payload.expires_at || null,
    used_count: existing ? existing.used_count || 0 : 0,
    used_by: existing ? existing.used_by || [] : [],
    created_at: existing ? existing.created_at : now,
    updated_at: now
  };

  await store.setJSON(code, coupon);
  return json(200, { ok: true, coupon });
};
