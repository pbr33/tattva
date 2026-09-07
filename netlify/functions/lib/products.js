const { getProductsStore } = require("./blobs");

// Base catalog (id, name, category, default price) — mirrors PRODUCTS in
// index.html. Admin-set overrides (price and/or stock) live in the products
// Blobs store, keyed by id; a missing override, or a null field within one,
// falls back to these defaults. Name/cat/images/descriptions stay static in
// index.html — only price and stock are admin-editable at runtime.
const DEFAULT_CATALOG = [
  { id: "rud-black", name: "Panchmukhi Rudraksha Kavacha — Black Thread", cat: "Rudraksha", price: 351 },
  { id: "rud-red", name: "Panchmukhi Rudraksha Kavacha — Maroon Thread", cat: "Rudraksha", price: 351 },
  { id: "rud-jaap", name: "Rudraksha Jaap Mala — 108 Beads, Red Tassel", cat: "Rudraksha", price: 751 },
  { id: "rud-pack", name: "Rudraksh Mala — Lab-Certified, Sealed Pack", cat: "Rudraksha", price: 1251 },
  { id: "mala-silver", name: "Karungali Mala — Silver-Capped, 54 Beads", cat: "Malas", price: 1100 },
  { id: "mala-copper", name: "Karungali Mala — Copper-Linked, 54 Beads", cat: "Malas", price: 951 },
  { id: "sphatik", name: "Sphatik Jaap Mala — 108 Faceted Crystal Beads", cat: "Malas", price: 551 },
  { id: "vaijanti", name: "Vaijanti Mala — 108 Beads, Lab-Certified", cat: "Malas", price: 451 },
  { id: "tulsi", name: "Tulsi Mala — Lab-Certified, Premium", cat: "Malas", price: 351 },
  { id: "haldi", name: "Haldi Mala — Pure Turmeric Beads", cat: "Malas", price: 451 },
  { id: "amethyst", name: "Amethyst Bracelet — AAA+ Premium", cat: "Bracelets", price: 451 },
  { id: "chakra7", name: "7 Chakra Bracelet — Lab-Certified", cat: "Bracelets", price: 451 },
  { id: "lapis", name: "Lapis Lazuli Bracelet — AAA+ Premium", cat: "Bracelets", price: 551 },
  { id: "yantra-multi", name: "Sampoorna Yantra — Six-in-One Copper Frame", cat: "Yantras", price: 2100 },
  { id: "yantra-gold", name: "Shri Yantra — Gold-Finish, Framed", cat: "Yantras", price: 1551 },
  { id: "yantra-copper", name: "Maha Yantra — Copper Embossed, Framed", cat: "Yantras", price: 1251 },
  { id: "yantra-sudarshan", name: "Sudarshana Yantra — Copper Embossed, Framed", cat: "Yantras", price: 1351 },
  { id: "kalava", name: "Pila Kalava — Sacred Yellow Thread (Pinda)", cat: "Sacred Threads", price: 151 },
  { id: "potli", name: "Mayur Potli — Golden Offering Pouch", cat: "Puja Essentials", price: 121 }
];

const DEFAULT_BY_ID = new Map(DEFAULT_CATALOG.map((p) => [p.id, p]));

function isKnownProduct(id) {
  return DEFAULT_BY_ID.has(id);
}

// Merges admin overrides (price and/or stock) on top of the static catalog.
// stock is null/absent for every product until an admin sets a number on it
// — untracked products behave exactly as before (always available); setting
// a number turns on hard-cap enforcement for that one product only.
async function getCatalog() {
  const store = getProductsStore();
  const { blobs } = await store.list();
  const overrides = new Map(
    (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean).map((o) => [o.id, o])
  );

  return DEFAULT_CATALOG.map((base) => {
    const override = overrides.get(base.id);
    return {
      id: base.id,
      name: base.name,
      cat: base.cat,
      price: override && override.price != null ? override.price : base.price,
      stock: override && override.stock != null ? override.stock : null
    };
  });
}

async function getPriceMap() {
  const catalog = await getCatalog();
  const map = {};
  for (const p of catalog) map[p.id] = p.price;
  return map;
}

