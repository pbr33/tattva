const { getMiscStore } = require("./blobs");

const BASE = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_KEY = "shiprocket_token";
const TOKEN_SOFT_TTL_MS = 9 * 24 * 60 * 60 * 1000; // Shiprocket tokens last 10 days; refresh a day early

// Every product in the catalog is a small devotional item (mala, rudraksha,
// bracelet, small yantra). Shiprocket requires per-item weight/dimensions
// that PRODUCTS doesn't track — this single generous default covers any one
// item or small combo safely. Revisit with real per-product weights once
// real shipments show what's accurate.
const DEFAULT_PACKAGE = { length: 15, breadth: 12, height: 5, weight: 0.3 };

async function getToken() {
  const store = getMiscStore();
  const cached = await store.get(TOKEN_KEY, { type: "json" });
  if (cached && cached.fetched_at && Date.now() - cached.fetched_at < TOKEN_SOFT_TTL_MS) {
    return cached.token;
  }

  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new Error("Shiprocket is not configured on the server");

  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`Shiprocket auth failed (${res.status})`);
  const data = await res.json();
  if (!data.token) throw new Error("Shiprocket auth response had no token");

  await store.setJSON(TOKEN_KEY, { token: data.token, fetched_at: Date.now() });
  return data.token;
}

function splitName(fullName) {
  const parts = String(fullName || "Customer").trim().split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(" ") || parts[0] };
}

// Our checkout form never collects "state", but Shiprocket requires it.
// India's PIN codes map deterministically to a state/district via the
// public, government-backed India Post lookup — no new checkout field, no
// mapping table to maintain ourselves.
async function pincodeToState(pin) {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(pin)}`);
    const data = await res.json();
    const state = data && data[0] && data[0].Status === "Success" && data[0].PostOffice && data[0].PostOffice[0] && data[0].PostOffice[0].State;
    return state || null;
  } catch {
    return null;
  }
}

// order: our internal order doc (oid, items[{id,name,qty,price}], customer{name,phone,email,addr,city,pin}, amount)
async function createShipment(order) {
  const pickup_location = process.env.SHIPROCKET_PICKUP_LOCATION;
  if (!pickup_location) throw new Error("SHIPROCKET_PICKUP_LOCATION is not configured");

  const token = await getToken();
  const { first, last } = splitName(order.customer && order.customer.name);
  const subTotal = (order.amount || 0) / 100;
  const state = (await pincodeToState(order.customer.pin)) || order.customer.city;

  const payload = {
    order_id: order.oid,
    order_date: new Date(order.created_at || Date.now()).toISOString().slice(0, 16).replace("T", " "),
    pickup_location,
    billing_customer_name: first,
    billing_last_name: last,
    billing_address: order.customer.addr,
    billing_city: order.customer.city,
    billing_pincode: order.customer.pin,
    billing_state: state,
    billing_country: "India",
    billing_email: order.customer.email || "orders@shriomtattva.com",
    billing_phone: String(order.customer.phone || "").replace(/\D/g, "").slice(-10),
    shipping_is_billing: true,
    order_items: (order.items || []).map(it => ({
      name: it.name || it.id,
      sku: it.id,
      units: it.qty,
      selling_price: it.price || Math.round(subTotal / Math.max(1, (order.items || []).length))
    })),
    payment_method: "Prepaid",
    sub_total: subTotal,
    length: DEFAULT_PACKAGE.length,
    breadth: DEFAULT_PACKAGE.breadth,
    height: DEFAULT_PACKAGE.height,
    weight: DEFAULT_PACKAGE.weight
  };

  const res = await fetch(`${BASE}/orders/create/adhoc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data && (data.message || JSON.stringify(data.errors || data));
    throw new Error(`Shiprocket order creation failed: ${detail || res.status}`);
  }

  return { order_id: data.order_id, shipment_id: data.shipment_id, status: data.status };
}

async function cancelShipment(shiprocketOrderId) {
  const token = await getToken();
  const res = await fetch(`${BASE}/orders/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: [shiprocketOrderId] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shiprocket cancel failed: ${data.message || res.status}`);
  return data;
}

module.exports = { createShipment, cancelShipment, getToken };
