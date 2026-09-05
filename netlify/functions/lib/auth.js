const crypto = require("crypto");

const COOKIE_NAME = "admin_session";
const SESSION_HOURS = 8;

function sign(payloadB64) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

function createSessionCookie() {
  const payload = { exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${payloadB64}.${sign(payloadB64)}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function parseCookies(event) {
  const header = (event.headers && (event.headers.cookie || event.headers.Cookie)) || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function verifyAdminSession(event) {
  if (!process.env.ADMIN_SESSION_SECRET) return false;
  const cookies = parseCookies(event);
  const token = cookies[COOKIE_NAME];
  if (!token || !token.includes(".")) return false;
  const [payloadB64, sig] = token.split(".");
  const expected = sign(payloadB64);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig || "", "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

module.exports = { createSessionCookie, clearSessionCookie, verifyAdminSession };