async function saveProductOverride(id, { price, stock }) {
  if (!isKnownProduct(id)) throw new Error("Unknown product id");
  const store = getProductsStore();
  const existing = await store.get(id, { type: "json" });
  const override = {
    id,
    price: price != null ? price : (existing ? existing.price : null),
    stock: stock === undefined ? (existing ? existing.stock : null) : stock,
    updated_at: new Date().toISOString()
  };
  await store.setJSON(id, override);
  const base = DEFAULT_BY_ID.get(id);
  return { id, name: base.name, cat: base.cat, price: override.price != null ? override.price : base.price, stock: override.stock };
}

const ADJUST_MAX_ATTEMPTS = 20;

// Compare-and-swap stock adjustment, same pattern as recordCouponUsage in
// coupons.js: read with etag, write with onlyIfMatch, retry with jittered
// backoff on a lost race. A product with no override doc, or one whose
// stock is null, is untracked — adjustments on it are a no-op success so
// untracked products stay "always in stock" with zero extra writes.
// requireAvailable:true refuses to go below zero (returns ok:false instead).
async function adjustStock(id, delta, { requireAvailable }) {
  if (delta === 0) return { ok: true };
  const store = getProductsStore();

  for (let attempt = 0; attempt < ADJUST_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 25 * attempt));
    }

    const current = await store.getWithMetadata(id, { type: "json" });
    const doc = current ? current.data : null;
    if (!doc || doc.stock == null) return { ok: true }; // untracked

    const nextStock = doc.stock + delta;
    if (requireAvailable && nextStock < 0) {
      return { ok: false, available: doc.stock };
    }

    // doc (and therefore current) is guaranteed non-null here — the early
    // return above already handled the "no doc / untracked" case.
    const updated = { ...doc, stock: nextStock, updated_at: new Date().toISOString() };
    const result = await store.setJSON(id, updated, { onlyIfMatch: current.etag });
    if (result.modified) return { ok: true, stock: nextStock };
    // Lost the race (someone else wrote first, or the doc was created in
    // between) — loop and retry against the fresh value.
  }

  console.error(`adjustStock: gave up after ${ADJUST_MAX_ATTEMPTS} attempts for product ${id}`);
  return { ok: false, available: null };
}

// Read-only advisory check (no writes) — used to reject an obviously
// oversold checkout before Razorpay payment starts. Not itself the
// enforcement point; reserveStock/forceReserveStock are.
async function checkStockAvailable(items) {
  const store = getProductsStore();
  const failed = [];
  for (const it of items) {
    const doc = await store.get(it.id, { type: "json" });
    if (doc && doc.stock != null && doc.stock < it.qty) {
      failed.push({ id: it.id, available: doc.stock });
    }
  }
  return { ok: failed.length === 0, failed };
}

// Atomically reserves stock for every item or none at all: attempts each
// item in turn, and if any fails, rolls back the ones that already
// succeeded. This is the actual enforcement point — call it exactly once,
// at the moment an order is genuinely committed (COD order created, or
// payment verified), never speculatively.
async function reserveStock(items) {
  const applied = [];
  const failed = [];
  for (const it of items) {
    const result = await adjustStock(it.id, -it.qty, { requireAvailable: true });
    if (result.ok) applied.push(it);
    else failed.push({ id: it.id, available: result.available });
  }
  if (failed.length) {
    for (const it of applied) await adjustStock(it.id, it.qty, { requireAvailable: false });
    return { ok: false, failed };
  }
  return { ok: true };
}

// Unconditional decrement (can push stock negative) for the one case where
// we can no longer refuse the order — payment has already been captured.
// Returns which items went oversold so the caller can flag the order for
// manual review instead of silently hiding it.
async function forceReserveStock(items) {
  const oversold = [];
  for (const it of items) {
    const result = await adjustStock(it.id, -it.qty, { requireAvailable: false });
    if (result.stock != null && result.stock < 0) {
      oversold.push(it.id);
    }
  }
  return { oversold };
}

async function releaseStock(items) {
  for (const it of items) {
    await adjustStock(it.id, it.qty, { requireAvailable: false });
  }
}

module.exports = {
  DEFAULT_CATALOG,
  isKnownProduct,
  getCatalog,
  getPriceMap,
  saveProductOverride,
  checkStockAvailable,
  reserveStock,
  forceReserveStock,
  releaseStock
};
