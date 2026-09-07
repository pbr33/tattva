const { computeBreakdown } = require("./lib/pricing");
const { evaluateCoupon } = require("./lib/coupons");
const { checkRateLimit, rateLimitedResponse } = require("./lib/rate-limit");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const limit = await checkRateLimit(event, { bucket: "validate-coupon", limit: 10, windowSeconds: 5 * 60 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { code, items, phone } = payload;
  if (typeof code !== "string" || !code.trim()) return json(400, { valid: false, reason: "Enter a coupon code" });

  const breakdown = await computeBreakdown(items);
  if (!breakdown) return json(400, { valid: false, reason: "Invalid or empty basket" });

  const phoneDigits = typeof phone === "string" ? phone.replace(/\D/g, "").slice(-10) : "";
  const result = await evaluateCoupon(code, breakdown.sub, phoneDigits || null);

  if (!result.ok) return json(200, { valid: false, reason: result.reason });
  return json(200, { valid: true, discount: result.discount });
};
