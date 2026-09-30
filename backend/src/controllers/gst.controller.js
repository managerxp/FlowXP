/*
 * GST filing support: GSTR-1 (JSON for the portal or offline tool), the GSTR-3B figures, e-invoice JSON for B2B
 * invoices, e-way bill JSON, and recording the numbers the portals return.
 *
 * FlowXP never talks to the government portals; it prepares the file, says what is missing, and a person (or their
 * accountant) uploads it. Each GSTIN files its own return, so everything here takes a `gstin` (default: the business's).
 * The rules are in modules/gst/; this file loads, scopes and shapes.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { addDaysISO } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';
import { gstinState } from '../modules/gst/states.js';
import { DEFAULT_B2CL_LIMIT_RUPEES, buildGstr1, buildGstr3b, loadDocs, shape } from '../modules/gst/returns.js';
import { buildEInvoice, buildEWayBill, loadInvoices } from '../modules/gst/documents.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

const periodRange = (period) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period ?? ''))) return null;
  const from = `${period}-01`;
  const next = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1));
  return { from, to: addDaysISO(next.toISOString().slice(0, 10), -1), fp: `${period.slice(5, 7)}${period.slice(0, 4)}` };
};

const settingsOf = async (businessId) => {
  const row = (await pool.query(`SELECT gst_enabled, gstin, gst_settings, financial_year_start_month FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  return { ...row, settings: { b2cl_limit: DEFAULT_B2CL_LIMIT_RUPEES, einvoice_enabled: false, ...(row.gst_settings || {}) } };
};

/* The GSTIN a request is about: asked for, else the business's own. */
const gstinFor = async (req, res) => {
  const b = await settingsOf(req.tenant.businessId);
  const gstin = String(req.query.gstin || b.gstin || '').trim().toUpperCase();
  if (!b.gst_enabled) { bad(res, 'GST is not switched on for this business (Business settings).', 409); return null; }
  if (!gstinState(gstin)) { bad(res, 'Add your GSTIN in Business settings first (15 characters).', 409); return null; }
  return { gstin, b };
};

/* GET /api/gst/settings, PUT /api/gst/settings { b2cl_limit?, einvoice_enabled? } */
export const getSettings = async (req, res) => {
  const b = await settingsOf(req.tenant.businessId);
  res.json({ success: true, data: { gst_enabled: b.gst_enabled, gstin: b.gstin, ...b.settings } });
};
export const putSettings = async (req, res) => {
  const b = await settingsOf(req.tenant.businessId);
  const next = { ...b.settings };
  if ('b2cl_limit' in (req.body || {})) {
    const v = Number(req.body.b2cl_limit);
    if (!(v > 0 && v <= 100000000)) return bad(res, 'The large-invoice limit must be an amount in rupees');
    next.b2cl_limit = v;
  }
  if ('einvoice_enabled' in (req.body || {})) next.einvoice_enabled = req.body.einvoice_enabled === true;
  await pool.query(`UPDATE businesses SET gst_settings = $1 WHERE business_id = $2`, [JSON.stringify(next), req.tenant.businessId]);
  recordAudit(req, { action: 'gst.settings_updated', resource_type: 'business', resource_id: req.tenant.businessId, metadata: req.body });
  res.json({ success: true, data: { gst_enabled: b.gst_enabled, gstin: b.gstin, ...next } });
};

/* GET /api/gst/filings?period=YYYY-MM — the GSTINs this business files under, with what each has for the month */
export const filings = async (req, res) => {
  const range = periodRange(req.query.period);
  if (!range) return bad(res, 'Choose a month');
  const { rows } = await pool.query(
    `SELECT COALESCE(br.gstin, b.gstin) AS gstin, COUNT(*)::int AS invoices, COALESCE(SUM(i.subtotal_paise), 0) AS taxable_paise
     FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY invoices DESC`, [req.tenant.businessId, range.from, range.to]);
  const b = await settingsOf(req.tenant.businessId);
  res.json({ success: true, data: { period: req.query.period, business_gstin: b.gstin, gst_enabled: b.gst_enabled, gstins: rows.map((r) => ({ gstin: r.gstin, invoices: r.invoices, taxable_value: toRupees(r.taxable_paise) })) } });
};

