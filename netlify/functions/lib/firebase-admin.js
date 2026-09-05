const admin = require("firebase-admin");

let app = null;

function getApp() {
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured on the server");
  let serviceAccount;
  try {
    // Accept either raw JSON or base64-encoded JSON in the env var — base64
    // is friendlier to paste into a single-line env var UI without escaping.
    serviceAccount = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON (or valid base64-encoded JSON)");
  }
  app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return app;
}

// Verifies a Firebase ID token server-side — this is the only trusted source
// of a customer's phone number. The client sends this token after Firebase
// confirms the OTP; we never accept a phone number the client asserts
// directly, same principle as every other server-side-truth check in this app.
async function verifyIdToken(idToken) {
  const a = getApp();
  const decoded = await admin.auth(a).verifyIdToken(idToken);
  if (!decoded.phone_number) throw new Error("Token has no verified phone number");
  return { phone: decoded.phone_number, uid: decoded.uid };
}

module.exports = { verifyIdToken };
