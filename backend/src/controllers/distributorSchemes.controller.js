/*
 * Scheme master: buy-X-get-Y, quantity discounts and value discounts, with who qualifies and when.
 * What a scheme does to an order is in modules/distributor/schemes.js; this is the catalogue of schemes and what each
 * one has cost.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import {
  WholesaleError, audit, bool, diff, idList, int, isoDate, like, money, num, ok, oneOf, page, paging, text, today, withTransaction, wrapAll
} from '../modules/distributor/common.js';
import { eligibleSchemes } from '../modules/distributor/schemes.js';
import { loadUnits, unitFor } from '../modules/wholesale/units.js';

const rupees = (v) => toRupees(Number(v || 0));
const CUSTOMER_TYPES = ['RETAILER', 'DEALER', 'DISTRIBUTOR', 'BUSINESS', 'CORPORATE', 'OTHER'];

const state = (s, on) => {
  if (!s.is_active) return 'INACTIVE';
  const start = s.starts_on ? String(s.starts_on).slice(0, 10) : null; const end = s.ends_on ? String(s.ends_on).slice(0, 10) : null;
  if (end && end < on) return 'EXPIRED';
  if (start && start > on) return 'UPCOMING';
  return 'ACTIVE';
};
const daysLeft = (s, on) => (s.ends_on ? Math.round((Date.parse(`${String(s.ends_on).slice(0, 10)}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86400000) : null);

const shape = (s, on, extra = {}) => ({
  scheme_id: s.scheme_id, name: s.name, kind: s.kind, funded_by: s.funded_by, principal_id: s.principal_id, principal: s.principal_name ?? null,
  buy_product_id: s.buy_product_id, buy_brand_id: s.buy_brand_id, buy_category_id: s.buy_category_id, buy_principal_id: s.buy_principal_id,
  buy_scope: s.buy_product_id ? 'PRODUCT' : s.buy_brand_id ? 'BRAND' : s.buy_category_id ? 'CATEGORY' : s.buy_principal_id ? 'PRINCIPAL' : 'ALL', buy_scope_name: s.buy_scope_name ?? null,
  buy_unit_name: s.buy_unit_name, buy_min_qty: s.buy_min_qty == null ? null : Number(s.buy_min_qty), min_value: s.min_value_paise == null ? null : rupees(s.min_value_paise),
  free_product_id: s.free_product_id, free_product: s.free_product_name ?? null, free_qty: s.free_qty == null ? null : Number(s.free_qty), free_unit_name: s.free_unit_name, repeat: s.repeat,
  max_free_qty: s.max_free_qty == null ? null : Number(s.max_free_qty), discount_pct: s.discount_pct == null ? null : Number(s.discount_pct), discount: s.discount_paise == null ? null : rupees(s.discount_paise),
  customer_types: s.customer_types || [], starts_on: s.starts_on, ends_on: s.ends_on, is_active: s.is_active, stackable: s.stackable, priority: s.priority, notes: s.notes,
  status: state(s, on), days_left: daysLeft(s, on), description: describe(s), ...extra
});

/** "Buy 10 carton of Parle-G, get 1 carton free" — what a person reads on the order screen and the scheme list. */
export const describe = (s) => {
  const scope = s.buy_scope_name || (s.buy_brand_id ? 'this brand' : s.buy_category_id ? 'this category' : s.buy_principal_id ? 'this principal’s products' : 'the order');
  const unit = s.buy_unit_name ? ` ${s.buy_unit_name}` : '';
  if (s.kind === 'BUY_X_GET_Y') {
    const free = s.free_product_name || s.buy_scope_name || 'the same product';
    return `Buy ${Number(s.buy_min_qty)}${unit} of ${scope}, get ${Number(s.free_qty)}${s.free_unit_name ? ` ${s.free_unit_name}` : ''} of ${free} free${s.repeat ? ' (for every multiple)' : ''}`;
  }
  if (s.kind === 'QTY_DISCOUNT') return `Buy ${Number(s.buy_min_qty)}${unit} or more of ${scope}, get ${Number(s.discount_pct)}% off`;
  return `Spend ₹${rupees(s.min_value_paise).toLocaleString('en-IN')} or more on ${scope}, get ${s.discount_paise != null ? `₹${rupees(s.discount_paise).toLocaleString('en-IN')}` : `${Number(s.discount_pct)}%`} off`;
};

