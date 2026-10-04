/*
 * Retail stock center: the overview, the ledger, expiry, stock counts and spreadsheet imports.
 * (Receiving goods is POST /api/purchases, which now carries batch and expiry; adjustments and wastage stay in /api/inventory.)
 * All of it is for a SUPERMARKET or RETAIL business and sits behind the `inventory` permission.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { searchClause } from '../modules/productIdentity.js';
import {
  StockError, applyCount, cancelCount, countDetail, createCount, expiryList, listCounts, movements, recordCounts, stockCenter, writeOffBatch
} from '../modules/retailStock.js';
import { importProducts, importStock } from '../modules/retailImport.js';
import { toRupees } from '../utils/money.js';

const fail = (res, error) => {
  if (error instanceof StockError) return res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}) });
  throw error;
};
const handle = (fn) => async (req, res) => { try { await fn(req, res); } catch (error) { fail(res, error); } };

/** Run `fn(client)` in one transaction; the connection always goes back. */
const inTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const money = (paise) => toRupees(Number(paise || 0));
const meta = (total, limit, offset) => ({ total, limit, offset });

/* GET /api/retail/stock?search=&category_id=&status=&sort=&dir=&limit=&offset= */
export const stock = handle(async (req, res) => {
  const q = req.query;
  const { summary, rows, total } = await stockCenter(pool, {
    tenant: req.tenant, search: q.search, categoryId: q.category_id, status: q.status || 'all', sort: q.sort, dir: q.dir, limit: q.limit, offset: q.offset, expiringDays: q.days
  }, searchClause);
  res.json({
    success: true,
    data: {
      summary: {
        products: Number(summary.products), units: Number(summary.units), cost_value: money(summary.cost_value), retail_value: money(summary.retail_value),
        out: Number(summary.out), low: Number(summary.low), expiring: Number(summary.expiring), expired: Number(summary.expired)
      },
      rows: rows.map((r) => ({
        product_id: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode, unit: r.unit, category: r.category, track_expiry: r.track_expiry,
        qty: Number(r.qty), min_stock: Number(r.min_stock), cost_value: money(r.cost_value), cost: money(r.purchase_price_paise),
        mrp: r.mrp_paise == null ? null : money(r.mrp_paise), price: money(r.selling_price_paise), next_expiry: r.next_expiry, expired_qty: Number(r.expired_qty),
        state: Number(r.qty) <= 0 ? 'out' : Number(r.qty) <= Number(r.min_stock) ? 'low' : 'ok'
      })),
      meta: meta(total, Number(q.limit) || 50, Number(q.offset) || 0)
    }
  });
});

/* GET /api/retail/stock/movements?product_id=&type=&from=&to= */
export const ledger = handle(async (req, res) => {
  const q = req.query;
  res.json({ success: true, data: await movements(pool, { tenant: req.tenant, productId: q.product_id, type: q.type, from: q.from, to: q.to, limit: q.limit, offset: q.offset }) });
});

/* GET /api/retail/expiry?state=expired|expiring|ok|all&days=30&search= */
export const expiry = handle(async (req, res) => {
  const q = req.query;
  const { counts, rows } = await expiryList(pool, { tenant: req.tenant, state: q.state || 'all', days: q.days, search: q.search, limit: q.limit, offset: q.offset });
  res.json({
    success: true,
    data: {
      summary: { expired: Number(counts.expired), expiring: Number(counts.expiring), expired_value: money(counts.expired_value) },
      rows: rows.map((r) => ({ ...r, cost: money(r.cost_paise), value: money(Math.round(r.qty_on_hand * Number(r.cost_paise))) }))
    }
  });
});

/* POST /api/retail/expiry/:batchId/write-off { quantity? } — an expired batch leaves the shelf (wastage, reason EXPIRED) */
export const writeOff = handle(async (req, res) => {
  const out = await inTransaction((client) => writeOffBatch(client, {
    businessId: req.tenant.businessId, branchId: req.tenant.branchId, batchId: Number(req.params.batchId),
    qty: req.body?.quantity == null || req.body.quantity === '' ? null : Number(req.body.quantity), userId: req.auth.userId, note: req.body?.note ? String(req.body.note).slice(0, 200) : null
  }));
  recordAudit(req, { action: 'inventory.batch_written_off', resource_type: 'product', resource_id: out.product_id, metadata: { batch: out.batch_no, quantity: out.quantity } });
  res.json({ success: true, data: out });
});

/* ── counts ─────────────────────────────────────────────────────────────────────────────── */

