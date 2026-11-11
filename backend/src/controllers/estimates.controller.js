/*
 * Estimates / quotations: an offer with a number and a valid-until date. Not a sale: nothing touches stock or the books until "Make invoice",
 * which bills the same lines through the normal invoice engine (so tax, stock and loyalty behave exactly as at the till).
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { BillingError, createInvoiceInTransaction, recordInvoiceCreated } from '../modules/billing.js';
import { toPaise, toRupees } from '../utils/money.js';
import { branchFilter } from '../utils/scope.js';
import { nextNumber } from './orders.controller.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === String(v);
const fail = (res, status, message) => res.status(status).json({ success: false, message });

const asEstimate = (r) => {
  const items = r.items || [];
  const subtotal = items.reduce((s, i) => s + Math.round(Number(i.unit_price) * 100) * Number(i.quantity), 0);
  return {
    estimate_id: r.estimate_id, estimate_number: r.estimate_number, customer_id: r.customer_id, customer_name: r.customer_name,
    items, discount: toRupees(r.discount_paise), total: toRupees(Math.max(0, Math.round(subtotal) - Number(r.discount_paise))),
    notes: r.notes, valid_until: r.valid_until ? String(r.valid_until).slice(0, 10) : null, status: r.status, invoice_id: r.invoice_id, created_at: r.created_at
  };
};

/** Lines as typed: a product (price defaults to its selling price) or a free line with a description and a price. */
const cleanItems = async (businessId, raw) => {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new BillingError(400, 'Add at least one item');
  const ids = [...new Set(raw.filter((i) => i.product_id).map((i) => Number(i.product_id)))];
  const found = ids.length ? (await pool.query(`SELECT product_id, name, selling_price_paise FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids])).rows : [];
  const known = new Map(found.map((p) => [p.product_id, p]));
  return raw.map((i) => {
    const quantity = Number(i.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new BillingError(400, 'Enter a quantity above zero');
    const p = i.product_id ? known.get(Number(i.product_id)) : null;
    if (i.product_id && !p) throw new BillingError(400, 'An item was not found');
    const description = String(i.description || p?.name || '').trim().slice(0, 200);
    if (!description) throw new BillingError(400, 'Every line needs a name');
    const price = i.unit_price != null && i.unit_price !== '' ? toRupees(toPaise(i.unit_price)) : toRupees(p?.selling_price_paise ?? 0);
    if (price < 0) throw new BillingError(400, 'The price cannot be negative');
    return { product_id: p ? p.product_id : null, description, quantity, unit_price: price };
  });
};

export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  const { rows } = await pool.query(`SELECT * FROM estimates WHERE business_id = $1${branchFilter(req.tenant, 'branch_id', values)} ORDER BY estimate_id DESC LIMIT 200`, values);
  res.json({ success: true, data: rows.map(asEstimate) });
};

export const create = async (req, res) => {
  const body = req.body || {};
  if (body.valid_until && !isDate(body.valid_until)) return fail(res, 400, 'Enter a valid date');
  const client = await pool.connect();
  try {
    const items = await cleanItems(req.tenant.businessId, body.items);
    let discount = 0;
    if (body.discount != null && body.discount !== '') { discount = toPaise(body.discount); if (discount < 0) return fail(res, 400, 'The discount cannot be negative'); }
    let customerName = String(body.customer_name || '').trim().slice(0, 120) || null;
    if (body.customer_id) {
      const c = (await pool.query(`SELECT name FROM customers WHERE customer_id = $1 AND business_id = $2`, [body.customer_id, req.tenant.businessId])).rows[0];
      if (!c) return fail(res, 400, 'Customer not found');
      customerName = c.name;
    }
    await client.query('BEGIN');
    const number = await nextNumber(client, req.tenant.businessId, 'estimate_prefix', 'estimate_next_number');
    const { rows } = await client.query(
      `INSERT INTO estimates (business_id, branch_id, estimate_number, customer_id, customer_name, items, discount_paise, notes, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *`,
      [req.tenant.businessId, req.tenant.branchId, number, body.customer_id || null, customerName, JSON.stringify(items), discount, body.notes ? String(body.notes).slice(0, 500) : null, body.valid_until || null, req.auth.userId]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'estimate.created', resource_type: 'estimate', resource_id: rows[0].estimate_id, metadata: { number } });
    res.status(201).json({ success: true, data: asEstimate(rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof BillingError) return fail(res, error.status, error.message);
    if (/positive number|must be a number/.test(error.message || '')) return fail(res, 400, error.message);
    console.error('[estimates] create failed:', error.message);
    fail(res, 500, 'Could not save the estimate');
  } finally { client.release(); }
};

export const cancel = async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE estimates SET status = 'CANCELLED' WHERE business_id = $1 AND estimate_id = $2 AND status = 'OPEN'`, [req.tenant.businessId, req.params.id]);
  if (!rowCount) return fail(res, 404, 'Only an open estimate can be cancelled');
  recordAudit(req, { action: 'estimate.cancelled', resource_type: 'estimate', resource_id: req.params.id });
  res.json({ success: true });
};

/** Bill the quoted lines. The estimate's price is kept as the line price; the invoice engine adds tax and moves stock. */
export const convert = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const est = (await client.query(`SELECT * FROM estimates WHERE business_id = $1 AND estimate_id = $2 FOR UPDATE`, [req.tenant.businessId, req.params.id])).rows[0];
    if (!est) { await client.query('ROLLBACK'); return fail(res, 404, 'Not found'); }
    if (est.status !== 'OPEN') { await client.query('ROLLBACK'); return fail(res, 409, est.status === 'CONVERTED' ? 'This estimate is already an invoice' : 'This estimate was cancelled'); }
    const invoice = await createInvoiceInTransaction(client, req.tenant, req.auth.userId, {
      customerId: est.customer_id || undefined,
      items: est.items.map((i) => ({ ...(i.product_id ? { product_id: i.product_id } : {}), description: i.description, quantity: i.quantity, unit_price: i.unit_price })),
      discount: toRupees(est.discount_paise) || undefined,
      notes: `From estimate ${est.estimate_number}`,
      payment: req.body?.payment, payments: req.body?.payments
    });
    await client.query(`UPDATE estimates SET status = 'CONVERTED', invoice_id = $2 WHERE estimate_id = $1`, [est.estimate_id, invoice.invoice_id]);
    await client.query('COMMIT');
    recordInvoiceCreated(req, invoice);
    recordAudit(req, { action: 'estimate.converted', resource_type: 'estimate', resource_id: est.estimate_id, metadata: { invoice_id: invoice.invoice_id } });
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof BillingError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('[estimates] convert failed:', error.message);
    fail(res, 500, 'Could not make the invoice');
  } finally { client.release(); }
};
