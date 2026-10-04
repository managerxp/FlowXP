/*
 * Customer and supplier ledgers, outstanding balances and ageing — all from the documents that already exist
 * (invoices, payments, credit notes, refunds, purchase orders, debit notes) plus receipts, adjustments and the
 * opening balance. One definition of "what is owed", used by the ledger screen, the customer profile, credit
 * control, the dashboard and every report, so they can never disagree.
 *
 *   customer owes  = opening
 *                  + Σ invoices (issued or cancelled)  − Σ cancellations
 *                  − Σ payments on invoices (outside receipts)  − Σ receipts  + Σ reversed receipts
 *                  − Σ credit notes  + Σ refunds paid out
 *                  ± adjustments        (positive = the customer owes more)
 *
 *   we owe a supplier = opening + Σ goods received (PO totals) − Σ payments − Σ debit notes ± adjustments
 *
 * A receipt is one customer payment, however many invoices it settles; the per-invoice payment rows it created are
 * left out of the ledger so nothing is counted twice.
 */
import { addDays, today as businessToday } from './common.js';

/* The customer's lines, with a sortable key. amount > 0 is a debit (they owe more), < 0 a credit. */
const CUSTOMER_LINES = `
  SELECT i.invoice_date AS date, i.created_at AS at, 1 AS ord, 'INVOICE' AS type, i.invoice_number AS ref, 'Invoice' AS description, i.total_paise AS amount, i.invoice_id AS ref_id
    FROM invoices i WHERE i.business_id = $1 AND i.customer_id = $2
  UNION ALL
  SELECT i.invoice_date, i.created_at, 2, 'CANCELLED', i.invoice_number, 'Invoice cancelled', -i.total_paise, i.invoice_id
    FROM invoices i WHERE i.business_id = $1 AND i.customer_id = $2 AND i.status = 'CANCELLED'
  UNION ALL
  SELECT p.payment_date, p.created_at, 3, 'PAYMENT', COALESCE(p.reference_number, i.invoice_number), 'Payment on ' || i.invoice_number || ' (' || lower(p.payment_method) || ')', -p.amount_paise, p.payment_id
    FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id
    WHERE p.business_id = $1 AND i.customer_id = $2 AND p.receipt_id IS NULL
  UNION ALL
  SELECT p.payment_date, p.created_at, 3, 'ADVANCE', p.reference_number, 'Payment received (' || lower(p.payment_method) || ')', -p.amount_paise, p.payment_id
    FROM payments p WHERE p.business_id = $1 AND p.customer_id = $2 AND p.invoice_id IS NULL AND p.po_id IS NULL AND p.receipt_id IS NULL
  UNION ALL
  SELECT r.receipt_date, r.created_at, 3, CASE WHEN r.kind = 'REFUND' THEN 'REFUND' ELSE 'RECEIPT' END, r.receipt_number,
         CASE WHEN r.kind = 'REFUND' THEN 'Refund paid (' ELSE 'Receipt (' END || lower(r.method) || ')',
         CASE WHEN r.kind = 'REFUND' THEN r.amount_paise ELSE -r.amount_paise END, r.receipt_id
    FROM wholesale_receipts r WHERE r.business_id = $1 AND r.customer_id = $2
  UNION ALL
  SELECT r.reversed_at::date, r.reversed_at, 4, 'REVERSAL', r.receipt_number, 'Receipt reversed: ' || COALESCE(r.reverse_reason, ''),
         CASE WHEN r.kind = 'REFUND' THEN -r.amount_paise ELSE r.amount_paise END, r.receipt_id
    FROM wholesale_receipts r WHERE r.business_id = $1 AND r.customer_id = $2 AND r.status = 'REVERSED'
  UNION ALL
  SELECT c.cn_date, c.created_at, 5, 'CREDIT_NOTE', c.cn_number, 'Credit note against ' || i.invoice_number, -c.total_paise, c.cn_id
    FROM credit_notes c JOIN invoices i ON i.invoice_id = c.invoice_id WHERE c.business_id = $1 AND i.customer_id = $2
  UNION ALL
  SELECT f.created_at::date, f.created_at, 6, 'REFUND', i.invoice_number, 'Refund paid (' || lower(f.method) || ')', f.amount_paise, f.refund_id
    FROM refunds f JOIN invoices i ON i.invoice_id = f.invoice_id WHERE f.business_id = $1 AND i.customer_id = $2
  UNION ALL
  SELECT a.adj_date, a.created_at, 7, 'ADJUSTMENT', NULL, a.reason, a.amount_paise, a.adj_id
    FROM wholesale_ledger_adjustments a WHERE a.business_id = $1 AND a.party_type = 'CUSTOMER' AND a.party_id = $2`;

