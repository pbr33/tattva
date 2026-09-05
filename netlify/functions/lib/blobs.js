const { getStore } = require("@netlify/blobs");

// Automatic environment injection for Netlify Blobs isn't landing in this
// deploy (a documented rough edge with some function bundling setups), so
// we fall back to explicit credentials — a scoped site ID + the account
// auth token, both stored only as Netlify env vars, never in the repo.
function storeOptions(name) {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  return siteID && token
    ? { name, consistency: "strong", siteID, token }
    : { name, consistency: "strong" };
}

const getOrdersStore = () => getStore(storeOptions("orders"));
const getSessionsStore = () => getStore(storeOptions("sessions"));
const getSupportStore = () => getStore(storeOptions("support"));
const getMiscStore = () => getStore(storeOptions("misc")); // small system-level values (e.g. cached third-party tokens)
const getCouponsStore = () => getStore(storeOptions("coupons"));

module.exports = { getOrdersStore, getSessionsStore, getSupportStore, getMiscStore, getCouponsStore };
