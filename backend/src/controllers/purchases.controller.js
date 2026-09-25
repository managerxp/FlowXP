/*
 * Purchases: stock and supplier payables coming in.
 *
 * The mirror image of invoices.controller.js — one transaction claims a PO
 * number, writes the order and its lines, and moves stock, this time upward.
 * GST is computed the same way a sale's is (see modules/tax.js); the
 * difference is only which side of the business the tax sits on.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { computeLineTax, isInterState, sumLines } from '../modules/tax.js';
import { toPaise, toRupees, toQuantity } from '../utils/money.js';
import { moveStock } from '../modules/stock.js';
import { branchFilter } from '../utils/scope.js';

export const paymentStatus = (totalPaise, paidPaise) => {
  if (paidPaise <= 0) return 'UNPAID';
  return paidPaise >= totalPaise ? 'PAID' : 'PARTIAL';
};

export const asPO = (row) => ({
  po_id: row.po_id,
  po_number: row.po_number,
  po_date: row.po_date,
  supplier_id: row.supplier_id,
  supplier_name: row.supplier_name,
  subtotal: toRupees(row.subtotal_paise),
  tax: toRupees(row.tax_paise),
  total: toRupees(row.total_paise),
  amount_paid: toRupees(row.amount_paid_paise),
  balance_due: toRupees(row.balance_due_paise),
  payment_status: row.payment_status,
  status: row.status,
  source: row.source,
  expected_date: row.expected_date ? String(row.expected_date).slice(0, 10) : null,
  ordered_at: row.ordered_at,
  received_at: row.received_at,
  notes: row.notes
});

export const nextPoNumber = async (client, businessId) => {
  const { rows } = await client.query(
    `SELECT po_prefix, po_next_number FROM businesses WHERE business_id = $1 FOR UPDATE`,
    [businessId]
  );
  await client.query(`UPDATE businesses SET po_next_number = po_next_number + 1 WHERE business_id = $1`, [businessId]);
  return `${rows[0].po_prefix}-${String(rows[0].po_next_number).padStart(4, '0')}`;
};

/* ==========================================================================
   POST /api/purchases
   ========================================================================== */
