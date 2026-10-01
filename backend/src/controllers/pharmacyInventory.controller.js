/*
 * Pharmacy inventory: stock on hand, and the batch/expiry ledger GRN posts into (see
 * modules/pharmacy/stock.js — the same wholesale_batches table every batch-tracked product in the app shares).
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { PharmacyError, audit, getSettings, ok, oneOf, page, paging, text, wrapAll } from '../modules/pharmacy/common.js';

const rupees = (v) => toRupees(Number(v || 0));
const BATCH_STATES = ['ACTIVE', 'QUARANTINED', 'RECALLED', 'BLOCKED'];

/* GET /api/pharmacy/inventory/stock?q=&low_stock=1&limit=&offset= — the shelf, one row per product */
const stock = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = [`p.business_id = $1`, `p.track_inventory`];
  if (req.query.q) { values.push(`%${String(req.query.q).trim().slice(0, 80)}%`); where.push(`p.name ILIKE $${values.length}`); }
  // one scope parameter, referenced twice below (pg allows reusing a positional placeholder) — simpler and
  // safer than renumbering branchFilter()'s own placeholder for reuse inside two correlated subqueries
  let branchClause = '';
  if (req.tenant.scopeBranchId != null) { values.push(req.tenant.scopeBranchId); branchClause = ` AND bs.branch_id = $${values.length}`; }
  const base = `FROM products p LEFT JOIN pharmacy_item_details d ON d.product_id = p.product_id WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  const limitIdx = values.length + 1; const offsetIdx = values.length + 2;
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `SELECT p.product_id, p.name, p.unit, p.min_stock, d.product_type, d.batch_tracking, d.expiry_tracking,
            COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.product_id${branchClause}), 0) AS on_hand,
            COALESCE((SELECT SUM(bs.reserved_qty) FROM branch_stock bs WHERE bs.product_id = p.product_id${branchClause}), 0) AS reserved
     ${base} ORDER BY p.name LIMIT $${limitIdx} OFFSET $${offsetIdx}`, values)).rows;
  page(res, rows.map((r) => {
    const onHand = Number(r.on_hand); const reserved = Number(r.reserved); const available = Math.max(0, Math.round((onHand - reserved) * 1000) / 1000);
    return { product_id: r.product_id, name: r.name, unit: r.unit, product_type: r.product_type || 'OTHER', batch_tracking: r.batch_tracking, expiry_tracking: r.expiry_tracking,
      on_hand: onHand, reserved, available, reorder_level: Number(r.min_stock), low: Number(r.min_stock) > 0 && available <= Number(r.min_stock) };
  }), total, pg);
};

/* GET /api/pharmacy/inventory/batches?product_id=&state=active|expiring|expired|quarantined|recalled|blocked */
const batches = async (req, res) => {
  const values = [req.tenant.businessId]; const where = [`b.business_id = $1`, `b.qty_on_hand > 0`];
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`b.branch_id = $${values.length}`); }
  if (req.query.product_id) { values.push(Number(req.query.product_id)); where.push(`b.product_id = $${values.length}`); }
  const state = String(req.query.state || '').toLowerCase();
  if (state === 'expired') where.push(`b.expiry_date < CURRENT_DATE`);
  else if (state === 'expiring') {
    const settings = await getSettings(pool, req.tenant.businessId);
    const days = Math.max(...settings.expiry_alert_days, 30);
    values.push(days); where.push(`b.expiry_date >= CURRENT_DATE AND b.expiry_date <= CURRENT_DATE + ($${values.length})::int`);
  } else if (['quarantined', 'recalled', 'blocked'].includes(state)) { where.push(`b.status = '${state.toUpperCase()}'`); }
  else if (state === 'active') where.push(`b.status = 'ACTIVE' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)`);
  const rows = (await pool.query(
    `SELECT b.batch_id, b.product_id, p.name AS product, p.unit, b.batch_no, b.mfg_date, b.expiry_date, b.qty_on_hand, b.cost_paise, b.status, br.name AS branch
     FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id
     WHERE ${where.join(' AND ')} ORDER BY b.expiry_date NULLS LAST, b.batch_id LIMIT 500`, values)).rows;
  ok(res, rows.map((r) => ({ batch_id: r.batch_id, product_id: r.product_id, product: r.product, unit: r.unit, batch_no: r.batch_no, mfg_date: r.mfg_date, expiry_date: r.expiry_date, qty_on_hand: Number(r.qty_on_hand), cost: rupees(r.cost_paise), status: r.status, branch: r.branch })));
};

/* GET /api/pharmacy/inventory/expiry — dashboard buckets, per pharmacy_settings.expiry_alert_days */
const expirySummary = async (req, res) => {
  const settings = await getSettings(pool, req.tenant.businessId);
  const values = [req.tenant.businessId]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ` AND branch_id = $2`; }
  const expired = Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_batches WHERE business_id = $1 AND qty_on_hand > 0 AND expiry_date < CURRENT_DATE${scope}`, values)).rows[0].n);
  const buckets = [];
  for (const days of settings.expiry_alert_days) {
    const n = Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_batches WHERE business_id = $1 AND qty_on_hand > 0 AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + $${values.length + 1}::int${scope}`, [...values, days])).rows[0].n);
    buckets.push({ days, batches: n });
  }
  ok(res, { expired, buckets });
};

/* POST /api/pharmacy/inventory/batches/:id/status { status, reason? } — quarantine / recall / block / reactivate */
const setBatchStatus = async (req, res) => {
  const status = oneOf(req.body?.status, 'Status', BATCH_STATES, { required: true });
  const reason = text(req.body?.reason, 'Reason', { max: 200 });
  const row = (await pool.query(`UPDATE wholesale_batches SET status = $3 WHERE batch_id = $1 AND business_id = $2 RETURNING batch_id, batch_no, product_id, status`, [req.params.id, req.tenant.businessId, status])).rows[0];
  if (!row) throw new PharmacyError(404, 'Not found');
  audit(req, 'pharmacy.batch_status_changed', 'batch', row.batch_id, null, null, { batch_no: row.batch_no, status, reason: reason || null });
  ok(res, row);
};

export default wrapAll({ stock, batches, expirySummary, setBatchStatus });
