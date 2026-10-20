/*
 * Party reports: every customer or supplier with what they owe and what they bought in the period (the All Parties report, including parties
 * with no activity), and the party / item cross: what one party bought, or who bought one item. Read-only; the names are for the screen,
 * the assistant is not given these.
 *
 *   GET /reports/parties/all?kind=customers|suppliers&from&to
 *   GET /reports/parties/items?kind=customers|suppliers&party_id=…   or   &product_id=…   (&from&to)
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const R = toRupees;
const num = (v) => Math.round(Number(v) * 1000) / 1000;
const range = async (query, businessId) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : await businessToday(businessId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDaysISO(to, -30);
  return { from, to };
};
const LIMIT = 5000;

/* All Parties: one row per active party, the period's bills and total, what is owed now, the last bill, and for customers the credit limit */
export const all = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const customers = req.query.kind !== 'suppliers';
  const scoped = req.tenant.scopeBranchId != null;
  const args = scoped ? [businessId, from, to, req.tenant.scopeBranchId] : [businessId, from, to];
  const br = (col) => (scoped ? ` AND ${col} = $4` : '');
  const sql = customers
    ? `SELECT c.customer_id AS id, c.name, c.phone, c.gstin, c.state, c.credit_limit_paise AS limit_paise,
              COALESCE(p.docs, 0) AS docs, COALESCE(p.total, 0) AS total_paise, COALESCE(o.due, 0) AS due_paise, o.last_date::text AS last_date
       FROM customers c
       LEFT JOIN (SELECT customer_id, COUNT(*) AS docs, SUM(total_paise) AS total FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2 AND $3${br('branch_id')} GROUP BY customer_id) p ON p.customer_id = c.customer_id
       LEFT JOIN (SELECT customer_id, SUM(balance_due_paise) AS due, MAX(invoice_date) AS last_date FROM invoices WHERE business_id = $1 AND status = 'ISSUED'${br('branch_id')} GROUP BY customer_id) o ON o.customer_id = c.customer_id
       WHERE c.business_id = $1 AND c.status = 'ACTIVE' ORDER BY due_paise DESC, total_paise DESC, c.name LIMIT ${LIMIT}`
    : `SELECT s.supplier_id AS id, s.name, s.phone, s.gstin, NULL AS state, NULL::bigint AS limit_paise,
              COALESCE(p.docs, 0) AS docs, COALESCE(p.total, 0) AS total_paise, COALESCE(o.due, 0) AS due_paise, o.last_date::text AS last_date
       FROM suppliers s
       LEFT JOIN (SELECT supplier_id, COUNT(*) AS docs, SUM(total_paise - debited_paise) AS total FROM purchase_orders WHERE business_id = $1 AND status = 'RECEIVED' AND po_date BETWEEN $2 AND $3${br('branch_id')} GROUP BY supplier_id) p ON p.supplier_id = s.supplier_id
       LEFT JOIN (SELECT supplier_id, SUM(balance_due_paise) AS due, MAX(po_date) AS last_date FROM purchase_orders WHERE business_id = $1 AND status = 'RECEIVED'${br('branch_id')} GROUP BY supplier_id) o ON o.supplier_id = s.supplier_id
       WHERE s.business_id = $1 AND s.status = 'ACTIVE' ORDER BY due_paise DESC, total_paise DESC, s.name LIMIT ${LIMIT}`;
  const { rows } = await pool.query(sql, args);
  const out = rows.map((r) => {
    const limit = customers ? Number(r.limit_paise) : 0;
    return { party_id: r.id, name: r.name, phone: r.phone || '', gstin: r.gstin || '', state: r.state || '', docs: Number(r.docs), total: R(r.total_paise), due: R(r.due_paise), last_date: r.last_date, credit_limit: limit > 0 ? R(limit) : null, over_limit: limit > 0 && Number(r.due_paise) > limit };
  });
  const t = (k) => Math.round(out.reduce((s, r) => s + r[k], 0) * 100) / 100;
  res.json({
    success: true,
    data: {
      kind: customers ? 'customers' : 'suppliers', range: { from, to },
      totals: { parties: out.length, active_in_period: out.filter((r) => r.docs > 0).length, total: t('total'), due: t('due'), owing: out.filter((r) => r.due > 0).length, over_limit: out.filter((r) => r.over_limit).length },
      truncated: rows.length >= LIMIT, rows: out
    }
  });
};