/* amount > 0: we owe the supplier more (a purchase); < 0: it reduces what we owe (payment, return) */
const SUPPLIER_LINES = `
  SELECT COALESCE(po.received_at::date, po.po_date) AS date, COALESCE(po.received_at, po.created_at) AS at, 1 AS ord, 'PURCHASE' AS type, po.po_number AS ref,
         'Goods received' || COALESCE(' (invoice ' || po.supplier_invoice_no || ')', '') AS description, po.total_paise AS amount, po.po_id AS ref_id
    FROM purchase_orders po WHERE po.business_id = $1 AND po.supplier_id = $2 AND po.status IN ('PARTIAL','RECEIVED') AND po.total_paise > 0
  UNION ALL
  SELECT p.payment_date, p.created_at, 2, 'PAYMENT', COALESCE(p.reference_number, po.po_number), 'Payment against ' || po.po_number || ' (' || lower(p.payment_method) || ')', -p.amount_paise, p.payment_id
    FROM payments p JOIN purchase_orders po ON po.po_id = p.po_id WHERE p.business_id = $1 AND po.supplier_id = $2
  UNION ALL
  SELECT d.dn_date, d.created_at, 3, 'DEBIT_NOTE', d.dn_number, 'Debit note (' || lower(d.kind) || ')', -d.total_paise, d.dn_id
    FROM debit_notes d WHERE d.business_id = $1 AND d.supplier_id = $2
  UNION ALL
  SELECT a.adj_date, a.created_at, 4, 'ADJUSTMENT', NULL, a.reason, a.amount_paise, a.adj_id
    FROM wholesale_ledger_adjustments a WHERE a.business_id = $1 AND a.party_type = 'SUPPLIER' AND a.party_id = $2`;

const build = async (db, { sql, openingSql, businessId, partyId, from, to }) => {
  const opening = Number((await db.query(openingSql, [businessId, partyId])).rows[0]?.opening ?? 0);
  const { rows } = await db.query(`SELECT * FROM (${sql}) l ORDER BY date, ord, at, ref_id`, [businessId, partyId]);
  let running = opening; let carried = opening;
  const lines = [];
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const amount = Number(r.amount);
    running += amount;
    if (from && date < from) { carried = running; continue; }
    if (to && date > to) continue;
    lines.push({ date, type: r.type, ref: r.ref, ref_id: r.ref_id, description: r.description, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, balance: running });
  }
  const closing = rows.reduce((s, r) => s + Number(r.amount), opening);
  return { opening: from ? carried : opening, closing: to ? (lines.at(-1)?.balance ?? carried) : closing, lines, total_closing: closing };
};

export const customerLedger = (db, { businessId, customerId, from = null, to = null }) => build(db, {
  sql: CUSTOMER_LINES, businessId, partyId: customerId, from, to,
  openingSql: `SELECT opening_balance_paise AS opening FROM wholesale_customer_profiles WHERE business_id = $1 AND customer_id = $2`
});

export const supplierLedger = (db, { businessId, supplierId, from = null, to = null }) => build(db, {
  sql: SUPPLIER_LINES, businessId, partyId: supplierId, from, to,
  openingSql: `SELECT opening_balance_paise AS opening FROM wholesale_supplier_profiles WHERE business_id = $1 AND supplier_id = $2`
});

/**
 * What each customer owes, in one query, for many customers at once (the profile, the credit check, the dashboard).
 * Returns Map(customer_id → { opening, invoiced, paid, credited, refunded, advances, adjustments, outstanding, overdue }).
 * `overdue` is the open invoice balance past its due date (plus the grace days).
 */
