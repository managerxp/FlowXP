/*
 * The customer card lookups a till uses, and coupons. Loyalty cards live in
 * modules/loyaltyEngine.js, coupons in modules/coupons.js; this file validates input, scopes to the business and
 * turns paise into rupees at the edge.
 *
 * Loyalty and coupons are business-wide (a visit at any outlet counts), so the
 * settings need the 'settings' permission and a group-level user.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { CouponError, validateCoupon } from '../modules/coupons.js';
import { findCustomerByPhone, normalisePhone } from '../modules/phone.js';
import { spendCard } from '../modules/loyaltyEngine.js';
import { businessToday } from '../utils/dates.js';
import { toPaise, toRupees } from '../utils/money.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

/* GET /api/loyalty/lookup?phone= — the till types a mobile number and sees who it is and where their card stands */
export const lookup = async (req, res) => {
  if (!normalisePhone(req.query.phone)) return bad(res, 'Enter a 10-digit mobile number');
  const customer = await findCustomerByPhone(pool, req.tenant.businessId, req.query.phone);
  res.json({ success: true, data: { customer, points: customer ? await spendCard(pool, req.tenant.businessId, customer.customer_id) : null } });
};

/* GET /api/loyalty/customers/:id */
export const customerCard = async (req, res) => {
  const own = await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!own.rows.length) return bad(res, 'Not found', 404);
  res.json({ success: true, data: { points: await spendCard(pool, req.tenant.businessId, Number(req.params.id)) } });
};

/* ── coupons ─────────────────────────────────────────────────────────────── */

const asCoupon = (r) => ({
  coupon_id: r.coupon_id, code: r.code, description: r.description, kind: r.kind,
  value: r.kind === 'FLAT' ? toRupees(r.value) : Number(r.value),
  min_bill: toRupees(r.min_bill_paise), max_discount: r.max_discount_paise != null ? toRupees(r.max_discount_paise) : null,
  valid_from: r.valid_from ? String(r.valid_from).slice(0, 10) : null, valid_to: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
  max_uses: r.max_uses, max_uses_per_customer: r.max_uses_per_customer, is_active: r.is_active,
  used: Number(r.used ?? 0), discount_given: toRupees(r.discount_paise ?? 0)
});


