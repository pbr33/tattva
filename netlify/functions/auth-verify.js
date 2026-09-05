const { verifyIdToken } = require("./lib/firebase-admin");
const { getCustomersStore } = require("./lib/blobs");
const { createCustomerSessionCookie } = require("./lib/auth");

const json = (statusCode, body, extraHeaders) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { id_token } = payload;
  if (typeof id_token !== "string" || !id_token) return json(400, { error: "Missing id_token" });

  let phone, uid;
  try {
    ({ phone, uid } = await verifyIdToken(id_token));
  } catch (e) {
    return json(401, { error: "Could not verify sign-in: " + e.message });
  }

  const store = getCustomersStore();
  const now = new Date().toISOString();
  let customer = await store.get(phone, { type: "json" });
  if (!customer) {
    customer = { phone, firebase_uid: uid, name: "", email: "", last_address: null, created_at: now, updated_at: now };
  } else {
    customer.firebase_uid = uid;
    customer.updated_at = now;
  }
  await store.setJSON(phone, customer);

  return json(200, { ok: true, phone, name: customer.name || "" }, { "Set-Cookie": createCustomerSessionCookie(phone) });
};