export const customerBalances = async (db, { businessId, customerIds = null, graceDays = 0, on = null }) => {
  const date = on || await businessToday(db, businessId);
  const filter = customerIds ? 'AND c.customer_id = ANY($3::int[])' : '';
  const values = customerIds ? [businessId, date, customerIds] : [businessId, date];
  const { rows } = await db.query(
    `SELECT c.customer_id,
            COALESCE(w.opening_balance_paise, 0) AS opening,
            COALESCE(inv.invoiced, 0) AS invoiced, COALESCE(inv.cancelled, 0) AS cancelled, COALESCE(pay.paid, 0) AS paid, COALESCE(cn.credited, 0) AS credited,
            COALESCE(rf.refunded, 0) AS refunded, COALESCE(rc.received, 0) AS received, COALESCE(rc.reversed, 0) AS reversed, COALESCE(rc.refund_paid, 0) AS receipt_refunds,
            COALESCE(ad.adjustments, 0) AS adjustments, COALESCE(od.overdue, 0) AS overdue
     FROM customers c
     LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id
     LEFT JOIN (SELECT customer_id, SUM(total_paise) AS invoiced, SUM(total_paise) FILTER (WHERE status = 'CANCELLED') AS cancelled FROM invoices WHERE business_id = $1 GROUP BY customer_id) inv ON inv.customer_id = c.customer_id
     LEFT JOIN (SELECT i.customer_id, SUM(p.amount_paise) AS paid FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id WHERE p.business_id = $1 AND p.receipt_id IS NULL GROUP BY i.customer_id) pay ON pay.customer_id = c.customer_id
     LEFT JOIN (SELECT i.customer_id, SUM(cn.total_paise) AS credited FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id WHERE cn.business_id = $1 GROUP BY i.customer_id) cn ON cn.customer_id = c.customer_id
     LEFT JOIN (SELECT i.customer_id, SUM(f.amount_paise) AS refunded FROM refunds f JOIN invoices i ON i.invoice_id = f.invoice_id WHERE f.business_id = $1 GROUP BY i.customer_id) rf ON rf.customer_id = c.customer_id
     LEFT JOIN (SELECT customer_id, SUM(amount_paise) FILTER (WHERE kind = 'RECEIPT') AS received, SUM(amount_paise) FILTER (WHERE status = 'REVERSED' AND kind = 'RECEIPT') AS reversed,
                       SUM(amount_paise) FILTER (WHERE kind = 'REFUND') - COALESCE(SUM(amount_paise) FILTER (WHERE kind = 'REFUND' AND status = 'REVERSED'), 0) AS refund_paid
                FROM wholesale_receipts WHERE business_id = $1 GROUP BY customer_id) rc ON rc.customer_id = c.customer_id
     LEFT JOIN (SELECT party_id, SUM(amount_paise) AS adjustments FROM wholesale_ledger_adjustments WHERE business_id = $1 AND party_type = 'CUSTOMER' GROUP BY party_id) ad ON ad.party_id = c.customer_id
     LEFT JOIN (SELECT i.customer_id, SUM(i.balance_due_paise) AS overdue FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
                WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND m.due_date + ${Number(graceDays) | 0} < $2::date GROUP BY i.customer_id) od ON od.customer_id = c.customer_id
     WHERE c.business_id = $1 ${filter}`, values);
  // standalone advances are folded into `paid` (they are credits on the ledger just the same)
  const advances = new Map((await db.query(
    `SELECT customer_id, SUM(amount_paise) AS a FROM payments WHERE business_id = $1 AND invoice_id IS NULL AND po_id IS NULL AND receipt_id IS NULL AND customer_id IS NOT NULL GROUP BY customer_id`, [businessId])).rows.map((r) => [r.customer_id, Number(r.a)]));
  const out = new Map();
  for (const r of rows) {
    const n = (k) => Number(r[k]);
    const advance = advances.get(r.customer_id) || 0;
    const outstanding = n('opening') + n('invoiced') - n('cancelled') - n('paid') - advance - (n('received') - n('reversed')) + n('receipt_refunds') - n('credited') + n('refunded') + n('adjustments');
    out.set(r.customer_id, {
      opening: n('opening'), invoiced: n('invoiced') - n('cancelled'), paid: n('paid') + advance + n('received') - n('reversed'), credited: n('credited'),
      refunded: n('refunded') + n('receipt_refunds'), adjustments: n('adjustments'), outstanding, overdue: Math.min(n('overdue'), Math.max(0, outstanding))
    });
  }
  return out;
};

