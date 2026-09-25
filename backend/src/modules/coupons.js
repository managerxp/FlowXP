/*
 * Coupon rules in one place: the staff "check this code" endpoint and the
 * billing engine both call validateCoupon, so a code that previews as valid
 * cannot be refused at billing for a different reason.
 *
 * The discount is taken off the bill total (tax included), like every other
 * invoice-level discount in FlowXP.
 */

export class CouponError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CouponError';
    this.status = 400;
  }
}

/** Pure: what a coupon takes off a bill of `totalPaise`. Never more than the bill. */
export const couponDiscount = (coupon, totalPaise) => {
  const raw = coupon.kind === 'PERCENT' ? Math.round((totalPaise * Number(coupon.value)) / 100) : Math.round(Number(coupon.value));
  const capped = coupon.max_discount_paise != null ? Math.min(raw, Number(coupon.max_discount_paise)) : raw;
  return Math.max(0, Math.min(capped, totalPaise));
};

/**
 * Check a code against a bill. Throws CouponError with a message a cashier can read out.
 * With `lock`, the coupon row is locked so two tills can't both take its last use.
 */
export const validateCoupon = async (db, { businessId, code, customerId = null, totalPaise, today, lock = false }) => {
  const clean = String(code ?? '').trim();
  if (!clean) throw new CouponError('Enter a coupon code');
  const coupon = (await db.query(
    `SELECT * FROM coupons WHERE business_id = $1 AND upper(code) = upper($2)${lock ? ' FOR UPDATE' : ''}`, [businessId, clean]
  )).rows[0];
  if (!coupon || !coupon.is_active) throw new CouponError('That coupon code isn’t valid');
  if (coupon.valid_from && today < String(coupon.valid_from).slice(0, 10)) throw new CouponError('That coupon isn’t active yet');
  if (coupon.valid_to && today > String(coupon.valid_to).slice(0, 10)) throw new CouponError('That coupon has expired');
  if (totalPaise < Number(coupon.min_bill_paise)) throw new CouponError(`This coupon needs a bill of at least ₹${Number(coupon.min_bill_paise) / 100}`);

  if (coupon.max_uses != null) {
    const used = Number((await db.query(`SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = $1 AND voided_at IS NULL`, [coupon.coupon_id])).rows[0].n);
    if (used >= coupon.max_uses) throw new CouponError('That coupon has been fully used');
  }
  if (coupon.max_uses_per_customer != null) {
    if (!customerId) throw new CouponError('Add the customer’s mobile number to use this coupon');
    const mine = Number((await db.query(`SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [coupon.coupon_id, customerId])).rows[0].n);
    if (mine >= coupon.max_uses_per_customer) throw new CouponError('This customer has already used that coupon');
  }
  const discountPaise = couponDiscount(coupon, totalPaise);
  if (discountPaise <= 0) throw new CouponError('That coupon takes nothing off this bill');
  return { coupon, discountPaise };
};