const SELECT = `
  SELECT s.*, pr.name AS principal_name, fp.name AS free_product_name,
         COALESCE(bp.name, bb.name, bc.name, bpr.name) AS buy_scope_name
  FROM dist_schemes s LEFT JOIN dist_principals pr ON pr.principal_id = s.principal_id LEFT JOIN products fp ON fp.product_id = s.free_product_id
  LEFT JOIN products bp ON bp.product_id = s.buy_product_id LEFT JOIN brands bb ON bb.brand_id = s.buy_brand_id
  LEFT JOIN categories bc ON bc.category_id = s.buy_category_id LEFT JOIN dist_principals bpr ON bpr.principal_id = s.buy_principal_id`;

const load = async (db, businessId, id) => (await db.query(`${SELECT} WHERE s.business_id = $1 AND s.scheme_id = $2`, [businessId, id])).rows[0];

const own = async (req, table, idCol, id, label) => {
  if (id == null) return null;
  if (!(await pool.query(`SELECT 1 FROM ${table} WHERE business_id = $1 AND ${idCol} = $2`, [req.tenant.businessId, id])).rowCount) throw new WholesaleError(400, `That ${label} was not found`);
  return id;
};

/** Validate and normalise a scheme body (full for create, merged with the stored row for update). */
const fields = async (req, b, existing = null) => {
  const m = (k, fallback = null) => (k in b ? b[k] : (existing ? existing[k] : fallback));
  const f = {};
  f.name = text(m('name'), 'Name', { max: 120, min: 2, required: true });
  f.kind = oneOf(m('kind'), 'Type', ['BUY_X_GET_Y', 'QTY_DISCOUNT', 'VALUE_DISCOUNT'], { required: true });
  f.funded_by = oneOf(m('funded_by'), 'Funded by', ['PRINCIPAL', 'DISTRIBUTOR'], { fallback: 'DISTRIBUTOR' });
  f.principal_id = await own(req, 'dist_principals', 'principal_id', int(m('principal_id'), 'Principal', { min: 1 }), 'principal');
  if (f.funded_by === 'PRINCIPAL' && !f.principal_id) throw new WholesaleError(400, 'Choose the principal that funds this scheme');
  const scope = oneOf(b.buy_scope ?? (existing ? (existing.buy_product_id ? 'PRODUCT' : existing.buy_brand_id ? 'BRAND' : existing.buy_category_id ? 'CATEGORY' : existing.buy_principal_id ? 'PRINCIPAL' : 'ALL') : 'ALL'), 'Applies to', ['ALL', 'PRODUCT', 'BRAND', 'CATEGORY', 'PRINCIPAL'], { fallback: 'ALL' });
  const scopeId = int('buy_scope_id' in b ? b.buy_scope_id : (existing ? existing.buy_product_id ?? existing.buy_brand_id ?? existing.buy_category_id ?? existing.buy_principal_id : null), 'Scope', { min: 1 });
  Object.assign(f, { buy_product_id: null, buy_brand_id: null, buy_category_id: null, buy_principal_id: null });
  if (scope !== 'ALL') {
    if (!scopeId) throw new WholesaleError(400, `Choose the ${scope.toLowerCase()} the scheme applies to`);
    const [table, idCol, col] = { PRODUCT: ['products', 'product_id', 'buy_product_id'], BRAND: ['brands', 'brand_id', 'buy_brand_id'], CATEGORY: ['categories', 'category_id', 'buy_category_id'], PRINCIPAL: ['dist_principals', 'principal_id', 'buy_principal_id'] }[scope];
    f[col] = await own(req, table, idCol, scopeId, scope.toLowerCase());
  }
  f.buy_unit_name = text(m('buy_unit_name'), 'Unit', { max: 24 });
  f.buy_min_qty = m('buy_min_qty') == null || m('buy_min_qty') === '' ? null : num(m('buy_min_qty'), 'Quantity to buy', { min: 0.001, max: 100000000 });
  f.min_value_paise = 'min_value' in b ? money(b.min_value, 'Minimum value', { min: 100 }) : (existing?.min_value_paise ?? null);
  f.free_product_id = await own(req, 'products', 'product_id', int(m('free_product_id'), 'Free product', { min: 1 }), 'product');
  f.free_qty = m('free_qty') == null || m('free_qty') === '' ? null : num(m('free_qty'), 'Free quantity', { min: 0.001, max: 100000000 });
  f.free_unit_name = text(m('free_unit_name'), 'Free unit', { max: 24 });
  f.repeat = 'repeat' in b ? bool(b.repeat) : (existing ? existing.repeat : true);
  f.max_free_qty = m('max_free_qty') == null || m('max_free_qty') === '' ? null : num(m('max_free_qty'), 'Most free', { min: 0.001, max: 100000000 });
  f.discount_pct = m('discount_pct') == null || m('discount_pct') === '' ? null : num(m('discount_pct'), 'Discount %', { min: 0.001, max: 100 });
  f.discount_paise = 'discount' in b ? money(b.discount, 'Discount', { min: 100 }) : (existing?.discount_paise ?? null);
  const types = 'customer_types' in b ? (Array.isArray(b.customer_types) ? b.customer_types.map((t) => String(t).toUpperCase()) : []) : (existing?.customer_types || []);
  if (types.some((t) => !CUSTOMER_TYPES.includes(t))) throw new WholesaleError(400, 'Unknown customer type');
  f.customer_types = types.length ? types : null;
  f.starts_on = isoDate(m('starts_on'), 'Start date'); f.ends_on = isoDate(m('ends_on'), 'End date');
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw new WholesaleError(400, 'The scheme cannot end before it starts');
  f.is_active = 'is_active' in b ? bool(b.is_active) : (existing ? existing.is_active : true);
  f.stackable = 'stackable' in b ? bool(b.stackable) : (existing ? existing.stackable : false);
  f.priority = int(m('priority', 0), 'Priority', { min: -100, max: 100 }) ?? 0;
  f.notes = text(m('notes'), 'Notes', { max: 300 });

  // what each kind needs
  if (f.kind === 'BUY_X_GET_Y') {
    if (f.buy_min_qty == null) throw new WholesaleError(400, 'Enter how much has to be bought');
    if (f.free_qty == null) throw new WholesaleError(400, 'Enter how much comes free');
    if (!f.free_product_id && !f.buy_product_id) throw new WholesaleError(400, 'Choose the product that comes free');
    f.min_value_paise = null; f.discount_pct = null; f.discount_paise = null;
  } else if (f.kind === 'QTY_DISCOUNT') {
    if (f.buy_min_qty == null) throw new WholesaleError(400, 'Enter the quantity that earns the discount');
    if (f.discount_pct == null) throw new WholesaleError(400, 'Enter the discount percentage');
    Object.assign(f, { min_value_paise: null, discount_paise: null, free_product_id: null, free_qty: null, free_unit_name: null, max_free_qty: null });
  } else {
    if (f.min_value_paise == null) throw new WholesaleError(400, 'Enter the order value that earns the discount');
    if (f.discount_pct == null && f.discount_paise == null) throw new WholesaleError(400, 'Enter the discount amount or percentage');
    if (f.discount_pct != null && f.discount_paise != null) throw new WholesaleError(400, 'Give either an amount or a percentage, not both');
    Object.assign(f, { buy_min_qty: null, buy_unit_name: null, free_product_id: null, free_qty: null, free_unit_name: null, max_free_qty: null });
  }
  // a unit is only meaningful for one named product; brand / category / principal schemes count base units
  if (f.buy_unit_name && !f.buy_product_id) throw new WholesaleError(400, 'A unit can only be given when the scheme is for one product');
  const unitProducts = [f.buy_product_id, f.free_product_id].filter(Boolean);
  if (unitProducts.length && (f.buy_unit_name || f.free_unit_name)) {
    const units = await loadUnits(pool, req.tenant.businessId, unitProducts);
    if (f.buy_unit_name) unitFor(units, f.buy_product_id, f.buy_unit_name, 'The product');
    if (f.free_unit_name) unitFor(units, f.free_product_id ?? f.buy_product_id, f.free_unit_name, 'The free product');
  }
  return f;
};