const countRow = (c) => ({
  count_id: c.count_id, name: c.name, status: c.status, scope: c.scope, category: c.category ?? null, outlet: c.outlet ?? null, note: c.note,
  lines: c.lines == null ? undefined : Number(c.lines), created_at: c.created_at, applied_at: c.applied_at,
  lines_adjusted: c.lines_adjusted, net_units: c.net_units == null ? null : Number(c.net_units), net_value: c.net_value_paise == null ? null : money(c.net_value_paise)
});

export const counts = handle(async (req, res) => {
  res.json({ success: true, data: (await listCounts(pool, { tenant: req.tenant, status: req.query.status })).map(countRow) });
});

export const startCount = handle(async (req, res) => {
  const row = await createCount(pool, { tenant: req.tenant, userId: req.auth.userId, name: req.body?.name, categoryId: req.body?.category_id, note: req.body?.note });
  recordAudit(req, { action: 'stock_count.started', resource_type: 'stock_count', resource_id: row.count_id, metadata: { name: row.name, scope: row.scope } });
  res.status(201).json({ success: true, data: countRow(row) });
});

export const getCount = handle(async (req, res) => {
  const d = await countDetail(pool, { tenant: req.tenant, countId: Number(req.params.id), onlyVariance: req.query.variance === 'true', limit: req.query.limit, offset: req.query.offset });
  res.json({
    success: true,
    data: {
      ...countRow(d.count), uncounted: d.uncounted,
      totals: { lines: Number(d.totals.lines), variance_lines: Number(d.totals.variance_lines), short_units: Number(d.totals.short_units), extra_units: Number(d.totals.extra_units), net_value: money(d.totals.net_value_paise) },
      items: d.rows.map((r) => ({ ...r, cost: money(r.purchase_price_paise) }))
    }
  });
});

export const countItems = handle(async (req, res) => {
  const done = await inTransaction((client) => recordCounts(client, { tenant: req.tenant, userId: req.auth.userId, countId: Number(req.params.id), entries: req.body?.items }));
  res.json({ success: true, data: done });
});

export const finishCount = handle(async (req, res) => {
  const row = await inTransaction((client) => applyCount(client, { tenant: req.tenant, userId: req.auth.userId, countId: Number(req.params.id), zeroUncounted: req.body?.zero_uncounted === true }));
  recordAudit(req, { action: 'stock_count.applied', resource_type: 'stock_count', resource_id: row.count_id, metadata: { lines_adjusted: row.lines_adjusted, net_units: Number(row.net_units), zero_uncounted: req.body?.zero_uncounted === true } });
  res.json({ success: true, data: countRow(row) });
});

export const dropCount = handle(async (req, res) => {
  const row = await inTransaction((client) => cancelCount(client, { tenant: req.tenant, countId: Number(req.params.id) }));
  recordAudit(req, { action: 'stock_count.cancelled', resource_type: 'stock_count', resource_id: row.count_id });
  res.json({ success: true, data: countRow(row) });
});

/* ── imports ────────────────────────────────────────────────────────────────────────────── */

const importResult = (res, req, kind, out) => {
  if (out.applied) recordAudit(req, { action: `retail.import_${kind}`, resource_type: 'product', metadata: { rows: out.rows, created: out.created, updated: out.updated, changed: out.changed } });
  if (req.body?.apply && out.total_errors) {
    return res.status(422).json({ success: false, message: `${out.total_errors} row${out.total_errors === 1 ? ' has' : 's have'} a problem. Nothing was imported.`, data: { errors: out.errors, total_errors: out.total_errors } });
  }
  return res.json({ success: true, data: out });
};

/* POST /api/retail/import/products { rows, mode: 'create'|'upsert', apply? } */
export const importProductRows = handle(async (req, res) => {
  const { rows, mode, apply } = req.body || {};
  const run = (db) => importProducts(db, { tenant: req.tenant, userId: req.auth.userId, rows, mode, apply: apply === true });
  importResult(res, req, 'products', apply === true ? await inTransaction(run) : await run(pool));
});

/* POST /api/retail/import/stock { rows, mode: 'add'|'set', apply? } */
export const importStockRows = handle(async (req, res) => {
  const { rows, mode, apply } = req.body || {};
  const run = (db) => importStock(db, { tenant: req.tenant, userId: req.auth.userId, rows, mode, apply: apply === true });
  importResult(res, req, 'stock', apply === true ? await inTransaction(run) : await run(pool));
});