/* Turnover (before tax, net of credit notes) for the financial year to the end of the period, and for the year before. */
const turnover = async (businessId, gstin, to, startMonth) => {
  const y = Number(to.slice(0, 4)); const m = Number(to.slice(5, 7));
  const fyStartYear = m >= startMonth ? y : y - 1;
  const start = `${fyStartYear}-${String(startMonth).padStart(2, '0')}-01`;
  const prevStart = `${fyStartYear - 1}-${String(startMonth).padStart(2, '0')}-01`;
  const sum = async (a, z) => {
    const inv = (await pool.query(
      `SELECT COALESCE(SUM(i.subtotal_paise), 0) AS n FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
       WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date >= $2 AND i.invoice_date < $3 AND COALESCE(br.gstin, b.gstin) = $4`, [businessId, a, z, gstin])).rows[0].n;
    const cn = (await pool.query(
      `SELECT COALESCE(SUM(c.subtotal_paise), 0) AS n FROM credit_notes c JOIN invoices i ON i.invoice_id = c.invoice_id JOIN businesses b ON b.business_id = c.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
       WHERE c.business_id = $1 AND c.cn_date >= $2 AND c.cn_date < $3 AND COALESCE(br.gstin, b.gstin) = $4`, [businessId, a, z, gstin])).rows[0].n;
    return Number(inv) - Number(cn);
  };
  const after = addDaysISO(to, 1);
  return { current: await sum(start, after), previous: await sum(prevStart, start) };
};

const prepareGstr1 = async (req, res) => {
  const range = periodRange(req.query.period);
  if (!range) { bad(res, 'Choose a month'); return null; }
  const ctx = await gstinFor(req, res);
  if (!ctx) return null;
  const data = await loadDocs(pool, { businessId: req.tenant.businessId, gstin: ctx.gstin, ...range });
  const built = buildGstr1({ data, shaped: shape(data), gstin: ctx.gstin, fp: range.fp, settings: ctx.b.settings, turnover: await turnover(req.tenant.businessId, ctx.gstin, range.to, ctx.b.financial_year_start_month) });
  return { ...built, gstin: ctx.gstin, fp: range.fp };
};

/* GET /api/gst/gstr1?period=YYYY-MM&gstin=&download=1 */
export const gstr1 = async (req, res) => {
  const out = await prepareGstr1(req, res);
  if (!out) return;
  if (req.query.download === '1') {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="GSTR1_${out.gstin}_${out.fp}.json"`);
    recordAudit(req, { action: 'gst.gstr1_exported', resource_type: 'gstr1', resource_id: `${out.gstin}:${out.fp}`, metadata: { warnings: out.warnings.length } });
    return res.send(JSON.stringify(out.json, null, 2));
  }
  res.json({ success: true, data: { gstin: out.gstin, period: req.query.period, summary: out.summary, warnings: out.warnings, json: out.json } });
};

/* GET /api/gst/gstr3b?period=YYYY-MM&gstin= */
export const gstr3b = async (req, res) => {
  const range = periodRange(req.query.period);
  if (!range) return bad(res, 'Choose a month');
  const ctx = await gstinFor(req, res);
  if (!ctx) return;
  const data = await loadDocs(pool, { businessId: req.tenant.businessId, gstin: ctx.gstin, ...range });
  const purchases = (await pool.query(
    `SELECT po.tax_paise, s.gstin FROM purchase_orders po JOIN businesses b ON b.business_id = po.business_id LEFT JOIN branches br ON br.branch_id = po.branch_id LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 AND po.status IN ('RECEIVED','PARTIAL') AND po.po_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) = $4`, [req.tenant.businessId, range.from, range.to, ctx.gstin])).rows;
  const debits = (await pool.query(
    `SELECT n.tax_paise, s.gstin FROM debit_notes n JOIN businesses b ON b.business_id = n.business_id LEFT JOIN branches br ON br.branch_id = n.branch_id LEFT JOIN suppliers s ON s.supplier_id = n.supplier_id
     WHERE n.business_id = $1 AND n.dn_date BETWEEN $2 AND $3 AND COALESCE(br.gstin, b.gstin) = $4`, [req.tenant.businessId, range.from, range.to, ctx.gstin])).rows;
  res.json({ success: true, data: buildGstr3b({ shaped: shape(data), purchases, debits, gstin: ctx.gstin, fp: range.fp }) });
};

const einvoiceView = (e) => ({ invoice_id: e.invoice_id, invoice_number: e.invoice_number, ready: e.errors.length === 0, errors: e.errors, warnings: e.warnings, irn: e.irn });

/* GET /api/gst/einvoice?period=&gstin=&download=1 — B2B invoices of the month: which are ready, and the bulk file of those */
export const einvoiceList = async (req, res) => {
  const range = periodRange(req.query.period);
  if (!range) return bad(res, 'Choose a month');
  const ctx = await gstinFor(req, res);
  if (!ctx) return;
  const all = await loadInvoices(pool, req.tenant.businessId, { ...range, gstin: ctx.gstin });
  const b2b = all.filter((r) => gstinState(r.buyer_gstin)).map(buildEInvoice);
  if (req.query.download === '1') {
    const ready = b2b.filter((e) => e.errors.length === 0 && !e.irn);
    if (!ready.length) return bad(res, 'No invoice is ready to send: fix what is missing first, or they already have an IRN.', 409);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="einvoice_${ctx.gstin}_${range.fp}.json"`);
    return res.send(JSON.stringify(ready.map((e) => e.json), null, 2));
  }
  res.json({ success: true, data: { gstin: ctx.gstin, applies: ctx.b.settings.einvoice_enabled, invoices: b2b.map(einvoiceView) } });
};