export const supplierBalances = async (db, { businessId, supplierIds = null }) => {
  const filter = supplierIds ? 'AND s.supplier_id = ANY($2::int[])' : '';
  const values = supplierIds ? [businessId, supplierIds] : [businessId];
  const { rows } = await db.query(
    `SELECT s.supplier_id, COALESCE(w.opening_balance_paise, 0) AS opening, COALESCE(po.bought, 0) AS bought, COALESCE(pay.paid, 0) AS paid, COALESCE(dn.debited, 0) AS debited, COALESCE(ad.adjustments, 0) AS adjustments
     FROM suppliers s LEFT JOIN wholesale_supplier_profiles w ON w.supplier_id = s.supplier_id
     LEFT JOIN (SELECT supplier_id, SUM(total_paise) AS bought FROM purchase_orders WHERE business_id = $1 AND status IN ('PARTIAL','RECEIVED') GROUP BY supplier_id) po ON po.supplier_id = s.supplier_id
     LEFT JOIN (SELECT o.supplier_id, SUM(p.amount_paise) AS paid FROM payments p JOIN purchase_orders o ON o.po_id = p.po_id WHERE p.business_id = $1 GROUP BY o.supplier_id) pay ON pay.supplier_id = s.supplier_id
     LEFT JOIN (SELECT supplier_id, SUM(total_paise) AS debited FROM debit_notes WHERE business_id = $1 GROUP BY supplier_id) dn ON dn.supplier_id = s.supplier_id
     LEFT JOIN (SELECT party_id, SUM(amount_paise) AS adjustments FROM wholesale_ledger_adjustments WHERE business_id = $1 AND party_type = 'SUPPLIER' GROUP BY party_id) ad ON ad.party_id = s.supplier_id
     WHERE s.business_id = $1 ${filter}`, values);
  return new Map(rows.map((r) => {
    const n = (k) => Number(r[k]);
    return [r.supplier_id, { opening: n('opening'), bought: n('bought'), paid: n('paid'), debited: n('debited'), adjustments: n('adjustments'), outstanding: n('opening') + n('bought') - n('paid') - n('debited') + n('adjustments') }];
  }));
};

/* ── ageing ───────────────────────────────────────────────────────────────────────────────── */

export const BUCKETS = [['current', 'Current', null, 0], ['d1_30', '1–30 days', 1, 30], ['d31_60', '31–60 days', 31, 60], ['d61_90', '61–90 days', 61, 90], ['d90_plus', '90+ days', 91, null]];

export const bucketOf = (daysOverdue) => {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
};

/** Open customer invoices with days overdue and bucket. Optionally for one customer / salesperson. */
export const receivableAgeing = async (db, { businessId, customerId = null, salespersonId = null, on = null, branchId = null, limit = 5000 }) => {
  const date = on || await businessToday(db, businessId);
  const values = [businessId, date]; let where = `i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0`;
  if (customerId) { values.push(customerId); where += ` AND i.customer_id = $${values.length}`; }
  if (salespersonId) { values.push(salespersonId); where += ` AND m.salesperson_id = $${values.length}`; }
  if (branchId) { values.push(branchId); where += ` AND i.branch_id = $${values.length}`; }
  values.push(limit);
  const { rows } = await db.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.customer_id, c.name AS customer_name, i.total_paise, i.amount_paid_paise, i.balance_due_paise,
            COALESCE(m.due_date, i.invoice_date) AS due_date, ($2::date - COALESCE(m.due_date, i.invoice_date)) AS days_overdue, m.salesperson_id
     FROM invoices i JOIN customers c ON c.customer_id = i.customer_id LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
     WHERE ${where} ORDER BY c.name, COALESCE(m.due_date, i.invoice_date), i.invoice_id LIMIT $${values.length}`, values);
  return rows.map((r) => ({ ...r, days_overdue: Number(r.days_overdue), bucket: bucketOf(Number(r.days_overdue)) }));
};

export const payableAgeing = async (db, { businessId, supplierId = null, on = null, limit = 5000 }) => {
  const date = on || await businessToday(db, businessId);
  const values = [businessId, date]; let where = `po.business_id = $1 AND po.status IN ('PARTIAL','RECEIVED') AND po.balance_due_paise > 0`;
  if (supplierId) { values.push(supplierId); where += ` AND po.supplier_id = $${values.length}`; }
  values.push(limit);
  const { rows } = await db.query(
    `SELECT po.po_id, po.po_number, COALESCE(po.supplier_invoice_date, po.po_date) AS invoice_date, po.supplier_id, s.name AS supplier_name, po.total_paise, po.amount_paid_paise, po.balance_due_paise,
            COALESCE(po.due_date, po.po_date) AS due_date, ($2::date - COALESCE(po.due_date, po.po_date)) AS days_overdue
     FROM purchase_orders po JOIN suppliers s ON s.supplier_id = po.supplier_id WHERE ${where} ORDER BY s.name, COALESCE(po.due_date, po.po_date) LIMIT $${values.length}`, values);
  return rows.map((r) => ({ ...r, days_overdue: Number(r.days_overdue), bucket: bucketOf(Number(r.days_overdue)) }));
};

export { addDays };
