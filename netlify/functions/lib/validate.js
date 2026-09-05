const OID_RE = /^SOT-[A-Za-z0-9]{1,36}$/;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

function isValidOid(oid) {
  return typeof oid === "string" && OID_RE.test(oid);
}

function isValidSessionId(sessionId) {
  return typeof sessionId === "string" && SESSION_ID_RE.test(sessionId);
}

// Trims and length-caps customer fields — bounds storage/abuse. The render
// side (admin.html) is the actual XSS defense; this just keeps stored data
// sane.
function sanitizeCustomer(customer) {
  if (!customer || typeof customer !== "object") return null;
  const cap = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return {
    name: cap(customer.name, 200),
    phone: cap(customer.phone, 20),
    email: cap(customer.email, 200),
    addr: cap(customer.addr, 300),
    city: cap(customer.city, 100),
    pin: cap(customer.pin, 10)
  };
}

function hasRequiredCustomerFields(customer) {
  return !!(customer && customer.name && customer.phone && customer.addr && customer.city && customer.pin);
}

module.exports = { isValidOid, isValidSessionId, sanitizeCustomer, hasRequiredCustomerFields };
