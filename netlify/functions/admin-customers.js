const { verifyAdminSession } = require("./lib/auth");
const { getOrdersStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const PAID_STATUSES = new Set(["paid", "processing", "shipped", "delivered"]);

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  if (!verifyAdminSession(event)) return json(401, { error: "Not authenticated" });

  const store = getOrdersStore();
  const { blobs } = await store.list();
  const orders = (
    await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))
  ).filter(Boolean);

  // Phone number is the closest thing to a stable customer identity we
  // have — there's no login/account system. Aggregate every order (any
  // status) under it so a customer's full history is visible in one place.
  const byPhone = new Map();
  for (const o of orders) {
    const phone = o.customer && o.customer.phone;
    if (!phone) continue;
    if (!byPhone.has(phone)) {
      byPhone.set(phone, {
        phone,
        name: o.customer.name || "",
        email: o.customer.email || "",
        addresses: new Set(),
        orders: [],
        order_count: 0,
        paid_order_count: 0,
        total_spent: 0,
        first_order_at: o.created_at,
        last_order_at: o.created_at
      });
    }
    const c = byPhone.get(phone);
    // Keep the most recent order's name/email/address as the "current" one
    if (o.created_at >= c.last_order_at) {
      c.name = o.customer.name || c.name;
      c.email = o.customer.email || c.email;
      c.last_order_at = o.created_at;
    }
    if (o.created_at < c.first_order_at) c.first_order_at = o.created_at;
    if (o.customer.city) c.addresses.add(o.customer.city);
    c.orders.push({ oid: o.oid, status: o.status, amount: o.amount, method: o.method, created_at: o.created_at });
    c.order_count += 1;
    if (PAID_STATUSES.has(o.status)) {
      c.paid_order_count += 1;
      c.total_spent += o.amount || 0;
    }
  }

  const customers = Array.from(byPhone.values()).map(c => ({
    ...c,
    addresses: Array.from(c.addresses),
    orders: c.orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }));
  customers.sort((a, b) => (a.last_order_at < b.last_order_at ? 1 : -1));

  return json(200, { customers });
};
