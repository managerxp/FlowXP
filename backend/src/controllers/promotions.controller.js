/*
 * Offers (retail): the owner's list (create, change, switch off, delete) and what the till needs:
 *
 *   GET    /api/retail/promotions            every offer, with what it applies to and whether it is on today
 *   POST   /api/retail/promotions            make one
 *   PUT    /api/retail/promotions/:id        change one (also how it is switched on or off)
 *   DELETE /api/retail/promotions/:id        remove one (bills already made keep what they were charged)
 *   GET    /api/retail/promotions/active     how many offers are on today, so the till knows whether to ask for a preview
 *   POST   /api/retail/promotions/preview    the offers a cart would get: the same rules the server applies at billing
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { KINDS, activePromotions, priceLines } from '../modules/promotions.js';
import { businessToday } from '../utils/dates.js';
import { toPaise, toRupees } from '../utils/money.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const asPromo = (r, today) => ({
  promo_id: r.promo_id, name: r.name, kind: r.kind, product_id: r.product_id, product_name: r.product_name ?? null, category_id: r.category_id, category_name: r.category_name ?? null,
  percent: r.percent == null ? null : Number(r.percent), min_qty: Number(r.min_qty), buy_qty: r.buy_qty, get_qty: r.get_qty, bundle_qty: r.bundle_qty,
  bundle_price: r.bundle_price_paise == null ? null : toRupees(r.bundle_price_paise), members_only: r.members_only,
  starts_on: r.starts_on ? String(r.starts_on).slice(0, 10) : null, ends_on: r.ends_on ? String(r.ends_on).slice(0, 10) : null, is_active: r.is_active,
  live: r.is_active && (!r.starts_on || String(r.starts_on).slice(0, 10) <= today) && (!r.ends_on || String(r.ends_on).slice(0, 10) >= today)
});

/** Validate a body into column values; returns { row } or { error }. `current` fills what a PUT leaves out. */
const parse = async (businessId, b, current = {}) => {
  const v = { ...current, ...b };
  const name = String(v.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 80) return { error: 'Give the offer a name (up to 80 characters)' };
  if (!KINDS.includes(v.kind)) return { error: 'Choose what kind of offer it is' };
  const productId = v.product_id ? Number(v.product_id) : null;
  const categoryId = v.category_id ? Number(v.category_id) : null;
  if ((productId == null) === (categoryId == null)) return { error: 'Choose one product or one category for the offer' };
  if (productId && !(await pool.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [productId, businessId])).rows.length) return { error: 'That product was not found' };
  if (categoryId && !(await pool.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [categoryId, businessId])).rows.length) return { error: 'That category was not found' };
  const row = { name, kind: v.kind, product_id: productId, category_id: categoryId, percent: null, min_qty: 1, buy_qty: null, get_qty: null, bundle_qty: null, bundle_price_paise: null, members_only: Boolean(v.members_only), starts_on: null, ends_on: null, is_active: v.is_active !== false };
  if (v.kind === 'PERCENT_OFF') {
    const percent = Number(v.percent);
    if (!(percent > 0 && percent <= 100)) return { error: 'The percentage must be above 0 and at most 100' };
    const min = Number(v.min_qty ?? 1);
    if (!(min > 0 && min <= 100000)) return { error: 'The minimum quantity must be above zero' };
    Object.assign(row, { percent, min_qty: min });
  } else if (v.kind === 'BUY_X_GET_Y') {
    const buy = Number(v.buy_qty); const get = Number(v.get_qty);
    if (!Number.isInteger(buy) || buy < 1 || buy > 100 || !Number.isInteger(get) || get < 1 || get > 100) return { error: 'Buy and free quantities must be whole numbers from 1 to 100' };
    Object.assign(row, { buy_qty: buy, get_qty: get });
  } else {
    const qty = Number(v.bundle_qty);
    if (!Number.isInteger(qty) || qty < 2 || qty > 100) return { error: 'A bundle is a whole number of 2 or more' };
    if (v.bundle_price === '' || v.bundle_price == null) return { error: 'Enter the bundle price' };
    let price;
    try { price = toPaise(v.bundle_price); } catch { return { error: 'Enter the bundle price' }; }
    if (!Number.isFinite(price) || price < 0 || price > 100000000) return { error: 'Enter a bundle price between 0 and 10,00,000' };
    Object.assign(row, { bundle_qty: qty, bundle_price_paise: price });
  }
  for (const key of ['starts_on', 'ends_on']) {
    if (v[key] == null || v[key] === '') continue;
    const day = String(v[key]).slice(0, 10);
    if (!isDay(day)) return { error: 'Dates look like 2026-12-31' };
    row[key] = day;
  }
  if (row.starts_on && row.ends_on && row.starts_on > row.ends_on) return { error: 'The offer cannot end before it starts' };
  return { row };
};

const SELECT = `SELECT pr.*, p.name AS product_name, c.name AS category_name FROM promotions pr
                LEFT JOIN products p ON p.product_id = pr.product_id LEFT JOIN categories c ON c.category_id = pr.category_id`;

