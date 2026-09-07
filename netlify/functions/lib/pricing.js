const { getPriceMap } = require("./products");

const FREE_SHIP_ABOVE = 999;
const SHIP_FLAT = 79;
const MAX_QTY_PER_ITEM = 20;

// items: [{id, qty}, ...] as sent by the client. Returns null if invalid,
// otherwise {sub, ship} in rupees — shipping is always evaluated against
// the pre-discount subtotal, so a coupon can never be used to game free
// shipping. Prices come from the live (admin-editable) catalog, never from
// anything the client sends — this is what stops price tampering.
async function computeBreakdown(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const prices = await getPriceMap();
  let sub = 0;
  for (const it of items) {
    const price = prices[it && it.id];
    const qty = Number(it && it.qty);
    if (price === undefined || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
      return null;
    }
    sub += price * qty;
  }
  const ship = sub === 0 ? 0 : (sub >= FREE_SHIP_ABOVE ? 0 : SHIP_FLAT);
  return { sub, ship };
}

// items: [{id, qty}, ...] as sent by the client. Returns null if invalid.
async function computeAmountPaise(items) {
  const b = await computeBreakdown(items);
  return b === null ? null : (b.sub + b.ship) * 100;
}

module.exports = { FREE_SHIP_ABOVE, SHIP_FLAT, computeBreakdown, computeAmountPaise };
