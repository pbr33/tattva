/* Server-side authoritative prices — mirrors the `price` field of PRODUCTS
   in index.html. This is the single thing an attacker cannot tamper with
   from the browser: create-order.js computes the charged amount from this
   table plus the item ids/quantities the client sends, never from a raw
   amount the client provides. Keep this list in sync with PRODUCTS whenever
   prices or the catalog change. */
const PRICES = {
  "rud-black": 351,
  "rud-red": 351,
  "rud-jaap": 751,
  "rud-pack": 1251,
  "mala-silver": 1100,
  "mala-copper": 951,
  "sphatik": 551,
  "vaijanti": 451,
  "tulsi": 351,
  "haldi": 451,
  "amethyst": 451,
  "chakra7": 451,
  "lapis": 551,
  "yantra-multi": 2100,
  "yantra-gold": 1551,
  "yantra-copper": 1251,
  "yantra-sudarshan": 1351,
  "kalava": 151,
  "potli": 121
};

const FREE_SHIP_ABOVE = 999;
const SHIP_FLAT = 79;
const MAX_QTY_PER_ITEM = 20;

// items: [{id, qty}, ...] as sent by the client. Returns null if invalid,
// otherwise {sub, ship} in rupees — shipping is always evaluated against
// the pre-discount subtotal, so a coupon can never be used to game free
// shipping.
function computeBreakdown(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let sub = 0;
  for (const it of items) {
    const price = PRICES[it && it.id];
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
function computeAmountPaise(items) {
  const b = computeBreakdown(items);
  return b === null ? null : (b.sub + b.ship) * 100;
}

module.exports = { PRICES, FREE_SHIP_ABOVE, SHIP_FLAT, computeBreakdown, computeAmountPaise };
