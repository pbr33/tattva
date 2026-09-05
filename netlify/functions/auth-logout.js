const { clearCustomerSessionCookie } = require("./lib/auth");

exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json", "Set-Cookie": clearCustomerSessionCookie() },
  body: JSON.stringify({ ok: true })
});