export const listCoupons = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(r.redemption_id) FILTER (WHERE r.voided_at IS NULL) AS used,
            COALESCE(SUM(r.amount_paise) FILTER (WHERE r.voided_at IS NULL), 0) AS discount_paise
     FROM coupons c LEFT JOIN coupon_redemptions r ON r.coupon_id = c.coupon_id
     WHERE c.business_id = $1 GROUP BY c.coupon_id ORDER BY c.is_active DESC, c.created_at DESC`, [req.tenant.businessId]);
  res.json({ success: true, data: rows.map(asCoupon) });
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Validate and convert a coupon body. Returns { fields } or { error }. */
const readCoupon = (body, partial = false) => {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('code')) {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return { error: 'Code must be 3 to 24 letters, numbers, - or _' };
    out.code = code;
  }
  if (!partial || has('kind')) {
    if (!['PERCENT', 'FLAT'].includes(body.kind)) return { error: 'Choose percent or a flat amount' };
    out.kind = body.kind;
  }
  if (!partial || has('value')) {
    const v = Number(body.value);
    if (!(v > 0)) return { error: 'Enter how much the coupon takes off' };
    const kind = out.kind ?? body.kind;
    if (kind === 'PERCENT' && v > 100) return { error: 'A percentage can’t be more than 100' };
    out.value = kind === 'FLAT' ? toPaise(v) : Math.round(v * 100) / 100;
  }
  const money = (key, column, label) => {
    if (!has(key)) return null;
    if (body[key] === null || body[key] === '') { out[column] = column === 'min_bill_paise' ? 0 : null; return null; }
    const n = Number(body[key]);
    if (!(n >= 0)) return `${label} must be a number`;
    out[column] = toPaise(n);
    return null;
  };
  for (const e of [money('min_bill', 'min_bill_paise', 'Minimum bill'), money('max_discount', 'max_discount_paise', 'Maximum discount')]) if (e) return { error: e };
  if (out.max_discount_paise === 0) out.max_discount_paise = null;
  for (const [key, label] of [['valid_from', 'Start date'], ['valid_to', 'End date']]) {
    if (!has(key)) continue;
    if (body[key] === null || body[key] === '') out[key] = null;
    else if (DATE.test(body[key])) out[key] = body[key];
    else return { error: `${label} must be a date` };
  }
  if (out.valid_from && out.valid_to && out.valid_to < out.valid_from) return { error: 'The end date is before the start date' };
  for (const [key, label] of [['max_uses', 'Total uses'], ['max_uses_per_customer', 'Uses per customer']]) {
    if (!has(key)) continue;
    if (body[key] === null || body[key] === '') out[key] = null;
    else if (Number.isInteger(Number(body[key])) && Number(body[key]) > 0) out[key] = Number(body[key]);
    else return { error: `${label} must be a whole number above zero` };
  }
  if (has('description')) out.description = body.description ? String(body.description).trim().slice(0, 160) : null;
  if (has('is_active')) out.is_active = body.is_active === true;
  return { fields: out };
};

/* POST /api/coupons */
export const createCoupon = async (req, res) => {
  const { fields, error } = readCoupon(req.body || {});
  if (error) return bad(res, error);
  const columns = ['business_id', ...Object.keys(fields)];
  try {
    const { rows } = await pool.query(
      `INSERT INTO coupons (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      [req.tenant.businessId, ...Object.values(fields)]
    );
    recordAudit(req, { action: 'coupon.created', resource_type: 'coupon', resource_id: rows[0].coupon_id, metadata: { code: fields.code } });
    res.status(201).json({ success: true, data: asCoupon(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'You already have a coupon with that code', 409);
    if (e.code === '23514') return bad(res, 'Those values aren’t allowed together');
    throw e;
  }
};

/* PUT /api/coupons/:id — edit, or switch off with { is_active: false } */
export const updateCoupon = async (req, res) => {
  const { fields, error } = readCoupon(req.body || {}, true);
  if (error) return bad(res, error);
  const entries = Object.entries(fields);
  if (!entries.length) return bad(res, 'Nothing to update');
  try {
    const { rows } = await pool.query(
      `UPDATE coupons SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE coupon_id = $1 AND business_id = $2 RETURNING *`,
      [req.params.id, req.tenant.businessId, ...entries.map(([, v]) => v)]
    );
    if (!rows.length) return bad(res, 'Not found', 404);
    recordAudit(req, { action: 'coupon.updated', resource_type: 'coupon', resource_id: rows[0].coupon_id, metadata: Object.keys(fields) });
    res.json({ success: true, data: asCoupon(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return bad(res, 'You already have a coupon with that code', 409);
    if (e.code === '23514') return bad(res, 'Those values aren’t allowed together');
    throw e;
  }
};

/* POST /api/coupons/check { code, customer_id?, total } — what a code would take off a bill, without using it */
export const checkCoupon = async (req, res) => {
  const body = req.body || {};
  const total = Number(body.total);
  if (!(total >= 0)) return bad(res, 'Send the bill total');
  const businessId = req.tenant.businessId;
  try {
    const { coupon, discountPaise } = await validateCoupon(pool, {
      businessId, code: body.code, customerId: body.customer_id ? Number(body.customer_id) : null,
      totalPaise: toPaise(total), today: await businessToday(businessId)
    });
    res.json({ success: true, data: { code: coupon.code, description: coupon.description, discount: toRupees(discountPaise) } });
  } catch (e) {
    if (e instanceof CouponError) return bad(res, e.message);
    throw e;
  }
};
