/*
 * Stock levels and manual adjustments.
 *
 * Sales and purchases move stock automatically as a side effect of billing
 * and buying (see invoices.controller.js and purchases.controller.js). This
 * file is for the movements nothing else causes: a stock count that finds
 * three fewer units than the system thinks, damage, a transfer written by
 * hand. Every adjustment goes through the same ledger those automatic moves
 * do, so "why does this product show 12" always has one place to look.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toRupees } from '../utils/money.js';
import { moveStock, stockAt } from '../modules/stock.js';
import { branchFilter } from '../utils/scope.js';

/* ==========================================================================
   GET /api/inventory — current levels
   ========================================================================== */
export const levels = async (req, res) => {
  const { low_stock } = req.query;
  // At one outlet: that outlet's stock. In the all-outlets view: the business total.
  const values = [req.tenant.businessId];
  let join = ''; let qty = 'p.current_stock';
  if (req.tenant.scopeBranchId != null) {
    values.push(req.tenant.scopeBranchId);
    join = 'LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2';
    qty = 'COALESCE(bs.quantity, 0)';
  }
  const clauses = ['p.business_id = $1', 'p.track_inventory', "p.status = 'ACTIVE'"];
  if (low_stock === 'true') clauses.push(`${qty} <= p.min_stock`);

  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.unit, ${qty} AS current_stock, p.min_stock, p.purchase_price_paise
     FROM products p ${join} WHERE ${clauses.join(' AND ')} ORDER BY p.name`,
    values
  );

  res.json({
    success: true,
    data: rows.map((r) => ({
      product_id: r.product_id, name: r.name, unit: r.unit,
      current_stock: Number(r.current_stock), min_stock: Number(r.min_stock),
      low_stock: Number(r.current_stock) <= Number(r.min_stock),
      stock_value: toRupees(Number(r.current_stock) * Number(r.purchase_price_paise))
    }))
  });
};

/* Total cost of what is on the shelf — the "inventory valuation" the brief
   asks for, at purchase cost rather than selling price: valuing stock at what
   it would sell for counts profit that has not happened yet. */
export const valuation = async (req, res) => {
  const scoped = req.tenant.scopeBranchId != null;
  const { rows } = await pool.query(
    scoped
      ? `SELECT COALESCE(SUM(bs.quantity * p.purchase_price_paise), 0) AS value_paise, COUNT(*) AS product_count
         FROM products p JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2
         WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE'`
      : `SELECT COALESCE(SUM(current_stock * purchase_price_paise), 0) AS value_paise, COUNT(*) AS product_count
         FROM products WHERE business_id = $1 AND track_inventory AND status = 'ACTIVE'`,
    scoped ? [req.tenant.businessId, req.tenant.scopeBranchId] : [req.tenant.businessId]
  );
  res.json({ success: true, data: { total_value: toRupees(rows[0].value_paise), product_count: Number(rows[0].product_count) } });
};

/* ==========================================================================
   GET /api/inventory/:productId/history
   ========================================================================== */
export const history = async (req, res) => {
  const owns = await pool.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [req.params.productId, req.tenant.businessId]);
  if (!owns.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const values = [req.params.productId];
  const { rows } = await pool.query(
    `SELECT txn_id, branch_id, transaction_type, quantity, reference_type, reference_id, notes, created_at
     FROM inventory_transactions WHERE product_id = $1${branchFilter(req.tenant, 'branch_id', values)} ORDER BY created_at DESC, txn_id DESC LIMIT 200`,
    values
  );
  res.json({ success: true, data: rows.map((r) => ({ ...r, quantity: Number(r.quantity) })) });
};

/* ==========================================================================
   POST /api/inventory/adjust
   ========================================================================== */
