/*
 * Ledger-style reports: every document and money movement in date order (Day Book, All Transactions), one party's statement with a
 * running balance, and sales / purchases grouped by party. Read-only aggregates over what billing, buying, payments and expenses
 * already recorded, so nothing here writes. Money is paise in the database and rupees in the answer.
 *
 *   GET /reports/transactions?from&to&type&q     (Day Book is this with from = to)
 *   GET /reports/party-statement?kind=customer|supplier&id&from&to
 *   GET /reports/by-party?kind=sales|purchases&from&to
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const TYPES = ['SALE', 'PURCHASE', 'PAYMENT_IN', 'PAYMENT_OUT', 'EXPENSE', 'SALE_RETURN', 'PURCHASE_RETURN'];
const LIMIT = 2000;

const range = async (query, businessId) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : await businessToday(businessId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDaysISO(to, -30);
  return { from, to };
};
/* the outlet filter: one extra parameter ($4) when the person is limited to an outlet */
const outletSql = (req, col) => (req.tenant.scopeBranchId == null ? { sql: '', args: [] } : { sql: ` AND ${col} = $4`, args: [req.tenant.scopeBranchId] });

export const transactions = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const type = TYPES.includes(req.query.type) ? req.query.type : null;
  const o = outletSql(req, 'x.branch_id');
  const rows = (await pool.query(
    `SELECT * FROM (
       SELECT 'SALE' AS type, x.invoice_date AS txn_date, x.created_at, x.invoice_number AS number, COALESCE(c.name, 'Walk-in customer') AS party, x.customer_id AS party_id,
              x.total_paise, x.amount_paid_paise AS paid_paise, x.balance_due_paise AS balance_paise, x.status, NULL::text AS note, x.invoice_id AS ref_id
       FROM invoices x LEFT JOIN customers c ON c.customer_id = x.customer_id WHERE x.business_id = $1 AND x.invoice_date BETWEEN $2 AND $3${o.sql}
       UNION ALL
       SELECT 'PURCHASE', x.po_date, x.created_at, x.po_number, COALESCE(s.name, 'Supplier'), x.supplier_id,
              x.total_paise, x.amount_paid_paise, x.balance_due_paise, x.status, NULL, x.po_id
       FROM purchase_orders x LEFT JOIN suppliers s ON s.supplier_id = x.supplier_id WHERE x.business_id = $1 AND x.po_date BETWEEN $2 AND $3${o.sql}
       UNION ALL
       SELECT CASE WHEN x.po_id IS NULL AND x.supplier_id IS NULL THEN 'PAYMENT_IN' ELSE 'PAYMENT_OUT' END, x.payment_date, x.created_at,
              COALESCE(pi.invoice_number, NULLIF(x.reference_number, ''), '#' || x.payment_id), COALESCE(c.name, pc.name, s.name, CASE WHEN pi.invoice_id IS NOT NULL THEN 'Walk-in customer' ELSE '' END), COALESCE(x.customer_id, pi.customer_id, x.supplier_id),
              x.amount_paise, x.amount_paise, 0, 'ISSUED', x.payment_method, x.payment_id
       FROM payments x LEFT JOIN customers c ON c.customer_id = x.customer_id LEFT JOIN invoices pi ON pi.invoice_id = x.invoice_id LEFT JOIN customers pc ON pc.customer_id = pi.customer_id LEFT JOIN suppliers s ON s.supplier_id = x.supplier_id
       WHERE x.business_id = $1 AND x.payment_date BETWEEN $2 AND $3 AND x.payment_method <> 'CREDIT'${o.sql}
       UNION ALL
       SELECT 'EXPENSE', x.expense_date, x.created_at, x.category, COALESCE(x.description, ''), NULL,
              x.amount_paise, x.amount_paise, 0, 'ISSUED', x.payment_method, x.expense_id
       FROM expenses x WHERE x.business_id = $1 AND x.expense_date BETWEEN $2 AND $3${o.sql}
       UNION ALL
       SELECT 'OTHER_INCOME', x.income_date, x.created_at, x.category, COALESCE(x.description, ''), NULL,
              x.amount_paise, x.amount_paise, 0, 'ISSUED', x.payment_method, x.income_id
       FROM other_income x WHERE x.business_id = $1 AND x.income_date BETWEEN $2 AND $3${o.sql}
       UNION ALL
       SELECT 'SALE_RETURN', x.cn_date, x.created_at, x.cn_number, COALESCE(c.name, 'Walk-in customer'), i.customer_id,
              x.total_paise, 0, 0, 'ISSUED', NULL, x.cn_id
       FROM credit_notes x JOIN invoices i ON i.invoice_id = x.invoice_id LEFT JOIN customers c ON c.customer_id = i.customer_id
       WHERE x.business_id = $1 AND x.cn_date BETWEEN $2 AND $3${o.sql}
       UNION ALL
       SELECT 'PURCHASE_RETURN', x.dn_date, x.created_at, x.dn_number, COALESCE(s.name, 'Supplier'), x.supplier_id,
              x.total_paise, 0, 0, 'ISSUED', NULL, x.dn_id
       FROM debit_notes x LEFT JOIN suppliers s ON s.supplier_id = x.supplier_id WHERE x.business_id = $1 AND x.dn_date BETWEEN $2 AND $3${o.sql}
     ) t
     WHERE ($${4 + o.args.length} = '' OR t.type = $${4 + o.args.length})
       AND ($${5 + o.args.length} = '' OR t.party ILIKE '%' || $${5 + o.args.length} || '%' OR t.number ILIKE '%' || $${5 + o.args.length} || '%')
     ORDER BY t.txn_date DESC, t.created_at DESC LIMIT ${LIMIT + 1}`,
    [businessId, from, to, ...o.args, type || '', String(req.query.q || '').trim().slice(0, 60)]
  )).rows;

  const truncated = rows.length > LIMIT;
  const list = rows.slice(0, LIMIT);
  const live = list.filter((r) => r.status !== 'CANCELLED');
  const sum = (t, k = 'total_paise') => live.filter((r) => r.type === t).reduce((s, r) => s + Number(r[k]), 0);
  res.json({
    success: true,
    data: {
      range: { from, to }, truncated,
      // what came in and went out in the period: bills and purchases are documents; money is payments and expenses
      summary: {
        sales: toRupees(sum('SALE')), purchases: toRupees(sum('PURCHASE')), expenses: toRupees(sum('EXPENSE')),
        sale_returns: toRupees(sum('SALE_RETURN')), purchase_returns: toRupees(sum('PURCHASE_RETURN')),
        other_income: toRupees(sum('OTHER_INCOME')), money_in: toRupees(sum('PAYMENT_IN') + sum('OTHER_INCOME')), money_out: toRupees(sum('PAYMENT_OUT') + sum('EXPENSE'))
      },
      rows: list.map((r) => ({
        type: r.type, date: r.txn_date, number: r.number, party: r.party, party_id: r.party_id, total: toRupees(r.total_paise), paid: toRupees(r.paid_paise),
        balance: toRupees(r.balance_paise), status: r.status, note: r.note, ref_id: r.ref_id
      }))
    }
  });
};

