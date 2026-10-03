/*
 * Retail stock: the stock-center views, dated batches (sold soonest-expiry first), and stock counts.
 *
 * The ledger is unchanged: every movement still goes through moveStock + inventory_transactions. This module adds
 *   - batches for products flagged track_expiry (stored in wholesale_batches, the table pharmacy uses): received with
 *     an expiry date, taken from FEFO on a sale, put back on a cancel or a return, written off when they expire;
 *   - stock counts: counted quantities are only a record until applied, and then become COUNT movements.
 * Batches are a tracker beside the ledger, never a second source of truth: an unbatched sale (stock that arrived
 * before the product was flagged) simply leaves the batches untouched.
 */
import { moveStock } from './stock.js';
import { allocateBatches, consumeBatches, returnToBatch } from './wholesale/stock.js';
import { businessToday } from '../utils/dates.js';

export class StockError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}

export const q3 = (n) => Math.round(Number(n) * 1000) / 1000;
export const defaultBatchNo = (expiry) => `EXP${String(expiry).replaceAll('-', '')}`;

/* ── batches: sale, return, write-off ─────────────────────────────────────────────────────── */

/** Take sold quantities out of batches, soonest expiry first, for the products that track expiry. lines: [{ productId, qty }] (base units). */
export const takeBatchesForSale = async (client, { businessId, branchId, invoiceId, lines }) => {
  const ids = [...new Set(lines.map((l) => l.productId))];
  if (!ids.length) return;
  const tracked = new Set((await client.query(
    `SELECT product_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) AND track_expiry`, [businessId, ids])).rows.map((r) => r.product_id));
  if (!tracked.size) return;
  const today = await businessToday(businessId, client);
  for (const l of lines) {
    if (!tracked.has(l.productId) || !(l.qty > 0)) continue;
    const { allocations } = await allocateBatches(client, { branchId, productId: l.productId, qty: l.qty, fefo: true, today });
    await consumeBatches(client, { businessId, allocations, refType: 'RETAIL_SALE', refId: invoiceId });
  }
};

/** Put quantity back into the batches an invoice took it from (all of it on a cancel, or `qty` of one product on a return). */
export const restoreBatches = async (client, { businessId, invoiceId, productId = null, qty = null }) => {
  const { rows } = await client.query(
    `SELECT m.batch_id,
            -COALESCE(SUM(m.qty) FILTER (WHERE m.ref_type = 'RETAIL_SALE'), 0) - COALESCE(SUM(m.qty) FILTER (WHERE m.ref_type = 'RETAIL_RETURN'), 0) AS open
     FROM wholesale_batch_moves m JOIN wholesale_batches b ON b.batch_id = m.batch_id
     WHERE m.business_id = $1 AND m.ref_id = $2 AND m.ref_type IN ('RETAIL_SALE','RETAIL_RETURN') AND ($3::int IS NULL OR b.product_id = $3)
     GROUP BY m.batch_id ORDER BY m.batch_id`, [businessId, invoiceId, productId]);
  let left = qty == null ? Infinity : q3(qty);
  for (const r of rows) {
    const give = Math.min(left, q3(r.open));
    if (!(give > 0)) continue;
    await returnToBatch(client, { businessId, batchId: r.batch_id, qty: give, refType: 'RETAIL_RETURN', refId: invoiceId });
    left = q3(left - give);
    if (left <= 0) break;
  }
};