export const create = async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one item' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const business = (await client.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];

    let supplier = null;
    if (body.supplier_id) {
      const { rows } = await client.query(
        `SELECT supplier_id, name FROM suppliers WHERE supplier_id = $1 AND business_id = $2`,
        [body.supplier_id, req.tenant.businessId]
      );
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Supplier not found' }); }
      supplier = rows[0];
    }
    // ponytail: supplier.state is not tracked in V1's suppliers table, so a
    // purchase is always treated as intra-state (CGST+SGST). Add a state
    // column and pass it here if inter-state purchases need IGST split.
    const interState = isInterState(business.state, null);

    const productIds = [...new Set(items.filter((i) => i.product_id).map((i) => Number(i.product_id)))];
    const products = new Map();
    if (productIds.length) {
      const { rows } = await client.query(
        `SELECT product_id, name, track_inventory FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) FOR UPDATE`,
        [req.tenant.businessId, productIds]
      );
      for (const p of rows) products.set(p.product_id, p);
    }

    const lines = [];
    for (const raw of items) {
      const quantity = toQuantity(raw.quantity);
      let description, product = null;
      if (raw.product_id) {
        product = products.get(Number(raw.product_id));
        if (!product) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `Product ${raw.product_id} not found` }); }
        description = raw.description || product.name;
      } else {
        if (!raw.description) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'A custom line needs a description' }); }
        description = String(raw.description).trim();
      }

      const unitCostPaise = toPaise(raw.unit_cost ?? 0);
      const taxRate = Number(raw.tax_rate) || 0;
      const tax = computeLineTax({ quantity, unitPricePaise: unitCostPaise, taxRatePercent: taxRate, gstEnabled: business.gst_enabled, interState });

      lines.push({ product_id: product?.product_id || null, description, quantity, unitCostPaise, taxRate, trackInventory: Boolean(product?.track_inventory), ...tax });
    }

    const totals = sumLines(lines);
    let paidPaise = 0;
    if (body.payment?.amount != null) {
      paidPaise = toPaise(body.payment.amount);
      if (paidPaise < 0) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Payment amount cannot be negative' }); }
    }
    const balancePaise = Math.max(0, totals.total_paise - paidPaise);
    const poNumber = await nextPoNumber(client, req.tenant.businessId);

    const po = (await client.query(
      `INSERT INTO purchase_orders
         (business_id, branch_id, supplier_id, po_number, po_date, subtotal_paise, tax_paise, total_paise,
          amount_paid_paise, balance_due_paise, payment_status, notes, created_by, received_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        req.tenant.businessId, req.tenant.branchId, supplier?.supplier_id || null, poNumber, body.po_date || null,
        totals.subtotal_paise, totals.tax_paise, totals.total_paise, paidPaise, balancePaise,
        paymentStatus(totals.total_paise, paidPaise), body.notes || null, req.auth.userId
      ]
    )).rows[0];

    for (const line of lines) {
      await client.query(
        `INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise, received_quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4)`,
        [po.po_id, line.product_id, line.description, line.quantity, line.unitCostPaise, line.taxRate, line.tax_paise, line.line_total_paise]
      );

      /* The latest price paid becomes the product's cost, so recipe cost and
         margins follow the supplier's real price. (Last price, not a moving
         average; PO history keeps every price for trend analysis.) */
      if (line.product_id) {
        await client.query(`UPDATE products SET purchase_price_paise = $1 WHERE product_id = $2 AND business_id = $3`, [line.unitCostPaise, line.product_id, req.tenant.businessId]);
      }

      if (line.trackInventory) {
        await moveStock(client, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, productId: line.product_id, delta: line.quantity });
        await client.query(
          `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_by)
           VALUES ($1,$2,$3,'PURCHASE',$4,'purchase_order',$5,$6)`,
          [req.tenant.businessId, req.tenant.branchId, line.product_id, line.quantity, po.po_id, req.auth.userId]
        );
      }
    }

    if (paidPaise > 0) {
      await client.query(
        `INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise, reference_number, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.tenant.businessId, req.tenant.branchId, po.po_id, supplier?.supplier_id || null, body.payment.method || 'CASH', paidPaise, body.payment.reference_number || null, req.auth.userId]
      );
    }

    await client.query('COMMIT');
    recordAudit(req, { action: 'purchase.created', resource_type: 'purchase_order', resource_id: po.po_id, metadata: { total: toRupees(totals.total_paise) } });
    res.status(201).json({ success: true, data: asPO({ ...po, supplier_name: supplier?.name || null }) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('[purchases] create failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not record the purchase' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   GET /api/purchases
   ========================================================================== */
export const list = async (req, res) => {
  const { from, to, supplier_id, status } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];
  if (from) { values.push(from); clauses.push(`po.po_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`po.po_date <= $${values.length}`); }
  if (supplier_id) { values.push(supplier_id); clauses.push(`po.supplier_id = $${values.length}`); }
  if (status) { values.push(String(status).split(',')); clauses.push(`po.status = ANY($${values.length}::text[])`); }
  const scope = branchFilter(req.tenant, 'po.branch_id', values);

  const { rows } = await pool.query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
     LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY po.po_date DESC, po.po_id DESC LIMIT 200`,
    values
  );
  res.json({ success: true, data: rows.map(asPO) });
};

/* ==========================================================================
   GET /api/purchases/:id
   ========================================================================== */
export const get = async (req, res) => {
  const scopeValues = [req.tenant.businessId, req.params.id];
  const scope = branchFilter(req.tenant, 'po.branch_id', scopeValues);
  const { rows } = await pool.query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
     LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 AND po.po_id = $2${scope}`,
    scopeValues
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const items = (await pool.query(
    `SELECT item_id, product_id, description, quantity, received_quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise
     FROM purchase_order_items WHERE po_id = $1 ORDER BY item_id`,
    [req.params.id]
  )).rows;

  res.json({
    success: true,
    data: {
      ...asPO(rows[0]),
      items: items.map((i) => ({
        item_id: i.item_id, product_id: i.product_id, description: i.description,
        quantity: Number(i.quantity), received_quantity: i.received_quantity == null ? null : Number(i.received_quantity), unit_cost: toRupees(i.unit_cost_paise),
        tax_rate: Number(i.tax_rate), tax_amount: toRupees(i.tax_amount_paise), line_total: toRupees(i.line_total_paise)
      }))
    }
  });
};

/* ==========================================================================
   POST /api/purchases/:id/payments — settling what a supplier is owed
   ========================================================================== */
export const addPayment = async (req, res) => {
  const body = req.body || {};
  let amountPaise;
  try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter a payment amount' }); }
  if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });

  const payScope = [req.tenant.businessId, req.params.id];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT po_id, branch_id, supplier_id, total_paise, amount_paid_paise, status FROM purchase_orders
       WHERE business_id = $1 AND po_id = $2${branchFilter(req.tenant, 'branch_id', payScope)} FOR UPDATE`,
      payScope
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    const po = rows[0];
    if (po.status !== 'RECEIVED') { await client.query('ROLLBACK'); return res.status(409).json({ success: false, message: 'Receive the order before paying for it' }); }

    const newPaid = Number(po.amount_paid_paise) + amountPaise;
    const newBalance = Math.max(0, Number(po.total_paise) - newPaid);

    await client.query(
      `INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise, reference_number, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.tenant.businessId, po.branch_id, po.po_id, po.supplier_id, body.method || 'CASH', amountPaise, body.reference_number || null, body.notes || null, req.auth.userId]
    );
    await client.query(
      `UPDATE purchase_orders SET amount_paid_paise = $1, balance_due_paise = $2, payment_status = $3 WHERE po_id = $4`,
      [newPaid, newBalance, paymentStatus(Number(po.total_paise), newPaid), po.po_id]
    );

    await client.query('COMMIT');
    recordAudit(req, { action: 'payment.recorded', resource_type: 'purchase_order', resource_id: po.po_id, metadata: { amount: toRupees(amountPaise) } });
    res.status(201).json({ success: true, data: { amount_paid: toRupees(newPaid), balance_due: toRupees(newBalance) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[purchases] addPayment failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not record the payment' });
  } finally {
    client.release();
  }
};
