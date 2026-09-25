/*
 * The billing engine.
 *
 * Everything the brief's workflow describes — SEARCH → CART → CUSTOMER →
 * DISCOUNT → GST → PAYMENT → INVOICE — happens in one database transaction in
 * create() below: the invoice number is claimed, stock is checked and locked,
 * GST is computed line by line, the invoice and its items are written, the
 * payment (if any) is recorded, and stock is decremented. Any failure rolls
 * every part of that back — a customer must never receive an invoice number
 * for a sale where the stock update failed, or lose stock for an invoice that
 * was never actually created.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { moveStock } from '../modules/stock.js';
import { describe as describeCard, getProgram, isLive, progressFor, voidForInvoice } from '../modules/loyalty.js';
import { businessToday } from '../utils/dates.js';
import { branchFilter } from '../utils/scope.js';
import { asInvoice, BillingError, createInvoiceInTransaction, paymentStatus, recordInvoiceCreated } from '../modules/billing.js';

/* ==========================================================================
   POST /api/invoices

   The transactional core (tax, stock locking, payment) lives in
   modules/billing.js, shared with orders.controller.js's bill() so a KOT tab
   converts to an invoice through the identical logic a direct POS sale uses.
   ========================================================================== */
export const create = async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invoice = await createInvoiceInTransaction(client, req.tenant, req.auth.userId, {
      customerId: body.customer_id,
      items: body.items,
      discount: body.discount,
      notes: body.notes,
      payment: body.payment,
      couponCode: body.coupon_code,
      invoiceDate: body.invoice_date
    });

    await client.query('COMMIT');
    recordInvoiceCreated(req, invoice);
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof BillingError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('[invoices] create failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not create the invoice' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   GET /api/invoices
   ========================================================================== */
export const list = async (req, res) => {
  const { from, to, customer_id, status, payment_status, search } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];

  if (from) { values.push(from); clauses.push(`i.invoice_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`i.invoice_date <= $${values.length}`); }
  if (customer_id) { values.push(customer_id); clauses.push(`i.customer_id = $${values.length}`); }
  if (status) { values.push(status); clauses.push(`i.status = $${values.length}`); }
  if (payment_status) { values.push(payment_status); clauses.push(`i.payment_status = $${values.length}`); }
  if (search) { values.push(`%${search}%`); clauses.push(`(i.invoice_number ILIKE $${values.length} OR c.name ILIKE $${values.length})`); }
  const scope = branchFilter(req.tenant, 'i.branch_id', values);

  const { rows } = await pool.query(
    `SELECT i.*, c.name AS customer_name FROM invoices i
     LEFT JOIN customers c ON c.customer_id = i.customer_id
     WHERE i.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY i.invoice_date DESC, i.invoice_id DESC LIMIT 200`,
    values
  );
  res.json({ success: true, data: rows.map(asInvoice) });
};

/* ==========================================================================
   GET /api/invoices/:id
   ========================================================================== */
export const get = async (req, res) => {
  const scopeValues = [req.tenant.businessId, req.params.id];
  const scope = branchFilter(req.tenant, 'i.branch_id', scopeValues);
  const { rows } = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin,
            br.name AS outlet_name, br.address AS outlet_address, br.phone AS outlet_phone, br.gstin AS outlet_gstin, br.city AS outlet_city,
            u.name AS cashier_name, o.order_number, t.name AS table_name
     FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id
     LEFT JOIN branches br ON br.branch_id = i.branch_id LEFT JOIN users u ON u.user_id = i.created_by
     LEFT JOIN orders o ON o.order_id = i.order_id LEFT JOIN dining_tables t ON t.table_id = o.table_id
     WHERE i.business_id = $1 AND i.invoice_id = $2${scope}`,
    scopeValues
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const items = (await pool.query(
    `SELECT item_id, product_id, description, quantity, unit_price_paise, discount_paise, tax_rate, tax_amount_paise, line_total_paise, modifiers
     FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`,
    [req.params.id]
  )).rows;

  const payments = (await pool.query(
    `SELECT payment_id, payment_method, amount_paise, reference_number, payment_date, notes
     FROM payments WHERE invoice_id = $1 ORDER BY payment_date, payment_id`,
    [req.params.id]
  )).rows;

  const refunds = (await pool.query(
    `SELECT refund_id, amount_paise, method, reason, created_at FROM refunds WHERE invoice_id = $1 ORDER BY refund_id`,
    [req.params.id]
  )).rows;

  // The customer's visit card as it stands, for the receipt (only when the program is live).
  let loyaltyCard = null;
  if (rows[0].customer_id) {
    const program = await getProgram(pool, req.tenant.businessId);
    if (isLive(program)) {
      const progress = await progressFor(pool, req.tenant.businessId, rows[0].customer_id, program, await businessToday(req.tenant.businessId));
      loyaltyCard = describeCard(program, progress).message;
    }
  }

  const creditNotes = (await pool.query(`SELECT cn_id, cn_number, cn_date, total_paise, reason FROM credit_notes WHERE invoice_id = $1 ORDER BY cn_id`, [req.params.id])).rows;

  res.json({
    success: true,
    data: {
      ...asInvoice(rows[0]),
      credit_notes: creditNotes.map((c) => ({ cn_id: c.cn_id, cn_number: c.cn_number, date: c.cn_date, total: toRupees(c.total_paise), reason: c.reason })),
      created_at: rows[0].created_at,
      cashier: rows[0].cashier_name, order_number: rows[0].order_number, table_name: rows[0].table_name,
      outlet: rows[0].outlet_name ? { name: rows[0].outlet_name, address: rows[0].outlet_address, phone: rows[0].outlet_phone, gstin: rows[0].outlet_gstin, city: rows[0].outlet_city } : null,
      loyalty_message: loyaltyCard,
      refunds: refunds.map((r) => ({ refund_id: r.refund_id, amount: toRupees(r.amount_paise), method: r.method, reason: r.reason, created_at: r.created_at })),
      customer_phone: rows[0].customer_phone,
      customer_gstin: rows[0].customer_gstin,
      items: items.map((i) => ({
        item_id: i.item_id, product_id: i.product_id, description: i.description,
        modifiers: i.modifiers || [], quantity: Number(i.quantity), unit_price: toRupees(i.unit_price_paise),
        discount: toRupees(i.discount_paise), tax_rate: Number(i.tax_rate),
        tax_amount: toRupees(i.tax_amount_paise), line_total: toRupees(i.line_total_paise)
      })),
      payments: payments.map((p) => ({
        payment_id: p.payment_id, method: p.payment_method, amount: toRupees(p.amount_paise),
        reference_number: p.reference_number, date: p.payment_date, notes: p.notes
      }))
    }
  });
};

/* ==========================================================================
   POST /api/invoices/:id/payments — clearing a balance after the fact
   ========================================================================== */
export const addPayment = async (req, res) => {
  const body = req.body || {};
  const payScope = [req.tenant.businessId, req.params.id];
  let amountPaise;
  try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter a payment amount' }); }
  if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT invoice_id, branch_id, customer_id, total_paise, amount_paid_paise, status
       FROM invoices WHERE business_id = $1 AND invoice_id = $2${branchFilter(req.tenant, 'branch_id', payScope)} FOR UPDATE`,
      payScope
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    const invoice = rows[0];
    if (invoice.status === 'CANCELLED') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This invoice is cancelled' }); }

    const newPaid = Number(invoice.amount_paid_paise) + amountPaise;
    const newBalance = Math.max(0, Number(invoice.total_paise) - newPaid);

    await client.query(
      `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, reference_number, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.tenant.businessId, invoice.branch_id, invoice.invoice_id, invoice.customer_id,
       body.method || 'CASH', amountPaise, body.reference_number || null, body.notes || null, req.auth.userId]
    );
    await client.query(
      `UPDATE invoices SET amount_paid_paise = $1, balance_due_paise = $2, payment_status = $3 WHERE invoice_id = $4`,
      [newPaid, newBalance, paymentStatus(Number(invoice.total_paise), newPaid), invoice.invoice_id]
    );

    await client.query('COMMIT');
    recordAudit(req, { action: 'payment.recorded', resource_type: 'invoice', resource_id: invoice.invoice_id, metadata: { amount: toRupees(amountPaise) } });
    res.status(201).json({ success: true, data: { amount_paid: toRupees(newPaid), balance_due: toRupees(newBalance) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[invoices] addPayment failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not record the payment' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/invoices/:id/cancel
   ========================================================================== */
export const cancel = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const scope = [req.tenant.businessId, req.params.id];
    const { rows } = await client.query(
      `SELECT invoice_id, status, credited_paise FROM invoices WHERE business_id = $1 AND invoice_id = $2${branchFilter(req.tenant, 'branch_id', scope)} FOR UPDATE`,
      scope
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (rows[0].status === 'CANCELLED') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Already cancelled' }); }
    if (Number(rows[0].credited_paise) > 0) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, message: 'This invoice has credit notes, so it can’t be cancelled. Issue a credit note for the rest instead.' }); }

    /* Stock comes back; money already collected does not — reversing a
       payment is a refund decision for a person to make, not something this
       endpoint should do silently. The balance simply stops being collectable
       from a cancelled invoice going forward. */
    /* Reverse what the ledger says this invoice took out — dishes and the
       ingredients their recipes consumed alike — rather than re-deriving it
       from the invoice lines, so cancellation can never disagree with the sale. */
    const taken = (await client.query(
      `SELECT product_id, branch_id, SUM(quantity) AS qty FROM inventory_transactions
       WHERE business_id = $1 AND reference_type = 'invoice' AND reference_id = $2 AND transaction_type = 'SALE'
       GROUP BY product_id, branch_id ORDER BY product_id`,
      [req.tenant.businessId, req.params.id]
    )).rows;

    for (const row of taken) {
      const restore = -Number(row.qty);
      if (!restore) continue;
      // Stock goes back to the outlet that sold it, whichever outlet the canceller is viewing.
      await moveStock(client, { businessId: req.tenant.businessId, branchId: row.branch_id, productId: row.product_id, delta: restore });
      await client.query(
        `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_by)
         VALUES ($1,$2,$3,'RETURN',$4,'invoice',$5,$6)`,
        [req.tenant.businessId, row.branch_id, row.product_id, restore, req.params.id, req.auth.userId]
      );
    }

    await voidForInvoice(client, req.tenant.businessId, req.params.id);   // the loyalty stamp and coupon use come back
    await client.query(`UPDATE invoices SET status = 'CANCELLED' WHERE invoice_id = $1`, [req.params.id]);
    await client.query('COMMIT');

    recordAudit(req, { action: 'invoice.cancelled', resource_type: 'invoice', resource_id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[invoices] cancel failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not cancel the invoice' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/invoices/:id/refund

   Refunds are their own explicit record — cancelling an invoice never pays
   anything back (see cancel()). A refund can't exceed what was actually
   collected less what has already been refunded.
   ========================================================================== */
const REFUND_METHODS = ['CASH', 'CARD', 'UPI', 'OTHER'];

export const refund = async (req, res) => {
  const body = req.body || {};
  let amountPaise;
  try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter a refund amount' }); }
  if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Refund must be more than zero' });
  if (!body.reason || !String(body.reason).trim()) return res.status(400).json({ success: false, message: 'Say why you are refunding' });
  const method = String(body.method || 'CASH').toUpperCase();
  if (!REFUND_METHODS.includes(method)) return res.status(400).json({ success: false, message: 'Unknown refund method' });

  const refundScope = [req.tenant.businessId, req.params.id];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT invoice_id, amount_paid_paise, refunded_paise FROM invoices WHERE business_id = $1 AND invoice_id = $2${branchFilter(req.tenant, 'branch_id', refundScope)} FOR UPDATE`,
      refundScope
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }

    const refundable = Number(rows[0].amount_paid_paise) - Number(rows[0].refunded_paise);
    if (amountPaise > refundable) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `At most ${toRupees(refundable)} can still be refunded on this invoice` });
    }

    const { rows: created } = await client.query(
      `INSERT INTO refunds (business_id, invoice_id, amount_paise, method, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING refund_id`,
      [req.tenant.businessId, req.params.id, amountPaise, method, String(body.reason).trim(), req.auth.userId]
    );
    await client.query(`UPDATE invoices SET refunded_paise = refunded_paise + $1 WHERE invoice_id = $2`, [amountPaise, req.params.id]);
    await client.query('COMMIT');

    recordAudit(req, { action: 'invoice.refunded', resource_type: 'invoice', resource_id: req.params.id, metadata: { amount: toRupees(amountPaise), method, reason: body.reason } });
    res.status(201).json({ success: true, data: { refund_id: created[0].refund_id, refundable: toRupees(refundable - amountPaise) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