/** Throw an expired (or any) batch's stock away: batch, ledger and shelf quantity move together, as WASTAGE with the reason EXPIRED. */
export const writeOffBatch = async (client, { businessId, branchId, batchId, qty = null, userId, reason = 'EXPIRED', note = null }) => {
  const batch = (await client.query(
    `SELECT b.batch_id, b.product_id, b.branch_id, b.batch_no, b.qty_on_hand FROM wholesale_batches b
     WHERE b.batch_id = $1 AND b.business_id = $2 FOR UPDATE`, [batchId, businessId])).rows[0];
  if (!batch || batch.branch_id !== branchId) throw new StockError(404, 'Not found');
  const take = qty == null ? q3(batch.qty_on_hand) : q3(qty);
  if (!(take > 0)) throw new StockError(400, 'There is nothing left in that batch');
  if (take > q3(batch.qty_on_hand)) throw new StockError(400, `That batch has only ${q3(batch.qty_on_hand)} left`);
  await client.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2 FOR UPDATE`, [batch.product_id, businessId]);
  await consumeBatches(client, { businessId, allocations: [{ batch_id: batch.batch_id, qty: take }], refType: 'WRITE_OFF', refId: null });
  await moveStock(client, { businessId, branchId, productId: batch.product_id, delta: -take });
  await client.query(
    `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reason_code, notes, created_by)
     VALUES ($1,$2,$3,'WASTAGE',$4,'batch',$5,$6,$7)`,
    [businessId, branchId, batch.product_id, -take, reason, note || `Batch ${batch.batch_no}`, userId]);
  return { product_id: batch.product_id, batch_no: batch.batch_no, quantity: take };
};

/* ── the stock center ─────────────────────────────────────────────────────────────────────── */

const STATUSES = ['all', 'out', 'low', 'ok', 'expiring', 'expired'];
const SORTS = { name: 'p.name', stock: 'qty', value: 'cost_value', expiry: 'next_expiry' };

/**
 * One outlet's stock (or the business total in the all-outlets view): a page of products plus summary numbers over the
 * whole selection. `status` is out / low / ok, or expiring / expired (products with a batch in that state).
 */
export const stockCenter = async (db, { tenant, search, categoryId, status = 'all', sort = 'name', dir = 'asc', limit = 50, offset = 0, expiringDays = 30 }, searchClause) => {
  if (!STATUSES.includes(status)) throw new StockError(400, 'Unknown status');
  const businessId = tenant.businessId;
  const today = await businessToday(businessId, db);
  const values = [businessId, today, Math.max(1, Math.min(365, Number(expiringDays) || 30))];
  let join = ''; let qty = 'p.current_stock'; let batchBranch = '';
  if (tenant.scopeBranchId != null) {
    values.push(tenant.scopeBranchId);
    join = `LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $${values.length}`;
    qty = 'COALESCE(bs.quantity, 0)';
    batchBranch = ` AND b.branch_id = $${values.length}`;
  }
  const where = ['p.business_id = $1', 'p.track_inventory', "p.status = 'ACTIVE'", '$2::date IS NOT NULL', '$3::int > 0'];   // every parameter is referenced, whatever the filter
  if (categoryId) { values.push(Number(categoryId)); where.push(`p.category_id = $${values.length}`); }
  const text = searchClause?.(search, values);
  if (text) where.push(text);
  const batchExists = (cond) => `EXISTS (SELECT 1 FROM wholesale_batches b WHERE b.product_id = p.product_id AND b.qty_on_hand > 0 AND b.status = 'ACTIVE'${batchBranch} AND ${cond})`;
  const filter = { out: `${qty} <= 0`, low: `${qty} > 0 AND ${qty} <= p.min_stock`, ok: `${qty} > p.min_stock`,
    expired: batchExists('b.expiry_date < $2::date'), expiring: batchExists('b.expiry_date >= $2::date AND b.expiry_date <= $2::date + $3::int') }[status];
  const base = `FROM products p ${join} WHERE ${where.join(' AND ')}`;

  const summary = (await db.query(
    `SELECT COUNT(*) AS products, COALESCE(SUM(${qty}), 0) AS units, COALESCE(SUM(${qty} * p.purchase_price_paise), 0) AS cost_value,
            COALESCE(SUM(${qty} * COALESCE(p.mrp_paise, p.selling_price_paise)), 0) AS retail_value,
            COUNT(*) FILTER (WHERE ${qty} <= 0) AS out, COUNT(*) FILTER (WHERE ${qty} > 0 AND ${qty} <= p.min_stock) AS low,
            COUNT(*) FILTER (WHERE ${batchExists('b.expiry_date < $2::date')}) AS expired,
            COUNT(*) FILTER (WHERE ${batchExists('b.expiry_date >= $2::date AND b.expiry_date <= $2::date + $3::int')}) AS expiring
     ${base}`, values)).rows[0];

  const rowValues = [...values];
  const clause = filter ? ` AND (${filter})` : '';
  const order = `${SORTS[sort] || SORTS.name} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, p.name`;
  rowValues.push(Math.max(1, Math.min(200, Number(limit) || 50)), Math.max(0, Number(offset) || 0));
  const { rows } = await db.query(
    `SELECT p.product_id, p.name, p.sku, p.barcode, p.unit, p.min_stock, p.track_expiry, p.mrp_paise, p.selling_price_paise, p.purchase_price_paise,
            (SELECT c.name FROM categories c WHERE c.category_id = p.category_id) AS category, ${qty} AS qty, ${qty} * p.purchase_price_paise AS cost_value,
            (SELECT MIN(b.expiry_date)::text FROM wholesale_batches b WHERE b.product_id = p.product_id AND b.qty_on_hand > 0 AND b.status = 'ACTIVE'${batchBranch}) AS next_expiry,
            (SELECT COALESCE(SUM(b.qty_on_hand), 0) FROM wholesale_batches b WHERE b.product_id = p.product_id AND b.qty_on_hand > 0${batchBranch} AND b.expiry_date < $2::date) AS expired_qty
     ${base}${clause} ORDER BY ${order} LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`, rowValues);
  const total = filter ? Number((await db.query(`SELECT COUNT(*) AS n ${base}${clause}`, values)).rows[0].n) : Number(summary.products);
  return { summary, rows, total };
};

/** The ledger across products: what moved, when, by whom, and what it points at. */
export const movements = async (db, { tenant, productId, type, from, to, limit = 100, offset = 0 }) => {
  const values = [tenant.businessId];
  const where = ['t.business_id = $1'];
  if (tenant.scopeBranchId != null) { values.push(tenant.scopeBranchId); where.push(`t.branch_id = $${values.length}`); }
  if (productId) { values.push(Number(productId)); where.push(`t.product_id = $${values.length}`); }
  if (type) { values.push(String(type).toUpperCase()); where.push(`t.transaction_type = $${values.length}`); }
  if (from) { values.push(from); where.push(`t.created_at >= $${values.length}::date`); }
  if (to) { values.push(to); where.push(`t.created_at < $${values.length}::date + 1`); }
  values.push(Math.max(1, Math.min(200, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  const { rows } = await db.query(
    `SELECT t.txn_id, t.created_at, t.transaction_type, t.quantity, t.reference_type, t.reference_id, t.reason_code, t.notes, t.branch_id,
            p.product_id, p.name, p.sku, p.unit, u.name AS by
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id LEFT JOIN users u ON u.user_id = t.created_by
     WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC, t.txn_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
};

