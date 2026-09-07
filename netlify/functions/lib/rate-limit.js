const { getRateLimitStore } = require("./blobs");

function getClientIp(event) {
  const headers = event.headers || {};
  // Set by Netlify's edge and not attacker-controlled, unlike X-Forwarded-For.
  const nf = headers["x-nf-client-connection-ip"] || headers["X-NF-Client-Connection-IP"];
  if (nf) return nf;
  const fwd = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

// Fixed-window per-IP throttle backed by Netlify Blobs (strong consistency),
// so counts are shared across function invocations/instances. One blob per
// (bucket, ip) — the window resets in place rather than accumulating a new
// key per window, so storage doesn't grow unbounded over time.
async function checkRateLimit(event, { bucket, limit, windowSeconds }) {
  const ip = getClientIp(event);
  const store = getRateLimitStore();
  const key = `${bucket}:${ip}`;
  const windowMs = windowSeconds * 1000;
  const now = Date.now();

  const existing = await store.get(key, { type: "json" });
  const inWindow = !!existing && (now - existing.windowStart) < windowMs;
  const count = inWindow ? existing.count : 0;

  if (count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.windowStart + windowMs - now) / 1000));
    return { allowed: false, retryAfter };
  }

  await store.setJSON(key, { windowStart: inWindow ? existing.windowStart : now, count: count + 1 });
  return { allowed: true };
}

function rateLimitedResponse(retryAfter) {
  return {
    statusCode: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
    body: JSON.stringify({ error: "Too many requests. Please try again later." })
  };
}

module.exports = { checkRateLimit, rateLimitedResponse, getClientIp };
