/*
 * GST reports over the books: sales (bills less credit notes) and purchases (received orders), summarised by HSN, by SAC (service
 * codes, starting 99), and by tax rate (output tax against input tax), plus a purchase register for GSTR-2. They read what billing and buying already
 * recorded. Tax is split CGST + SGST for a supply inside the state and IGST for one across states, as the bill itself was (bills carry
 * igst_paise); a purchase is inter-state when the supplier's GSTIN belongs to another state than the business.
 *
 *   GET /reports/gst/summary?by=hsn|sac&kind=sales|purchases     GET /reports/gst/rates     GET /reports/gst/gstr2       (?from&to)
 *
 * ponytail: lines are folded in JS, fine for a period of a few hundred thousand lines; SQL GROUP BY if that ever bites.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { gstinState, placeOfSupply } from '../modules/gst/states.js';

const R = toRupees;
const range = async (query, businessId) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : await businessToday(businessId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDaysISO(to, -30);
  return { from, to };
};
const branchSql = (req, col) => (req.tenant.scopeBranchId == null ? { sql: '', args: [] } : { sql: ` AND ${col} = $4`, args: [req.tenant.scopeBranchId] });

/* sales lines: bills (+) and credit notes (-) with the HSN of the product, and whether the supply crossed states */
const salesLines = async (req, from, to) => {
  const b = branchSql(req, 'i.branch_id'); const c = branchSql(req, 'c.branch_id');
  const id = req.tenant.businessId;
  const inv = (await pool.query(
    `SELECT i.invoice_id AS doc_id, i.invoice_number AS number, i.invoice_date AS date, COALESCE(cu.name, 'Walk-in customer') AS party, cu.gstin AS gstin, (i.igst_paise > 0) AS inter,
            COALESCE(ii.hsn_sac, p.hsn_sac) AS hsn, ii.tax_rate AS rate, ii.quantity, ii.line_total_paise - ii.tax_amount_paise AS taxable, ii.tax_amount_paise AS tax, ii.unit_name AS unit
     FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.invoice_id LEFT JOIN products p ON p.product_id = ii.product_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${b.sql}`, [id, from, to, ...b.args])).rows.map((r) => ({ ...r, sign: 1 }));
  const notes = (await pool.query(
    `SELECT c.cn_id AS doc_id, c.cn_number AS number, c.cn_date AS date, COALESCE(cu.name, 'Walk-in customer') AS party, cu.gstin AS gstin, (c.igst_paise > 0) AS inter,
            COALESCE(ci.hsn_sac, p.hsn_sac) AS hsn, ci.tax_rate AS rate, ci.quantity, ci.line_total_paise - ci.tax_amount_paise AS taxable, ci.tax_amount_paise AS tax, NULL AS unit
     FROM credit_notes c JOIN credit_note_items ci ON ci.cn_id = c.cn_id JOIN invoices i ON i.invoice_id = c.invoice_id LEFT JOIN products p ON p.product_id = ci.product_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id
     WHERE c.business_id = $1 AND c.cn_date BETWEEN $2 AND $3${c.sql}`, [id, from, to, ...c.args])).rows.map((r) => ({ ...r, sign: -1 }));
  return [...inv, ...notes];
};

/* purchase lines from received orders; inter-state when the supplier's GSTIN is another state's */
const purchaseLines = async (req, from, to) => {
  const b = branchSql(req, 'po.branch_id');
  const id = req.tenant.businessId;
  const biz = (await pool.query('SELECT gstin, state FROM businesses WHERE business_id = $1', [id])).rows[0] || {};
  const home = placeOfSupply(biz.gstin, biz.state);
  const rows = (await pool.query(
    `SELECT po.po_id AS doc_id, po.po_number AS number, COALESCE(po.supplier_invoice_no, '') AS bill_no, COALESCE(po.supplier_invoice_date, po.po_date) AS date, COALESCE(s.name, 'Supplier') AS party, s.gstin AS gstin,
            p.hsn_sac AS hsn, pi.tax_rate AS rate, pi.quantity, pi.line_total_paise - pi.tax_amount_paise AS taxable, pi.tax_amount_paise AS tax, NULL AS unit
     FROM purchase_orders po JOIN purchase_order_items pi ON pi.po_id = po.po_id LEFT JOIN products p ON p.product_id = pi.product_id LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 AND po.status = 'RECEIVED' AND po.po_date BETWEEN $2 AND $3${b.sql}`, [id, from, to, ...b.args])).rows;
  return rows.map((r) => { const theirs = gstinState(r.gstin); return { ...r, sign: 1, inter: Boolean(theirs && home && theirs !== home) }; });
};