/** Batches with stock on hand, soonest expiry first. state: expired | expiring | ok | all. */
export const expiryList = async (db, { tenant, state = 'all', days = 30, search = '', limit = 100, offset = 0 }) => {
  const today = await businessToday(tenant.businessId, db);
  const values = [tenant.businessId, today, Math.max(1, Math.min(365, Number(days) || 30))];
  const where = ['b.business_id = $1', 'b.qty_on_hand > 0', 'b.expiry_date IS NOT NULL', "b.status = 'ACTIVE'", '$3::int > 0'];
  if (tenant.scopeBranchId != null) { values.push(tenant.scopeBranchId); where.push(`b.branch_id = $${values.length}`); }
  if (state === 'expired') where.push('b.expiry_date < $2::date');
  else if (state === 'expiring') where.push('b.expiry_date >= $2::date AND b.expiry_date <= $2::date + $3::int');
  else if (state === 'ok') where.push('b.expiry_date > $2::date + $3::int');
  if (search) { values.push(`%${String(search).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); where.push(`(lower(p.name) LIKE $${values.length} OR lower(b.batch_no) LIKE $${values.length})`); }
  const counts = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE b.expiry_date < $2::date) AS expired, COUNT(*) FILTER (WHERE b.expiry_date >= $2::date AND b.expiry_date <= $2::date + $3::int) AS expiring,
            COALESCE(SUM(b.qty_on_hand * COALESCE(b.cost_paise, p.purchase_price_paise)) FILTER (WHERE b.expiry_date < $2::date), 0) AS expired_value
     FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id
     WHERE b.business_id = $1 AND b.qty_on_hand > 0 AND b.expiry_date IS NOT NULL AND b.status = 'ACTIVE'${tenant.scopeBranchId != null ? ' AND b.branch_id = $4' : ''}`,
    tenant.scopeBranchId != null ? [...values.slice(0, 3), tenant.scopeBranchId] : values.slice(0, 3))).rows[0];
  values.push(Math.max(1, Math.min(200, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  const { rows } = await db.query(
    `SELECT b.batch_id, b.branch_id, br.name AS outlet, p.product_id, p.name, p.sku, p.unit, b.batch_no, b.expiry_date::text AS expiry_date, b.qty_on_hand,
            COALESCE(b.cost_paise, p.purchase_price_paise) AS cost_paise, (b.expiry_date - $2::date) AS days_left
     FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id
     WHERE ${where.join(' AND ')} ORDER BY b.expiry_date, p.name LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  return { counts, rows: rows.map((r) => ({ ...r, qty_on_hand: Number(r.qty_on_hand), days_left: Number(r.days_left) })) };
};

/* ── stock counts ─────────────────────────────────────────────────────────────────────────── */

const openCount = async (db, businessId, countId, { lock = false } = {}) => {
  const row = (await db.query(`SELECT * FROM stock_counts WHERE count_id = $1 AND business_id = $2${lock ? ' FOR UPDATE' : ''}`, [countId, businessId])).rows[0];
  if (!row) throw new StockError(404, 'Not found');
  return row;
};
export const getCount = openCount;

export const createCount = async (db, { tenant, userId, name, categoryId = null, note = null }) => {
  const label = String(name || '').trim().slice(0, 80);
  if (!label) throw new StockError(400, 'Give the count a name, like "Aisle 3" or "Month end"');
  if (categoryId && !(await db.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [categoryId, tenant.businessId])).rowCount) throw new StockError(400, 'Category not found');
  return (await db.query(
    `INSERT INTO stock_counts (business_id, branch_id, name, scope, category_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenant.businessId, tenant.branchId, label, categoryId ? 'CATEGORY' : 'FULL', categoryId || null, note ? String(note).slice(0, 500) : null, userId])).rows[0];
};

/**
 * Record counts. Each entry is { product_id, counted } (set the quantity) or { product_id, add } (count one more, or
 * a case): scanning is a stream of add: 1. The system quantity is read when a product is first counted (and again each
 * time its count is set outright, a fresh look at the shelf), so the variance is "what you found" against "what the
 * system said when you looked", and a sale rung up while you count does not look like a shortage.
 */
export const recordCounts = async (client, { tenant, userId, countId, entries }) => {
  const count = await openCount(client, tenant.businessId, countId, { lock: true });
  if (count.status !== 'OPEN') throw new StockError(409, 'That count is already closed');
  if (!Array.isArray(entries) || !entries.length) throw new StockError(400, 'Nothing to record');
  if (entries.length > 500) throw new StockError(400, 'Send up to 500 lines at a time');
  const ids = [...new Set(entries.map((e) => Number(e.product_id)))];
  const products = new Map((await client.query(
    `SELECT product_id, name, track_inventory, category_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) AND status = 'ACTIVE'`, [tenant.businessId, ids])).rows.map((p) => [p.product_id, p]));
  const here = new Map((await client.query(`SELECT product_id, quantity FROM branch_stock WHERE branch_id = $1 AND product_id = ANY($2::int[])`, [count.branch_id, ids])).rows.map((r) => [r.product_id, Number(r.quantity)]));
  const done = [];
  for (const e of entries) {
    const id = Number(e.product_id); const p = products.get(id);
    if (!p) throw new StockError(404, `Product ${id} not found`);
    if (!p.track_inventory) throw new StockError(400, `${p.name} does not track stock`);
    if (count.scope === 'CATEGORY' && p.category_id !== count.category_id) throw new StockError(400, `${p.name} is not in this count's category`);
    const hasSet = e.counted != null && e.counted !== ''; const hasAdd = e.add != null && e.add !== '';
    if (hasSet === hasAdd) throw new StockError(400, 'Give either counted or add');
    const amount = Number(hasSet ? e.counted : e.add);
    if (!Number.isFinite(amount) || (hasSet && amount < 0) || (hasAdd && amount === 0)) throw new StockError(400, hasSet ? 'Counted must be zero or more' : 'Add must not be zero');
    const row = (await client.query(
      `INSERT INTO stock_count_items (count_id, product_id, system_qty, counted_qty, counted_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (count_id, product_id) DO UPDATE SET ${hasSet ? 'counted_qty = EXCLUDED.counted_qty, system_qty = EXCLUDED.system_qty' : 'counted_qty = GREATEST(0, stock_count_items.counted_qty + $6)'}, counted_by = EXCLUDED.counted_by, updated_at = CURRENT_TIMESTAMP
       RETURNING product_id, system_qty, counted_qty`,
      hasSet ? [countId, id, here.get(id) ?? 0, q3(amount), userId] : [countId, id, here.get(id) ?? 0, Math.max(0, q3(amount)), userId, q3(amount)])).rows[0];
    done.push({ product_id: id, name: p.name, system_qty: Number(row.system_qty), counted_qty: Number(row.counted_qty), variance: q3(Number(row.counted_qty) - Number(row.system_qty)) });
  }
  return done;
};

/** The count with its variance: counted lines, what is still uncounted in scope, and the value of the difference at cost. */
export const countDetail = async (db, { tenant, countId, onlyVariance = false, limit = 200, offset = 0 }) => {
  const count = await openCount(db, tenant.businessId, countId);
  const base = `FROM stock_count_items i JOIN products p ON p.product_id = i.product_id WHERE i.count_id = $1`;
  const totals = (await db.query(
    `SELECT COUNT(*) AS lines, COUNT(*) FILTER (WHERE i.counted_qty <> i.system_qty) AS variance_lines,
            COALESCE(SUM(GREATEST(i.system_qty - i.counted_qty, 0)), 0) AS short_units, COALESCE(SUM(GREATEST(i.counted_qty - i.system_qty, 0)), 0) AS extra_units,
            COALESCE(SUM((i.counted_qty - i.system_qty) * p.purchase_price_paise), 0) AS net_value_paise ${base}`, [countId])).rows[0];
  const scopeSql = count.scope === 'CATEGORY' ? ' AND p.category_id = $3' : '';
  const uncounted = Number((await db.query(
    `SELECT COUNT(*) AS n FROM products p WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE'${scopeSql}
       AND NOT EXISTS (SELECT 1 FROM stock_count_items i WHERE i.count_id = $2 AND i.product_id = p.product_id)`,
    count.scope === 'CATEGORY' ? [tenant.businessId, countId, count.category_id] : [tenant.businessId, countId])).rows[0].n);
  const { rows } = await db.query(
    `SELECT p.product_id, p.name, p.sku, p.barcode, p.unit, p.purchase_price_paise, i.system_qty, i.counted_qty, (i.counted_qty - i.system_qty) AS variance, i.updated_at
     ${base}${onlyVariance ? ' AND i.counted_qty <> i.system_qty' : ''} ORDER BY i.updated_at DESC, p.name LIMIT $2 OFFSET $3`,
    [countId, Math.max(1, Math.min(500, Number(limit) || 200)), Math.max(0, Number(offset) || 0)]);
  return { count, totals, uncounted, rows: rows.map((r) => ({ ...r, system_qty: Number(r.system_qty), counted_qty: Number(r.counted_qty), variance: Number(r.variance) })) };
};

/**
 * Turn a count into stock. Each counted line moves stock by (counted − what the system held when it was counted) as a
 * COUNT movement; `zeroUncounted` also zeroes the products in scope nobody counted (a deliberate choice, off by default).
 */
export const applyCount = async (client, { tenant, userId, countId, zeroUncounted = false }) => {
  const count = await openCount(client, tenant.businessId, countId, { lock: true });
  if (count.status !== 'OPEN') throw new StockError(409, 'That count is already closed');
  if (zeroUncounted) {
    const params = [tenant.businessId, countId, count.branch_id, userId];
    await client.query(
      `INSERT INTO stock_count_items (count_id, product_id, system_qty, counted_qty, counted_by)
       SELECT $2, p.product_id, COALESCE(bs.quantity, 0), 0, $4 FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $3
       WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND COALESCE(bs.quantity, 0) <> 0${count.scope === 'CATEGORY' ? ' AND p.category_id = $5' : ''}
         AND NOT EXISTS (SELECT 1 FROM stock_count_items i WHERE i.count_id = $2 AND i.product_id = p.product_id)`,
      count.scope === 'CATEGORY' ? [...params, count.category_id] : params);
  }
  const lines = (await client.query(
    `SELECT i.product_id, i.counted_qty - i.system_qty AS delta, p.purchase_price_paise FROM stock_count_items i JOIN products p ON p.product_id = i.product_id
     WHERE i.count_id = $1 AND i.counted_qty <> i.system_qty ORDER BY i.product_id FOR UPDATE OF p`, [countId])).rows;
  let net = 0; let value = 0;
  for (const l of lines) {
    const delta = q3(l.delta);
    await moveStock(client, { businessId: tenant.businessId, branchId: count.branch_id, productId: l.product_id, delta });
    await client.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, notes, created_by)
       VALUES ($1,$2,$3,'COUNT',$4,'stock_count',$5,$6,$7)`, [tenant.businessId, count.branch_id, l.product_id, delta, countId, `Stock count: ${count.name}`, userId]);
    net = q3(net + delta); value += Math.round(delta * Number(l.purchase_price_paise));
  }
  const closed = (await client.query(
    `UPDATE stock_counts SET status = 'APPLIED', applied_by = $2, applied_at = CURRENT_TIMESTAMP, lines_adjusted = $3, net_units = $4, net_value_paise = $5 WHERE count_id = $1 RETURNING *`,
    [countId, userId, lines.length, net, value])).rows[0];
  return closed;
};

export const cancelCount = async (db, { tenant, countId }) => {
  const count = await openCount(db, tenant.businessId, countId, { lock: true });
  if (count.status !== 'OPEN') throw new StockError(409, 'That count is already closed');
  return (await db.query(`UPDATE stock_counts SET status = 'CANCELLED' WHERE count_id = $1 RETURNING *`, [countId])).rows[0];
};

export const listCounts = async (db, { tenant, status }) => {
  const values = [tenant.businessId]; const where = ['c.business_id = $1'];
  if (tenant.scopeBranchId != null) { values.push(tenant.scopeBranchId); where.push(`c.branch_id = $${values.length}`); }
  if (status) { values.push(String(status).toUpperCase()); where.push(`c.status = $${values.length}`); }
  return (await db.query(
    `SELECT c.*, (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = c.count_id) AS lines, cat.name AS category, b.name AS outlet
     FROM stock_counts c LEFT JOIN categories cat ON cat.category_id = c.category_id JOIN branches b ON b.branch_id = c.branch_id
     WHERE ${where.join(' AND ')} ORDER BY (c.status = 'OPEN') DESC, c.created_at DESC LIMIT 100`, values)).rows;
};