/* One party's statement: opening balance, each document and payment with a running balance, closing balance. A customer's balance is what they
   owe us (bills up, payments and credit notes down, refunds up); a supplier's is what we owe them (purchases up, payments and debit notes down). */
export const partyStatement = async (req, res) => {
  const businessId = req.tenant.businessId;
  const kind = req.query.kind === 'supplier' ? 'supplier' : 'customer';
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Choose a party' });
  const { from, to } = await range(req.query, businessId);

  const partyRow = kind === 'customer'
    ? (await pool.query('SELECT customer_id AS id, name, phone, gstin, address FROM customers WHERE business_id = $1 AND customer_id = $2', [businessId, id])).rows[0]
    : (await pool.query('SELECT supplier_id AS id, name, phone, gstin, address FROM suppliers WHERE business_id = $1 AND supplier_id = $2', [businessId, id])).rows[0];
  if (!partyRow) return res.status(404).json({ success: false, message: 'Party not found' });

  // every movement: [date, created_at, kind label, number, note, debit, credit] where debit raises the balance and credit lowers it
  const sql = kind === 'customer'
    ? `SELECT i.invoice_date AS d, i.created_at AS at, 'Sale' AS label, i.invoice_number AS number, NULL::text AS note, i.total_paise AS debit, 0::bigint AS credit
         FROM invoices i WHERE i.business_id = $1 AND i.customer_id = $2 AND i.status = 'ISSUED'
       UNION ALL
       SELECT p.payment_date, p.created_at, 'Payment in', COALESCE(NULLIF(p.reference_number, ''), '#' || p.payment_id), p.payment_method, 0, p.amount_paise
         FROM payments p LEFT JOIN invoices pi ON pi.invoice_id = p.invoice_id
         WHERE p.business_id = $1 AND p.po_id IS NULL AND p.payment_method <> 'CREDIT' AND COALESCE(p.customer_id, pi.customer_id) = $2 AND (pi.invoice_id IS NULL OR pi.status = 'ISSUED')
       UNION ALL
       SELECT c.cn_date, c.created_at, 'Sale return', c.cn_number, NULL, 0, c.total_paise
         FROM credit_notes c JOIN invoices ci ON ci.invoice_id = c.invoice_id WHERE c.business_id = $1 AND ci.customer_id = $2
       UNION ALL
       SELECT r.created_at::date, r.created_at, 'Refund', '#' || r.refund_id, r.method, r.amount_paise, 0
         FROM refunds r JOIN invoices ri ON ri.invoice_id = r.invoice_id WHERE r.business_id = $1 AND ri.customer_id = $2 AND ri.status = 'ISSUED'`
    : `SELECT po.po_date AS d, po.created_at AS at, 'Purchase' AS label, po.po_number AS number, NULL::text AS note, 0::bigint AS debit, po.total_paise AS credit
         FROM purchase_orders po WHERE po.business_id = $1 AND po.supplier_id = $2 AND po.status = 'RECEIVED'
       UNION ALL
       SELECT p.payment_date, p.created_at, 'Payment out', COALESCE(NULLIF(p.reference_number, ''), '#' || p.payment_id), p.payment_method, p.amount_paise, 0
         FROM payments p WHERE p.business_id = $1 AND p.supplier_id = $2 AND p.payment_method <> 'CREDIT'
       UNION ALL
       SELECT dn.dn_date, dn.created_at, 'Purchase return', dn.dn_number, NULL, dn.total_paise, 0
         FROM debit_notes dn WHERE dn.business_id = $1 AND dn.supplier_id = $2`;
  const all = (await pool.query(`SELECT * FROM (${sql}) m ORDER BY d, at`, [businessId, id])).rows;

  // for a supplier the signs are mirrored so "balance" always reads as what is owed
  const sign = kind === 'customer' ? 1 : -1;
  let balance = 0;
  const opening = all.filter((m) => String(m.d).slice(0, 10) < from).reduce((s, m) => s + sign * (Number(m.debit) - Number(m.credit)), 0);
  balance = opening;
  const inRange = all.filter((m) => { const d = new Date(m.d).toISOString().slice(0, 10); return d >= from && d <= to; });
  const lines = inRange.map((m) => {
    balance += sign * (Number(m.debit) - Number(m.credit));
    return { date: m.d, type: m.label, number: m.number, note: m.note, debit: toRupees(m.debit), credit: toRupees(m.credit), balance: toRupees(balance) };
  });
  const total = (k) => toRupees(inRange.reduce((s, m) => s + Number(m[k]), 0));
  res.json({ success: true, data: { kind, party: partyRow, range: { from, to }, opening_balance: toRupees(opening), closing_balance: toRupees(balance), total_debit: total('debit'), total_credit: total('credit'), lines } });
};

