/*
 * Salon stock: stock-in with a batch and expiry, the batch list, and the alerts (low, out, expiring, expired,
 * negative, unusual consumption).
 *
 * Stock itself — levels, counts, wastage, transfers, purchase orders, returns — is FlowXP's existing inventory
 * and buying; none of it is duplicated here. A salon reaches them through the same screens. What this adds is the
 * batch/expiry layer (modules/salon/stock.js) and one place that says what needs attention.
 */
import pool from '../config/database.js';
import { moveStock } from '../modules/stock.js';
import { businessToday } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';
import { batchPositions } from '../modules/salon/stock.js';
import { computeAlerts } from '../modules/salon/alerts.js';
import { SalonError, audit, isoDate, money, num, ok, oneOf, text, int, wrapAll } from '../modules/salon/common.js';

/* POST /api/salon/stock/in { product_id, quantity, batch_no?, expiry_date?, unit_cost?, reason: OPENING | ADJUSTMENT, note? } */
const stockIn = async (req, res) => {
  const b = req.body || {};
  const productId = int(b.product_id, 'Product', { min: 1, required: true });
  const quantity = num(b.quantity, 'Quantity', { min: 0.001, max: 100000000, required: true });
  const batchNo = text(b.batch_no, 'Batch number', { max: 40 });
  const expiry = isoDate(b.expiry_date, 'Expiry date');
  const unitCost = b.unit_cost == null || b.unit_cost === '' ? null : money(b.unit_cost, 'Cost', { min: 0 });
  const reason = oneOf(b.reason, 'Reason', ['OPENING', 'ADJUSTMENT'], { fallback: 'OPENING' });
  const note = text(b.note, 'Note', { max: 200 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = (await client.query(`SELECT product_id, name, track_inventory FROM products WHERE product_id = $1 AND business_id = $2 AND status = 'ACTIVE' FOR UPDATE`, [productId, req.tenant.businessId])).rows[0];
    if (!p) throw new SalonError(404, 'Not found');
    if (!p.track_inventory) throw new SalonError(409, `${p.name} is not tracked in stock`);
    await moveStock(client, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, productId, delta: quantity });
    await client.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7)`, [req.tenant.businessId, req.tenant.branchId, productId, reason, quantity, note, req.auth.userId]);
    let batch = null;
    if (batchNo || expiry) {
      batch = (await client.query(
        `INSERT INTO salon_stock_batches (business_id, branch_id, product_id, batch_no, expiry_date, qty_received, unit_cost_paise, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING batch_id`,
        [req.tenant.businessId, req.tenant.branchId, productId, batchNo, expiry, quantity, unitCost, reason === 'OPENING' ? 'OPENING' : 'MANUAL', req.auth.userId])).rows[0];
    }
    await client.query('COMMIT');
    audit(req, 'salon.stock_in', 'product', productId, null, { quantity, batch_no: batchNo, expiry_date: expiry }, { name: p.name, reason });
    ok(res, { product_id: productId, added: quantity, batch_id: batch?.batch_id ?? null }, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* GET /api/salon/stock/batches?product_id=&include_empty=1 */
const batches = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  const rows = await batchPositions(pool, req.tenant.businessId, {
    branchId: req.tenant.scopeBranchId, productId: req.query.product_id ? Number(req.query.product_id) : null, today
  });
  const showAll = req.query.include_empty === '1' || req.query.include_empty === 'true';
  ok(res, rows.filter((b) => showAll || b.remaining > 0).map((b) => ({
    batch_id: b.batch_id, branch_id: b.branch_id, branch: b.branch, product_id: b.product_id, product: b.product, unit: b.unit, batch_no: b.batch_no,
    expiry_date: b.expiry_date, days_to_expiry: b.days_to_expiry, received: Number(b.qty_received), remaining: b.remaining,
    unit_cost: b.unit_cost_paise == null ? null : toRupees(b.unit_cost_paise), received_on: b.received_on, source: b.source,
    status: b.expiry_date == null ? 'NO_EXPIRY' : b.days_to_expiry < 0 ? 'EXPIRED' : 'OK'
  })));
};

/* GET /api/salon/alerts — what needs attention in stock, with counts for the dashboard cards */
const alerts = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  ok(res, await computeAlerts(pool, req.tenant.businessId, { scope: req.tenant.scopeBranchId, today }));
};

export default wrapAll({ stockIn, batches, alerts });