const stored = ['name', 'kind', 'funded_by', 'principal_id', 'buy_product_id', 'buy_brand_id', 'buy_category_id', 'buy_principal_id', 'buy_unit_name', 'buy_min_qty', 'min_value_paise', 'free_product_id', 'free_qty',
  'free_unit_name', 'repeat', 'max_free_qty', 'discount_pct', 'discount_paise', 'customer_types', 'starts_on', 'ends_on', 'is_active', 'stackable', 'priority', 'notes'];

const writeSets = async (client, businessId, schemeId, b) => {
  if ('customer_ids' in b) {
    const ids = idList(b.customer_ids, 'Retailers', { max: 5000 });
    const mine = ids.length ? (await client.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND customer_id = ANY($2::int[])`, [businessId, ids])).rows.map((r) => r.customer_id) : [];
    if (mine.length !== ids.length) throw new WholesaleError(400, 'One of the retailers was not found');
    await client.query(`DELETE FROM dist_scheme_customers WHERE scheme_id = $1`, [schemeId]);
    if (ids.length) await client.query(`INSERT INTO dist_scheme_customers (scheme_id, customer_id, business_id) SELECT $1, x, $2 FROM unnest($3::int[]) x`, [schemeId, businessId, ids]);
  }
  if ('territory_ids' in b) {
    const ids = idList(b.territory_ids, 'Territories', { max: 500 });
    const mine = ids.length ? (await client.query(`SELECT territory_id FROM dist_territories WHERE business_id = $1 AND territory_id = ANY($2::int[])`, [businessId, ids])).rows.map((r) => r.territory_id) : [];
    if (mine.length !== ids.length) throw new WholesaleError(400, 'One of the territories was not found');
    await client.query(`DELETE FROM dist_scheme_territories WHERE scheme_id = $1`, [schemeId]);
    if (ids.length) await client.query(`INSERT INTO dist_scheme_territories (scheme_id, territory_id, business_id) SELECT $1, x, $2 FROM unnest($3::int[]) x`, [schemeId, businessId, ids]);
  }
};

const sets = async (schemeId) => ({
  customers: (await pool.query(`SELECT c.customer_id, c.name FROM dist_scheme_customers sc JOIN customers c ON c.customer_id = sc.customer_id WHERE sc.scheme_id = $1 ORDER BY lower(c.name)`, [schemeId])).rows,
  territories: (await pool.query(`SELECT t.territory_id, t.name, t.level FROM dist_scheme_territories st JOIN dist_territories t ON t.territory_id = st.territory_id WHERE st.scheme_id = $1 ORDER BY t.level, lower(t.name)`, [schemeId])).rows
});

/* GET /schemes?status=ACTIVE|UPCOMING|EXPIRED|INACTIVE|ALL&expiring=1&principal_id=&q= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const on = await today(pool, req.tenant.businessId);
  const values = [req.tenant.businessId, on]; const where = ['s.business_id = $1', '$2::date IS NOT NULL'];
  const status = String(req.query.status || 'ALL').toUpperCase();
  if (status === 'ACTIVE') where.push(`s.is_active AND (s.starts_on IS NULL OR s.starts_on <= $2::date) AND (s.ends_on IS NULL OR s.ends_on >= $2::date)`);
  else if (status === 'UPCOMING') where.push(`s.is_active AND s.starts_on > $2::date`);
  else if (status === 'EXPIRED') where.push(`s.is_active AND s.ends_on < $2::date`);
  else if (status === 'INACTIVE') where.push(`NOT s.is_active`);
  if (req.query.expiring === '1') where.push(`s.is_active AND s.ends_on >= $2::date AND s.ends_on <= $2::date + 7`);
  if (req.query.principal_id) { values.push(Number(req.query.principal_id) || 0); where.push(`s.principal_id = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`s.name ILIKE $${values.length}`); }
  const base = `FROM dist_schemes s WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `${SELECT.replace('FROM dist_schemes s', `, (SELECT COUNT(DISTINCT a.order_id) FROM dist_scheme_applications a WHERE a.scheme_id = s.scheme_id) AS orders,
         (SELECT COALESCE(SUM(a.cost_paise), 0) FROM dist_scheme_applications a WHERE a.scheme_id = s.scheme_id) AS cost
       FROM dist_schemes s`).replace('COALESCE(bp.name, bb.name, bc.name, bpr.name) AS buy_scope_name\n  ,', 'COALESCE(bp.name, bb.name, bc.name, bpr.name) AS buy_scope_name,')}
     WHERE s.scheme_id IN (SELECT s.scheme_id ${base} ORDER BY s.is_active DESC, s.ends_on NULLS LAST, s.scheme_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}) ORDER BY s.is_active DESC, s.ends_on NULLS LAST, s.scheme_id DESC`, values)).rows;
  page(res, rows.map((r) => shape(r, on, { orders: Number(r.orders), cost: rupees(r.cost) })), total, pg);
};

const get = async (req, res) => {
  const row = await load(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  ok(res, { ...shape(row, await today(pool, req.tenant.businessId)), ...(await sets(row.scheme_id)) });
};

const create = async (req, res) => {
  const b = req.body || {}; const f = await fields(req, b);
  const id = await withTransaction(async (client) => {
    const keys = Object.keys(f);
    const row = (await client.query(`INSERT INTO dist_schemes (business_id, created_by, ${keys.join(', ')}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING scheme_id`, [req.tenant.businessId, req.auth.userId, ...keys.map((k) => f[k])])).rows[0].scheme_id;
    await writeSets(client, req.tenant.businessId, row, b);
    return row;
  });
  audit(req, 'distributor.scheme_created', 'scheme', id, null, { ...f, customers: b.customer_ids?.length, territories: b.territory_ids?.length });
  const row = await load(pool, req.tenant.businessId, id);
  ok(res, { ...shape(row, await today(pool, req.tenant.businessId)), ...(await sets(id)) }, 201);
};

const update = async (req, res) => {
  const b = req.body || {};
  const before = await load(pool, req.tenant.businessId, req.params.id);
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = await fields(req, b, before);
  await withTransaction(async (client) => {
    const keys = Object.keys(f);
    await client.query(`UPDATE dist_schemes SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND scheme_id = $2`, [req.tenant.businessId, before.scheme_id, ...keys.map((k) => f[k])]);
    await writeSets(client, req.tenant.businessId, before.scheme_id, b);
  });
  const after = await load(pool, req.tenant.businessId, before.scheme_id);
  const on = await today(pool, req.tenant.businessId);
  audit(req, 'distributor.scheme_updated', 'scheme', before.scheme_id, null, null, { changes: diff(Object.fromEntries(stored.map((k) => [k, before[k]])), Object.fromEntries(stored.map((k) => [k, after[k]]))) });
  ok(res, { ...shape(after, on), ...(await sets(before.scheme_id)) });
};

/* DELETE /schemes/:id — only a scheme no order has used; otherwise switch it off so the history stays */
const remove = async (req, res) => {
  const row = await load(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  if (Number((await pool.query(`SELECT COUNT(*) AS n FROM dist_scheme_applications WHERE scheme_id = $1`, [row.scheme_id])).rows[0].n)) throw new WholesaleError(409, 'Orders have used this scheme. Switch it off instead, so its history stays.');
  await pool.query(`DELETE FROM dist_schemes WHERE business_id = $1 AND scheme_id = $2`, [req.tenant.businessId, row.scheme_id]);
  audit(req, 'distributor.scheme_deleted', 'scheme', row.scheme_id, { name: row.name });
  ok(res, { deleted: true });
};

/* GET /schemes/eligible?customer_id=&date= — the schemes this retailer qualifies for right now (what a rep shows at the counter) */
const eligible = async (req, res) => {
  const customerId = int(req.query.customer_id, 'Customer', { min: 1, required: true });
  if (!(await pool.query(`SELECT 1 FROM customers WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, customerId])).rowCount) throw new WholesaleError(404, 'Not found');
  const on = isoDate(req.query.date, 'Date') || await today(pool, req.tenant.businessId);
  const ids = (await eligibleSchemes(pool, { businessId: req.tenant.businessId, customerId, on })).map((s) => s.scheme_id);
  const rows = ids.length ? (await pool.query(`${SELECT} WHERE s.business_id = $1 AND s.scheme_id = ANY($2::int[]) ORDER BY s.priority DESC, s.scheme_id`, [req.tenant.businessId, ids])).rows : [];
  ok(res, rows.map((r) => shape(r, on)));
};