/* Sales or purchases grouped by party, biggest first. */
export const byParty = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const sales = req.query.kind !== 'purchases';
  const o = outletSql(req, 'x.branch_id');
  const { rows } = await pool.query(
    sales
      ? `SELECT x.customer_id AS party_id, COALESCE(c.name, 'Walk-in customers') AS name, COUNT(*)::int AS docs, SUM(x.total_paise) AS total_paise, SUM(x.amount_paid_paise) AS paid_paise, SUM(x.balance_due_paise) AS balance_paise, MAX(x.invoice_date) AS last_date
         FROM invoices x LEFT JOIN customers c ON c.customer_id = x.customer_id WHERE x.business_id = $1 AND x.status = 'ISSUED' AND x.invoice_date BETWEEN $2 AND $3${o.sql}
         GROUP BY x.customer_id, c.name ORDER BY total_paise DESC`
      : `SELECT x.supplier_id AS party_id, COALESCE(s.name, 'No supplier') AS name, COUNT(*)::int AS docs, SUM(x.total_paise - x.debited_paise) AS total_paise, SUM(x.amount_paid_paise) AS paid_paise, SUM(x.balance_due_paise) AS balance_paise, MAX(x.po_date) AS last_date
         FROM purchase_orders x LEFT JOIN suppliers s ON s.supplier_id = x.supplier_id WHERE x.business_id = $1 AND x.status = 'RECEIVED' AND x.po_date BETWEEN $2 AND $3${o.sql}
         GROUP BY x.supplier_id, s.name ORDER BY total_paise DESC`,
    [businessId, from, to, ...o.args]
  );
  const t = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
  res.json({
    success: true,
    data: {
      kind: sales ? 'sales' : 'purchases', range: { from, to },
      totals: { docs: rows.reduce((s, r) => s + r.docs, 0), total: toRupees(t('total_paise')), paid: toRupees(t('paid_paise')), balance: toRupees(t('balance_paise')) },
      rows: rows.map((r) => ({ party_id: r.party_id, name: r.name, docs: r.docs, total: toRupees(r.total_paise), paid: toRupees(r.paid_paise), balance: toRupees(r.balance_paise), last_date: r.last_date }))
    }
  });
};
