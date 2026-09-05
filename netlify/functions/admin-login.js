const crypto = require("crypto");
const { createSessionCookie } = require("./lib/auth");

const json = (statusCode, body, extraHeaders) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || !process.env.ADMIN_SESSION_SECRET) {
    return json(500, { error: "Admin login is not configured on the server" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const given = String(payload.password || "");
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(adminPassword, "utf8");
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) return json(401, { error: "Incorrect password" });

  return json(200, { ok: true }, { "Set-Cookie": createSessionCookie() });
};