const oneInvoice = async (req) => (await loadInvoices(pool, req.tenant.businessId, { ids: [Number(req.params.id)] }))[0];

/* GET /api/gst/invoices/:id/einvoice */
export const einvoiceOne = async (req, res) => {
  const inv = await oneInvoice(req);
  if (!inv) return bad(res, 'Not found', 404);
  const e = buildEInvoice(inv);
  res.json({ success: true, data: { ...einvoiceView(e), json: e.errors.length ? null : e.json } });
};

/* POST /api/gst/invoices/:id/irn { irn, ack_no?, ack_date? } — the number the IRP returned after you uploaded it */
export const recordIrn = async (req, res) => {
  const irn = String(req.body?.irn ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(irn)) return bad(res, 'An IRN is 64 letters and digits (0-9, a-f). Copy it from the portal.');
  const ackDate = req.body?.ack_date ? String(req.body.ack_date).slice(0, 10) : null;
  if (ackDate && !/^\d{4}-\d{2}-\d{2}$/.test(ackDate)) return bad(res, 'The acknowledgement date must be a date');
  try {
    const { rowCount } = await pool.query(
      `UPDATE invoices SET irn = $3, irn_ack_no = $4, irn_ack_date = $5 WHERE invoice_id = $1 AND business_id = $2 AND status = 'ISSUED'`,
      [req.params.id, req.tenant.businessId, irn, req.body?.ack_no ? String(req.body.ack_no).slice(0, 32) : null, ackDate]);
    if (!rowCount) return bad(res, 'Not found', 404);
  } catch (error) {
    if (error.code === '23505') return bad(res, 'That IRN is already recorded on another invoice', 409);
    throw error;
  }
  recordAudit(req, { action: 'gst.irn_recorded', resource_type: 'invoice', resource_id: req.params.id });
  res.json({ success: true, data: { irn } });
};

/* POST /api/gst/eway-bill { invoice_id, transport: { mode, distance_km, vehicle_no?, transporter_id?, ... } } */
export const ewayBill = async (req, res) => {
  const inv = (await loadInvoices(pool, req.tenant.businessId, { ids: [Number(req.body?.invoice_id)] }))[0];
  if (!inv) return bad(res, 'Invoice not found', 404);
  const e = buildEWayBill(inv, req.body?.transport || {});
  res.json({ success: true, data: { invoice_number: e.invoice_number, ready: e.errors.length === 0, errors: e.errors, warnings: e.warnings, json: e.errors.length ? null : e.json, eway_bill_no: e.eway_bill_no } });
};

/* POST /api/gst/invoices/:id/eway-bill { eway_bill_no, date? } — the number the portal returned */
export const recordEwayBill = async (req, res) => {
  const no = String(req.body?.eway_bill_no ?? '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(no)) return bad(res, 'An e-way bill number is 12 digits');
  const date = req.body?.date ? String(req.body.date).slice(0, 10) : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 'The date must be a date');
  const { rowCount } = await pool.query(`UPDATE invoices SET eway_bill_no = $3, eway_bill_date = $4 WHERE invoice_id = $1 AND business_id = $2 AND status = 'ISSUED'`, [req.params.id, req.tenant.businessId, no, date]);
  if (!rowCount) return bad(res, 'Not found', 404);
  recordAudit(req, { action: 'gst.eway_recorded', resource_type: 'invoice', resource_id: req.params.id });
  res.json({ success: true, data: { eway_bill_no: no } });
};