/* GET /schemes/:id/performance — orders, free goods and discount given, and what is claimable from the principal */
const performance = async (req, res) => {
  const row = await load(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const live = `a.scheme_id = $1 AND o.status NOT IN ('CANCELLED','REJECTED','DRAFT')`;
  const t = (await pool.query(
    `SELECT COUNT(DISTINCT a.order_id) AS orders, COUNT(DISTINCT o.customer_id) AS customers, COALESCE(SUM(a.free_base), 0) AS free_base, COALESCE(SUM(a.discount_paise), 0) AS discount, COALESCE(SUM(a.cost_paise), 0) AS cost
     FROM dist_scheme_applications a JOIN wholesale_sales_orders o ON o.order_id = a.order_id WHERE ${live}`, [row.scheme_id])).rows[0];
  const shipped = (await pool.query(
    `SELECT COALESCE(SUM(i.shipped_base), 0) AS shipped_base, COALESCE(SUM(i.shipped_base * p.purchase_price_paise), 0) AS shipped_cost
     FROM wholesale_sales_order_items i JOIN products p ON p.product_id = i.product_id WHERE i.scheme_id = $1 AND i.is_free`, [row.scheme_id])).rows[0];
  ok(res, {
    ...shape(row, await today(pool, req.tenant.businessId)), orders: Number(t.orders), customers: Number(t.customers), free_base_ordered: Number(t.free_base), free_base_shipped: Number(shipped.shipped_base),
    discount_given: rupees(t.discount), cost: rupees(t.cost), claimable_from_principal: row.funded_by === 'PRINCIPAL' ? rupees(Number(shipped.shipped_cost) + Number(t.discount)) : 0
  });
};

export default wrapAll({ list, get, create, update, remove, eligible, performance });
