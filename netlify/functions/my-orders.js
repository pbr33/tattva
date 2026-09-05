const { getCustomerFromSession } = require("./lib/auth");
const { getOrdersStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Orders store the checkout-entered phone as a bare 10-digit string;
// Firebase returns E.164 (e.g. "+919876543210"). Compare on the last 10
// digits so a signed-in customer's own orders — placed either before or
// after they created an account — are always found.
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const phone = getCustomerFromSession(event);
  if (!phone) return json(401, { error: "Not signed in" });

  const store = getOrdersStore();
  const { blobs } = await store.list();
  const orders = (
    await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))
  ).filter((o) => o && o.customer && last10(o.customer.phone) === last10(phone));

  orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json(200, { orders });
};