export const adjust = async (req, res) => {
  const body = req.body || {};
  const quantity = Number(body.quantity);
  if (!body.product_id || !Number.isFinite(quantity) || quantity === 0) {
    return res.status(400).json({ success: false, message: 'Choose a product and a non-zero quantity' });
  }
  if (!body.reason || !String(body.reason).trim()) {
    return res.status(400).json({ success: false, message: 'Say why you are adjusting stock' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT product_id, name, current_stock, track_inventory FROM products
       WHERE product_id = $1 AND business_id = $2 FOR UPDATE`,
      [body.product_id, req.tenant.businessId]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    const product = rows[0];
    if (!product.track_inventory) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `${product.name} does not track stock` }); }

    const here = (await stockAt(client, req.tenant.branchId, [product.product_id])).get(product.product_id);
    const newStock = here + quantity;
    if (newStock < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `That would take ${product.name} below zero stock` });
    }

    await moveStock(client, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, productId: product.product_id, delta: quantity });
    await client.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, notes, created_by)
       VALUES ($1,$2,$3,'ADJUSTMENT',$4,'manual',$5,$6)`,
      [req.tenant.businessId, req.tenant.branchId, product.product_id, quantity, String(body.reason).trim(), req.auth.userId]
    );

    await client.query('COMMIT');
    recordAudit(req, { action: 'inventory.adjusted', resource_type: 'product', resource_id: product.product_id, metadata: { quantity, reason: body.reason } });
    res.json({ success: true, data: { current_stock: newStock } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[inventory] adjust failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not adjust stock' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/inventory/wastage — stock that was thrown away, spoiled or lost

   A ledger movement like any other (type WASTAGE, negative), with a reason
   code so "why is tomato wastage rising" is a query, not a guess. Unlike
   adjust(), this may take stock below zero: the food is already gone.
   ========================================================================== */
const WASTAGE_REASONS = ['SPOILAGE', 'EXPIRED', 'DAMAGED', 'PREPARATION', 'OVERPRODUCTION', 'OTHER'];

export const recordWastage = async (req, res) => {
  const body = req.body || {};
  const quantity = Number(body.quantity);
  if (!body.product_id || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ success: false, message: 'Choose a product and a quantity above zero' });
  }
  if (!WASTAGE_REASONS.includes(body.reason_code)) {
    return res.status(400).json({ success: false, message: 'Choose a reason' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT product_id, name, track_inventory, purchase_price_paise FROM products
       WHERE product_id = $1 AND business_id = $2 FOR UPDATE`,
      [body.product_id, req.tenant.businessId]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (!rows[0].track_inventory) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `${rows[0].name} does not track stock` }); }

    await moveStock(client, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, productId: rows[0].product_id, delta: -quantity });
    await client.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reason_code, notes, created_by)
       VALUES ($1,$2,$3,'WASTAGE',$4,'manual',$5,$6,$7)`,
      [req.tenant.businessId, req.tenant.branchId, rows[0].product_id, -quantity, body.reason_code, body.notes ? String(body.notes).trim() : null, req.auth.userId]
    );
    await client.query('COMMIT');
    recordAudit(req, { action: 'inventory.wastage', resource_type: 'product', resource_id: rows[0].product_id, metadata: { quantity, reason_code: body.reason_code } });
    res.status(201).json({ success: true, data: { estimated_cost: toRupees(Math.round(quantity * Number(rows[0].purchase_price_paise))) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* GET /api/inventory/wastage?from=&to= — totals by reason and by product, with estimated cost */
export const wastageSummary = async (req, res) => {
  const { from, to } = req.query;
  const values = [req.tenant.businessId];
  let range = '';
  if (from) { values.push(from); range += ` AND t.created_at >= $${values.length}`; }
  if (to) { values.push(to); range += ` AND t.created_at < ($${values.length}::date + 1)`; }
  range += branchFilter(req.tenant, 't.branch_id', values);

  const { rows } = await pool.query(
    `SELECT t.reason_code, t.product_id, p.name, p.unit,
            SUM(-t.quantity) AS quantity, SUM(-t.quantity * p.purchase_price_paise) AS cost_paise, COUNT(*) AS events
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
     WHERE t.business_id = $1 AND t.transaction_type = 'WASTAGE'${range}
     GROUP BY t.reason_code, t.product_id, p.name, p.unit
     ORDER BY cost_paise DESC`,
    values
  );
  const lines = rows.map((r) => ({
    reason_code: r.reason_code, product_id: r.product_id, name: r.name, unit: r.unit,
    quantity: Number(r.quantity), events: Number(r.events), cost: toRupees(Math.round(Number(r.cost_paise)))
  }));
  const byReason = {};
  for (const l of lines) byReason[l.reason_code] = Math.round(((byReason[l.reason_code] || 0) + l.cost) * 100) / 100;
  res.json({ success: true, data: { total_cost: Math.round(lines.reduce((s, l) => s + l.cost, 0) * 100) / 100, by_reason: byReason, lines } });
};

/* ==========================================================================
   POST /api/inventory/transfer — move stock from one outlet to another

   Two ledger rows (out of the source, into the destination) so each outlet's
   history explains its own stock; the business total does not change. A user
   pinned to one outlet may only send from their own.
   ========================================================================== */
export const transfer = async (req, res) => {
  const body = req.body || {};
  const from = Number(body.from_branch_id); const to = Number(body.to_branch_id);
  const quantity = Number(body.quantity);
  if (!body.product_id || !Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ success: false, message: 'Choose a product and a quantity above zero' });
  if (!from || !to || from === to) return res.status(400).json({ success: false, message: 'Choose two different outlets' });
  if (req.tenant.pinned && from !== req.tenant.branchId) return res.status(403).json({ success: false, message: 'You can only send stock from your own outlet' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outlets = (await client.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND status = 'ACTIVE' AND branch_id = ANY($2::int[])`, [req.tenant.businessId, [from, to]])).rows;
    if (outlets.length !== 2) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    const { rows } = await client.query(
      `SELECT product_id, name, track_inventory FROM products WHERE product_id = $1 AND business_id = $2 FOR UPDATE`,
      [body.product_id, req.tenant.businessId]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (!rows[0].track_inventory) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `${rows[0].name} does not track stock` }); }

    const have = (await stockAt(client, from, [rows[0].product_id])).get(rows[0].product_id);
    if (have < quantity) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, message: `Only ${have} of ${rows[0].name} at the sending outlet` }); }

    const note = body.notes ? String(body.notes).trim().slice(0, 200) : null;
    const t = (await client.query(
      `INSERT INTO stock_transfers (business_id, from_branch_id, to_branch_id, product_id, quantity, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING transfer_id`,
      [req.tenant.businessId, from, to, rows[0].product_id, quantity, note, req.auth.userId]
    )).rows[0];
    for (const [branchId, delta] of [[from, -quantity], [to, quantity]]) {
      await moveStock(client, { businessId: req.tenant.businessId, branchId, productId: rows[0].product_id, delta });
      await client.query(
        `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, notes, created_by)
         VALUES ($1,$2,$3,'TRANSFER',$4,'stock_transfer',$5,$6,$7)`,
        [req.tenant.businessId, branchId, rows[0].product_id, delta, t.transfer_id, note, req.auth.userId]
      );
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'inventory.transferred', resource_type: 'product', resource_id: rows[0].product_id, metadata: { from, to, quantity } });
    res.status(201).json({ success: true, data: { transfer_id: t.transfer_id } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* GET /api/inventory/transfers — recent transfers touching the outlet(s) the user may see */
export const transfers = async (req, res) => {
  const values = [req.tenant.businessId];
  let scope = '';
  if (req.tenant.scopeBranchId != null) { values.push(req.tenant.scopeBranchId); scope = ` AND (t.from_branch_id = $2 OR t.to_branch_id = $2)`; }
  const { rows } = await pool.query(
    `SELECT t.transfer_id, t.quantity, t.notes, t.created_at, p.name AS product, p.unit, f.name AS from_outlet, d.name AS to_outlet
     FROM stock_transfers t JOIN products p ON p.product_id = t.product_id
     JOIN branches f ON f.branch_id = t.from_branch_id JOIN branches d ON d.branch_id = t.to_branch_id
     WHERE t.business_id = $1${scope} ORDER BY t.created_at DESC, t.transfer_id DESC LIMIT 100`,
    values
  );
  res.json({ success: true, data: rows.map((r) => ({ ...r, quantity: Number(r.quantity) })) });
};