const split = (l) => { const tax = l.sign * Number(l.tax); const igst = l.inter ? tax : 0; const cgst = l.inter ? 0 : Math.trunc(tax / 2); return { igst, cgst, sgst: l.inter ? 0 : tax - cgst, tax }; };
const fold = (lines, keyOf) => {
  const m = new Map();
  for (const l of lines) {
    const k = keyOf(l); const s = split(l);
    const g = m.get(k.key) || { ...k.row, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    g.qty += l.sign * Number(l.quantity); g.taxable += l.sign * Number(l.taxable); g.cgst += s.cgst; g.sgst += s.sgst; g.igst += s.igst; g.tax += s.tax;
    m.set(k.key, g);
  }
  return m;
};
const out = (g) => ({ ...g, qty: Math.round(g.qty * 1000) / 1000, taxable: R(g.taxable), cgst: R(g.cgst), sgst: R(g.sgst), igst: R(g.igst), tax: R(g.tax), total: R(g.taxable + g.tax) });
const totals = (rows) => { const t = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100; return { taxable: t('taxable'), cgst: t('cgst'), sgst: t('sgst'), igst: t('igst'), tax: t('tax'), total: t('total') }; };

/* by = hsn: every HSN/SAC and rate; by = sac: only the service codes (99...). kind = sales (bills less credit notes) or purchases. */
export const summary = async (req, res) => {
  const { from, to } = await range(req.query, req.tenant.businessId);
  const by = req.query.by === 'sac' ? 'sac' : 'hsn';
  const kind = req.query.kind === 'purchases' ? 'purchases' : 'sales';
  let lines = kind === 'sales' ? await salesLines(req, from, to) : await purchaseLines(req, from, to);
  const isSac = (l) => String(l.hsn || '').startsWith('99');
  lines = lines.filter((l) => (by === 'sac' ? isSac(l) : !isSac(l)));
  const rows = [...fold(lines, (l) => ({ key: `${l.hsn || ''}|${Number(l.rate)}`, row: { code: l.hsn || '', rate: Number(l.rate), unit: l.unit || null } })).values()].map(out)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)) || a.rate - b.rate);
  res.json({ success: true, data: { by, kind, range: { from, to }, missing_code: lines.filter((l) => !l.hsn).length, totals: totals(rows), rows } });
};

/* output tax (sales less credit notes) against input tax (purchases), by rate: the difference is the tax to pay, or carry as credit */
export const rates = async (req, res) => {
  const { from, to } = await range(req.query, req.tenant.businessId);
  const [sales, purchases] = await Promise.all([salesLines(req, from, to), purchaseLines(req, from, to)]);
  const sm = fold(sales, (l) => ({ key: Number(l.rate), row: { rate: Number(l.rate) } }));
  const pm = fold(purchases, (l) => ({ key: Number(l.rate), row: { rate: Number(l.rate) } }));
  const keys = [...new Set([...sm.keys(), ...pm.keys()])].sort((a, b) => a - b);
  const rows = keys.map((k) => {
    const s = sm.get(k); const p = pm.get(k);
    return { rate: k, sales_taxable: R(s?.taxable ?? 0), output_tax: R(s?.tax ?? 0), purchase_taxable: R(p?.taxable ?? 0), input_tax: R(p?.tax ?? 0), net_tax: R((s?.tax ?? 0) - (p?.tax ?? 0)) };
  });
  const t = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;
  res.json({ success: true, data: { range: { from, to }, totals: { sales_taxable: t('sales_taxable'), output_tax: t('output_tax'), purchase_taxable: t('purchase_taxable'), input_tax: t('input_tax'), net_tax: t('net_tax') }, rows } });
};

