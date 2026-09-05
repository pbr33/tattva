const { getCouponsStore, getOrdersStore } = require("./blobs");

const PAID_STATUSES = new Set(["paid", "processing", "shipped", "delivered"]);

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function getCoupon(code) {
  const store = getCouponsStore();
  return store.get(normalizeCode(code), { type: "json" });
}

async function hasExistingPaidOrder(phone) {
  if (!phone) return false;
  const store = getOrdersStore();
  const { blobs } = await store.list();
  const orders = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return orders.some((o) => o && PAID_STATUSES.has(o.status) && o.customer && o.customer.phone === phone);
}

// subtotalRupees: pre-shipping, pre-discount subtotal (rupees, matching PRICES units).
// Returns { ok:true, discount } (discount in rupees) or { ok:false, reason }.
async function evaluateCoupon(code, subtotalRupees, phone) {
  const coupon = await getCoupon(code);
  if (!coupon) return { ok: false, reason: "Coupon not found" };
  if (!coupon.active) return { ok: false, reason: "This coupon is no longer active" };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "This coupon has expired" };
  }
  if (coupon.min_order && subtotalRupees < coupon.min_order) {
    return { ok: false, reason: `Minimum order of ₹${coupon.min_order} required for this coupon` };
  }
  if (coupon.usage_limit != null && (coupon.used_count || 0) >= coupon.usage_limit) {
    return { ok: false, reason: "This coupon has reached its usage limit" };
  }
  const usedBy = coupon.used_by || [];
  if (coupon.per_user_limit != null && phone) {
    const usesByThisPhone = usedBy.filter((p) => p === phone).length;
    if (usesByThisPhone >= coupon.per_user_limit) {
      return { ok: false, reason: "You've already used this coupon" };
    }
  }
  if (coupon.new_user_only) {
    if (!phone) return { ok: false, reason: "This coupon requires a phone number to verify eligibility" };
    if (await hasExistingPaidOrder(phone)) {
      return { ok: false, reason: "This coupon is for new customers only" };
    }
  }

  let discount = coupon.type === "percent" ? Math.round(subtotalRupees * (coupon.value / 100)) : coupon.value;
  if (coupon.type === "percent" && coupon.max_discount) discount = Math.min(discount, coupon.max_discount);
  discount = Math.min(discount, subtotalRupees); // never discount below zero

  return { ok: true, discount, coupon };
}

async function recordCouponUsage(code, phone) {
  const store = getCouponsStore();
  const key = normalizeCode(code);
  const coupon = await store.get(key, { type: "json" });
  if (!coupon) return;
  coupon.used_count = (coupon.used_count || 0) + 1;
  coupon.used_by = [...(coupon.used_by || []), phone].slice(-500);
  coupon.updated_at = new Date().toISOString();
  await store.setJSON(key, coupon);
}

module.exports = { normalizeCode, getCoupon, evaluateCoupon, recordCouponUsage, hasExistingPaidOrder };