export const list = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  const { rows } = await pool.query(`${SELECT} WHERE pr.business_id = $1 ORDER BY pr.is_active DESC, pr.promo_id DESC`, [req.tenant.businessId]);
  res.json({ success: true, data: rows.map((r) => asPromo(r, today)) });
};

export const create = async (req, res) => {
  const { businessId } = req.tenant;
  const { row, error } = await parse(businessId, req.body || {});
  if (error) return bad(res, error);
  const { rows } = await pool.query(
    `INSERT INTO promotions (business_id, name, kind, product_id, category_id, percent, min_qty, buy_qty, get_qty, bundle_qty, bundle_price_paise, members_only, starts_on, ends_on, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING promo_id`,
    [businessId, row.name, row.kind, row.product_id, row.category_id, row.percent, row.min_qty, row.buy_qty, row.get_qty, row.bundle_qty, row.bundle_price_paise, row.members_only, row.starts_on, row.ends_on, row.is_active, req.auth.userId]);
  recordAudit(req, { action: 'retail.promotion_created', resource_type: 'promotion', resource_id: rows[0].promo_id, metadata: { name: row.name, kind: row.kind } });
  const today = await businessToday(businessId);
  res.status(201).json({ success: true, data: asPromo((await pool.query(`${SELECT} WHERE pr.promo_id = $1`, [rows[0].promo_id])).rows[0], today) });
};

export const update = async (req, res) => {
  const { businessId } = req.tenant;
  const current = (await pool.query(`SELECT * FROM promotions WHERE promo_id = $1 AND business_id = $2`, [req.params.id, businessId])).rows[0];
  if (!current) return bad(res, 'Offer not found', 404);
  const { row, error } = await parse(businessId, req.body || {}, { ...current, bundle_price: current.bundle_price_paise == null ? undefined : toRupees(current.bundle_price_paise), starts_on: current.starts_on ? String(current.starts_on).slice(0, 10) : null, ends_on: current.ends_on ? String(current.ends_on).slice(0, 10) : null });
  if (error) return bad(res, error);
  await pool.query(
    `UPDATE promotions SET name=$3, kind=$4, product_id=$5, category_id=$6, percent=$7, min_qty=$8, buy_qty=$9, get_qty=$10, bundle_qty=$11, bundle_price_paise=$12, members_only=$13, starts_on=$14, ends_on=$15, is_active=$16
     WHERE promo_id = $1 AND business_id = $2`,
    [current.promo_id, businessId, row.name, row.kind, row.product_id, row.category_id, row.percent, row.min_qty, row.buy_qty, row.get_qty, row.bundle_qty, row.bundle_price_paise, row.members_only, row.starts_on, row.ends_on, row.is_active]);
  recordAudit(req, { action: 'retail.promotion_updated', resource_type: 'promotion', resource_id: current.promo_id, metadata: { name: row.name, is_active: row.is_active } });
  const today = await businessToday(businessId);
  res.json({ success: true, data: asPromo((await pool.query(`${SELECT} WHERE pr.promo_id = $1`, [current.promo_id])).rows[0], today) });
};

export const remove = async (req, res) => {
  const r = await pool.query(`DELETE FROM promotions WHERE promo_id = $1 AND business_id = $2 RETURNING name`, [req.params.id, req.tenant.businessId]);
  if (!r.rowCount) return bad(res, 'Offer not found', 404);
  recordAudit(req, { action: 'retail.promotion_deleted', resource_type: 'promotion', resource_id: Number(req.params.id), metadata: { name: r.rows[0].name } });
  res.json({ success: true, data: { deleted: true } });
};

export const active = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  res.json({ success: true, data: { count: (await activePromotions(pool, req.tenant.businessId, today)).length } });
};

/* POST /preview { lines: [{ product_id, quantity, unit_price, discount? }], customer_id? } -> { lines: [{ index, discount, promo_id, name }], saving } */
export const preview = async (req, res) => {
  const { businessId } = req.tenant;
  const input = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(0, 300);
  const today = await businessToday(businessId);
  const promos = await activePromotions(pool, businessId, today);
  if (!promos.length || !input.length) return res.json({ success: true, data: { lines: [], saving: 0 } });
  const ids = [...new Set(input.map((l) => Number(l.product_id)).filter(Boolean))];
  const cats = new Map((await pool.query(`SELECT product_id, category_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids])).rows.map((r) => [r.product_id, r.category_id]));
  const lines = input.map((l, index) => ({ index, product_id: Number(l.product_id) || null, category_id: cats.get(Number(l.product_id)) ?? null, quantity: Number(l.quantity) || 0, unitPricePaise: toPaise(l.unit_price ?? 0), discountPaise: toPaise(l.discount ?? 0) }));
  const result = priceLines(promos, lines, { hasCustomer: Boolean(req.body?.customer_id) });
  const out = [...result].map(([index, r]) => ({ index, discount: toRupees(r.discountPaise), promo_id: r.promo_id, name: r.name }));
  res.json({ success: true, data: { lines: out, saving: toRupees([...result.values()].reduce((s, r) => s + r.discountPaise, 0)) } });
};