/* GSTR-2 style purchase register: every received purchase by supplier bill and rate, with the supplier's GSTIN. A supplier with no GSTIN is unregistered: no input credit. */
export const gstr2 = async (req, res) => {
  const { from, to } = await range(req.query, req.tenant.businessId);
  const lines = await purchaseLines(req, from, to);
  const rows = [...fold(lines, (l) => ({ key: `${l.doc_id}|${Number(l.rate)}`, row: { doc_id: l.doc_id, number: l.number, bill_no: l.bill_no, date: l.date, party: l.party, gstin: l.gstin || '', registered: Boolean(l.gstin), inter: l.inter, rate: Number(l.rate) } })).values()]
    .map(out).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.doc_id - a.doc_id);
  const claimable = rows.filter((r) => r.registered);
  const t = totals(rows);
  res.json({ success: true, data: { range: { from, to }, totals: { ...t, claimable_tax: Math.round(claimable.reduce((s, r) => s + r.tax, 0) * 100) / 100, unregistered_tax: Math.round(rows.filter((r) => !r.registered).reduce((s, r) => s + r.tax, 0) * 100) / 100, bills: new Set(rows.map((r) => r.doc_id)).size }, rows } });
};

/* The GST options in use (modules/gstOptions.js): cess charged, TCS collected, TDS held back by customers, reverse-charge bills, and for a composite
   dealer the turnover with the tax payable on it (composite rate % of turnover). One row per bill that carries any of them. */
export const options = async (req, res) => {
  const { from, to } = await range(req.query, req.tenant.businessId);
  const b = branchSql(req, 'i.branch_id');
  const biz = (await pool.query('SELECT gst_settings FROM businesses WHERE business_id = $1', [req.tenant.businessId])).rows[0] || {};
  const rate = Number(biz.gst_settings?.composite_rate ?? 1);
  const { rows } = await pool.query(
    `SELECT i.invoice_id, i.invoice_number AS number, i.invoice_date AS date, COALESCE(cu.name, 'Walk-in customer') AS party, cu.gstin AS gstin,
            i.subtotal_paise AS taxable, i.cess_paise AS cess, i.tcs_paise AS tcs, i.tds_paise AS tds, i.reverse_charge, i.bill_of_supply, i.total_paise AS total
     FROM invoices i LEFT JOIN customers cu ON cu.customer_id = i.customer_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${b.sql}
       AND (i.cess_paise > 0 OR i.tcs_paise > 0 OR i.tds_paise > 0 OR i.reverse_charge OR i.bill_of_supply)
     ORDER BY i.invoice_date DESC, i.invoice_id DESC`, [req.tenant.businessId, from, to, ...b.args]);
  const sum = (k, pick = () => true) => rows.filter(pick).reduce((s, r) => s + Number(r[k]), 0);
  const turnover = sum('taxable', (r) => r.bill_of_supply);
  res.json({ success: true, data: {
    range: { from, to },
    totals: { cess: R(sum('cess')), tcs: R(sum('tcs')), tds: R(sum('tds')), reverse_charge_bills: rows.filter((r) => r.reverse_charge).length, reverse_charge_value: R(sum('taxable', (r) => r.reverse_charge)),
      composite_turnover: R(turnover), composite_rate: rate, composite_tax: R(Math.round(turnover * rate / 100)) },
    rows: rows.map((r) => ({ invoice_id: r.invoice_id, number: r.number, date: r.date, party: r.party, gstin: r.gstin || '', taxable: R(r.taxable), cess: R(r.cess), tcs: R(r.tcs), tds: R(r.tds), reverse_charge: r.reverse_charge, bill_of_supply: r.bill_of_supply, total: R(r.total) }))
  } });
};