/* Party report by items: what one party bought (party_id), or who bought one item (product_id), by quantity and value */
export const items = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const customers = req.query.kind !== 'suppliers';
  const partyId = Number(req.query.party_id); const productId = Number(req.query.product_id);
  const byParty = Number.isInteger(partyId) && req.query.party_id !== '';
  const byItem = !byParty && Number.isInteger(productId) && req.query.product_id !== '';
  if (!byParty && !byItem) return res.status(400).json({ success: false, message: 'Choose a party or an item' });
  const scoped = req.tenant.scopeBranchId != null;
  const args = [businessId, from, to, byParty ? partyId : productId, ...(scoped ? [req.tenant.scopeBranchId] : [])];
  const br = (col) => (scoped ? ` AND ${col} = $5` : '');

  const doc = customers ? { head: 'invoices i', line: 'invoice_items x ON x.invoice_id = i.invoice_id', party: 'i.customer_id', date: 'i.invoice_date', id: 'i.invoice_id', where: `i.status = 'ISSUED'`, br: br('i.branch_id'), partyTable: 'customers pt ON pt.customer_id = i.customer_id' }
    : { head: 'purchase_orders i', line: 'purchase_order_items x ON x.po_id = i.po_id', party: 'i.supplier_id', date: 'i.po_date', id: 'i.po_id', where: `i.status = 'RECEIVED'`, br: br('i.branch_id'), partyTable: 'suppliers pt ON pt.supplier_id = i.supplier_id' };
  const key = byParty ? `COALESCE(p.product_id::text, x.description)` : doc.party;
  const label = byParty ? `COALESCE(p.name, x.description)` : (customers ? `COALESCE(pt.name, 'Walk-in customers')` : `COALESCE(pt.name, 'No supplier')`);
  const filter = byParty ? `${doc.party} = $4` : `x.product_id = $4`;
  const { rows } = await pool.query(
    `SELECT ${key} AS k, MIN(${label}) AS name, MIN(${byParty ? 'p.product_id' : doc.party}) AS ref_id, SUM(x.quantity) AS qty, SUM(x.line_total_paise - x.tax_amount_paise) AS taxable_paise, SUM(x.line_total_paise) AS total_paise,
            COUNT(DISTINCT ${doc.id})::int AS docs, MAX(${doc.date})::text AS last_date
     FROM ${doc.head} JOIN ${doc.line} LEFT JOIN products p ON p.product_id = x.product_id LEFT JOIN ${doc.partyTable}
     WHERE i.business_id = $1 AND ${doc.where} AND ${doc.date} BETWEEN $2 AND $3 AND ${filter}${doc.br}
     GROUP BY 1 ORDER BY SUM(x.line_total_paise) DESC LIMIT 1000`, args);
  const subject = byParty
    ? (await pool.query(customers ? 'SELECT name FROM customers WHERE business_id = $1 AND customer_id = $2' : 'SELECT name FROM suppliers WHERE business_id = $1 AND supplier_id = $2', [businessId, partyId])).rows[0]?.name
    : (await pool.query('SELECT name FROM products WHERE business_id = $1 AND product_id = $2', [businessId, productId])).rows[0]?.name;
  const t = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
  res.json({
    success: true,
    data: {
      kind: customers ? 'customers' : 'suppliers', by: byParty ? 'party' : 'item', subject: subject || null, range: { from, to },
      totals: { rows: rows.length, qty: num(t('qty')), taxable: R(t('taxable_paise')), total: R(t('total_paise')) },
      rows: rows.map((r) => ({ ref_id: r.ref_id, name: r.name, qty: num(r.qty), taxable: R(r.taxable_paise), total: R(r.total_paise), docs: r.docs, last_date: r.last_date }))
    }
  });
};
