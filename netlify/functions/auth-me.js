const { getCustomerFromSession } = require("./lib/auth");
const { getCustomersStore } = require("./lib/blobs");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const phone = getCustomerFromSession(event);
  if (!phone) return json(401, { error: "Not signed in" });

  const customer = await getCustomersStore().get(phone, { type: "json" });
  if (!customer) return json(401, { error: "Not signed in" });

  return json(200, {
    phone: customer.phone,
    name: customer.name || "",
    email: customer.email || "",
    last_address: customer.last_address || null
  });
};
