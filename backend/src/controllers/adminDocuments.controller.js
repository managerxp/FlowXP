/*
 * FlowXP's own invoices and quotations to its clients (Super Admin).
 *   GET  /api/admin/documents?kind&status&search     list
 *   POST /api/admin/documents                        create (a draft)      PUT /:id  change a draft
 *   GET  /api/admin/documents/:id                    one, with the seller's details for printing
 *   POST /api/admin/documents/:id/status             SENT | PAID | ACCEPTED | DECLINED | CANCELLED
 *   POST /api/admin/documents/:id/convert            a quotation becomes an invoice
 *   GET  /api/admin/documents/client/:businessId     a client's details to prefill
 *   GET/PUT /api/admin/company                       FlowXP's name, GSTIN, address, bank/UPI, terms
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { getPlatformSetting, setPlatformSetting } from '../modules/platformSettings.js';
import { cleanItems, compute, fyLabel, isIntraState } from '../modules/adminDocs.js';
import { adjust } from '../modules/messaging/wallet.js';
import { createPaymentLink as cashfreeCreateLink, CashfreeError } from '../modules/payments/cashfree.js';
import config from '../config/env.js';
import { deliverMail, mailConfigured } from '../modules/mailer.js';
import { toRupees } from '../utils/money.js';

export const DOC_LINK_PREFIX = 'flowxp-doc-';

/**
 * Mark an invoice paid, once. When it carries WhatsApp credit and a client, that credit goes into the client's wallet in the same step.
 * Used by "Mark as paid" and by Cashfree's confirmation; a second call (a retry) changes nothing. Returns the invoice, or null if it was not payable.
 */
export const PAY_METHODS = ['UPI', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'OTHER'];
export const markPaid = async (docId, { note = null, userId = null, method = null, paidOn = null } = {}) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const d = (await c.query(
      `UPDATE admin_documents SET status = 'PAID', paid_at = COALESCE($4::date::timestamptz, CURRENT_TIMESTAMP), paid_note = $2, paid_method = $3, updated_at = CURRENT_TIMESTAMP
        WHERE doc_id = $1 AND kind = 'INVOICE' AND status IN ('DRAFT','SENT') RETURNING *`, [docId, note, method, paidOn])).rows[0];
    if (!d) { await c.query('ROLLBACK'); return null; }
    if (Number(d.credit_paise) > 0 && d.business_id && !d.credit_loaded) {
      await adjust(c, d.business_id, Number(d.credit_paise), { kind: 'TOPUP', note: `Invoice ${d.doc_number}`, by: userId });
      await c.query(`UPDATE admin_documents SET credit_loaded = TRUE WHERE doc_id = $1`, [docId]);
      d.credit_loaded = true;
    }
    await c.query('COMMIT');
    return d;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const COMPANY_FIELDS = ['name', 'gstin', 'address', 'state', 'email', 'phone', 'upi', 'bank', 'terms'];
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const company = async () => (await getPlatformSetting('company'))?.value || {};
const PREFIX = { INVOICE: 'INV', QUOTE: 'QT' };

const nextNumber = async (db, kind) => {
  const series = `${PREFIX[kind]}-${fyLabel()}`;
  const n = (await db.query(`INSERT INTO admin_doc_counters (series, last_number) VALUES ($1, 1) ON CONFLICT (series) DO UPDATE SET last_number = admin_doc_counters.last_number + 1 RETURNING last_number`, [series])).rows[0].last_number;
  return `${series}-${String(n).padStart(4, '0')}`;
};

const cleanClient = (c) => {
  const x = (k, max) => String(c?.[k] ?? '').trim().slice(0, max);
  const name = x('name', 120);
  if (!name) throw new Error('Choose or type the client');
  const gstin = x('gstin', 15).toUpperCase();
  if (gstin && !GSTIN.test(gstin)) throw new Error('That GSTIN does not look right (15 characters)');
  return { name, gstin, address: x('address', 300), state: x('state', 60), email: x('email', 120), phone: x('phone', 20) };
};

const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);

const build = async (body) => {
  const client = cleanClient(body.client);
  const seller = await company();
  const intra = isIntraState(seller.state, client.state);
  const { lines, totals } = compute(cleanItems(body.items), intra);
  const bid = Number(body.business_id);
  const credit = Math.round(Number(body.credit_rupees || 0) * 100);
  if (!Number.isFinite(credit) || credit < 0 || credit > 10000000) throw new Error('WhatsApp credit must be between 0 and 1,00,000 rupees');
  if (credit > 0 && !(Number.isInteger(bid) && bid > 0)) throw new Error('Pick an existing client to load WhatsApp credit for');
  return { credit, client, intra, lines, totals, issue: date(body.issue_date), due: date(body.due_date), notes: String(body.notes ?? '').trim().slice(0, 1000) || null, businessId: Number.isInteger(bid) && bid > 0 ? bid : null };
};

export const list = async (req, res) => {
  const forBusiness = Number(req.query.business_id);
  const kind = req.query.kind === 'QUOTE' ? 'QUOTE' : 'INVOICE';
  // every document of one client (both kinds), for the client's own page
  const params = Number.isInteger(forBusiness) && forBusiness > 0 ? [forBusiness] : [kind];
  let where = params.length && Number.isInteger(forBusiness) && forBusiness > 0 ? 'business_id = $1' : 'kind = $1';
  const status = String(req.query.status || '');
  if (status) { params.push(status); where += ` AND status = $${params.length}`; }
  const search = String(req.query.search || '').trim();
  if (search) { params.push(`%${search}%`); where += ` AND (doc_number ILIKE $${params.length} OR client->>'name' ILIKE $${params.length})`; }
  const rows = (await pool.query(`SELECT doc_id, kind, doc_number, business_id, client->>'name' AS client_name, (totals->>'total_paise')::bigint AS total_paise, issue_date, due_date, status FROM admin_documents WHERE ${where} ORDER BY doc_id DESC LIMIT 200`, params)).rows;
  res.json({ success: true, data: rows });
};

export const get = async (req, res) => {
  const r = (await pool.query(`SELECT * FROM admin_documents WHERE doc_id = $1`, [Number(req.params.id)])).rows[0];
  if (!r) return bad(res, 'Not found', 404);
  res.json({ success: true, data: { ...r, seller: await company() } });
};

export const create = async (req, res) => {
  const kind = req.body?.kind === 'QUOTE' ? 'QUOTE' : 'INVOICE';
  let b; try { b = await build(req.body || {}); } catch (e) { return bad(res, e.message); }
  const row = (await pool.query(
    `INSERT INTO admin_documents (kind, doc_number, business_id, client, items, totals, intra_state, issue_date, due_date, notes, created_by, credit_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10,$11,$12) RETURNING *`,
    [kind, await nextNumber(pool, kind), b.businessId, b.client, JSON.stringify(b.lines), b.totals, b.intra, b.issue, b.due, b.notes, req.auth.userId, kind === 'INVOICE' ? b.credit : 0])).rows[0];
  recordAudit(req, { business_id: b.businessId, action: `admin.${kind.toLowerCase()}_created`, resource_type: 'admin_document', resource_id: row.doc_id, metadata: { number: row.doc_number, total_paise: b.totals.total_paise } });
  res.status(201).json({ success: true, data: row });
};

export const update = async (req, res) => {
  const id = Number(req.params.id);
  const cur = (await pool.query(`SELECT status FROM admin_documents WHERE doc_id = $1`, [id])).rows[0];
  if (!cur) return bad(res, 'Not found', 404);
  if (cur.status !== 'DRAFT') return bad(res, 'Only a draft can be changed. Cancel this one and make a new one.', 409);
  let b; try { b = await build(req.body || {}); } catch (e) { return bad(res, e.message); }
  const row = (await pool.query(
    `UPDATE admin_documents SET business_id=$2, client=$3, items=$4, totals=$5, intra_state=$6, issue_date=COALESCE($7::date, issue_date), due_date=$8, notes=$9, credit_paise=CASE WHEN kind = 'INVOICE' THEN $10 ELSE 0 END, updated_at=CURRENT_TIMESTAMP WHERE doc_id=$1 RETURNING *`,
    [id, b.businessId, b.client, JSON.stringify(b.lines), b.totals, b.intra, b.issue, b.due, b.notes, b.credit])).rows[0];
  res.json({ success: true, data: row });
};

const ALLOWED = { INVOICE: { SENT: ['DRAFT'], PAID: ['DRAFT', 'SENT'], CANCELLED: ['DRAFT', 'SENT'] }, QUOTE: { SENT: ['DRAFT'], ACCEPTED: ['SENT'], DECLINED: ['SENT'], CANCELLED: ['DRAFT', 'SENT'] } };

export const setStatus = async (req, res) => {
  const id = Number(req.params.id); const to = String(req.body?.status || '');
  const cur = (await pool.query(`SELECT kind, status, business_id, doc_number FROM admin_documents WHERE doc_id = $1`, [id])).rows[0];
  if (!cur) return bad(res, 'Not found', 404);
  if (!ALLOWED[cur.kind][to]?.includes(cur.status)) return bad(res, `A ${cur.status.toLowerCase()} ${cur.kind === 'QUOTE' ? 'quotation' : 'invoice'} cannot be marked ${to.toLowerCase()}.`, 409);
  const note = String(req.body?.note || '').trim().slice(0, 200) || null;
  const method = req.body?.method ? String(req.body.method) : null;
  if (method && !PAY_METHODS.includes(method)) return bad(res, 'Choose how it was paid: UPI, bank transfer, cash, cheque, card or other.');
  const paidOn = req.body?.paid_on ? String(req.body.paid_on).slice(0, 10) : null;
  if (paidOn && (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn)))) return bad(res, 'That payment date is not a date.');
  if (paidOn && paidOn > new Date().toISOString().slice(0, 10)) return bad(res, 'The payment date cannot be in the future.');
  const row = to === 'PAID'
    ? await markPaid(id, { note, method, paidOn, userId: req.auth.userId })
    : (await pool.query(`UPDATE admin_documents SET status=$2::varchar, updated_at=CURRENT_TIMESTAMP WHERE doc_id=$1 RETURNING *`, [id, to])).rows[0];
  if (!row) return bad(res, 'This invoice was already paid.', 409);
  recordAudit(req, { business_id: cur.business_id, action: `admin.document_${to.toLowerCase()}`, resource_type: 'admin_document', resource_id: id, metadata: { number: cur.doc_number } });
  res.json({ success: true, data: row });
};

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rs = (p) => `₹${(Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* The email a client receives: the document laid out in the message itself, plus how to pay. */
export const documentEmail = (d, seller) => {
  const quote = d.kind === 'QUOTE'; const t = d.totals || {};
  const what = quote ? 'Quotation' : 'Invoice';
  const items = d.items || [];
  const rows = items.map((i) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e3e8ef">${esc(i.description)}</td><td style="padding:6px 8px;border-bottom:1px solid #e3e8ef" align="right">${esc(i.qty)}</td><td style="padding:6px 8px;border-bottom:1px solid #e3e8ef" align="right">${rs(i.total_paise)}</td></tr>`).join('');
  const pay = !quote && d.status !== 'PAID'
    ? [d.payment_link_url && `Pay online: ${d.payment_link_url}`, seller.upi && `UPI: ${seller.upi}`, seller.bank && `Bank: ${seller.bank}`].filter(Boolean) : [];
  const due = d.due_date && !quote ? `Due: ${String(d.due_date).slice(0, 10)}` : '';
  const text = [`${what} ${d.doc_number} from ${seller.name || 'FlowXP'}`, '', ...items.map((i) => `${i.description} x ${i.qty}: ${rs(i.total_paise)}`), '', `Total: ${rs(t.total_paise)}`, due, ...pay, d.notes || ''].filter(Boolean).join('\n');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#22324d;max-width:560px">
  <p>Hi ${esc(d.client?.name || '')},</p><p>Here is your ${quote ? 'quotation' : 'invoice'} <b>${esc(d.doc_number)}</b> from ${esc(seller.name || 'FlowXP')}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th align="left" style="padding:6px 8px;background:#f8fafc">Item</th><th align="right" style="padding:6px 8px;background:#f8fafc">Qty</th><th align="right" style="padding:6px 8px;background:#f8fafc">Amount</th></tr>${rows}</table>
  <p style="font-size:16px"><b>Total ${rs(t.total_paise)}</b>${due ? ` &middot; ${esc(due.toLowerCase())}` : ''}</p>
  ${pay.map((p) => `<p style="margin:4px 0;word-break:break-all">${esc(p)}</p>`).join('')}${d.notes ? `<p style="color:#5a6b87">${esc(d.notes)}</p>` : ''}
  <p style="color:#65758e;font-size:12px">${esc(seller.name || 'FlowXP')}${seller.phone ? ` &middot; ${esc(seller.phone)}` : ''}</p></div>`;
  return { subject: `${what} ${d.doc_number} from ${seller.name || 'FlowXP'}`, text, html };
};

/* POST /api/admin/documents/:id/email { to? }: send the document to the client's email (or the one typed) */
export const emailDocument = async (req, res) => {
  const id = Number(req.params.id);
  const d = (await pool.query(`SELECT * FROM admin_documents WHERE doc_id = $1`, [id])).rows[0];
  if (!d) return bad(res, 'Not found', 404);
  if (['CANCELLED', 'DECLINED'].includes(d.status)) return bad(res, 'A cancelled document is not sent.', 409);
  const to = String(req.body?.to || d.client?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return bad(res, "Add the client's email address first.");
  if (!(await mailConfigured())) return bad(res, 'No email account is set up yet. Add it in Settings > Email.', 409);
  const seller = await company();
  const msg = documentEmail(d, seller);
  try { await deliverMail({ to, ...msg, replyTo: seller.email || undefined, fromName: seller.name || undefined }); }
  catch (error) { return bad(res, `The email did not go: ${error.message}`, 502); }
  await pool.query(`UPDATE admin_documents SET emailed_at = CURRENT_TIMESTAMP, emailed_to = $2, status = CASE WHEN status = 'DRAFT' THEN 'SENT' ELSE status END WHERE doc_id = $1`, [id, to]);
  recordAudit(req, { business_id: d.business_id, action: 'admin.document_emailed', resource_type: 'admin_document', resource_id: id, metadata: { number: d.doc_number } });
  res.json({ success: true, data: { emailed_to: to } });
};

/* POST /api/admin/documents/:id/payment-link: a Cashfree link for the invoice's total; paying it marks the invoice paid (and loads any WhatsApp credit on it) */
export const paymentLink = async (req, res) => {
  const id = Number(req.params.id);
  const d = (await pool.query(`SELECT * FROM admin_documents WHERE doc_id = $1`, [id])).rows[0];
  if (!d || d.kind !== 'INVOICE') return bad(res, 'Invoice not found', 404);
  if (!['DRAFT', 'SENT'].includes(d.status)) return bad(res, 'Only an unpaid invoice can have a payment link.', 409);
  const total = Number(d.totals?.total_paise || 0);
  if (total <= 0) return bad(res, 'The invoice total must be more than zero.');
  if (d.payment_link_url) return res.json({ success: true, data: { payment_link_url: d.payment_link_url } });
  const linkId = `${DOC_LINK_PREFIX}${id}-${Date.now().toString(36)}`;
  let link;
  try {
    link = await cashfreeCreateLink({ linkId, amount: toRupees(total), purpose: `FlowXP invoice ${d.doc_number}`, customerName: d.client?.name, customerEmail: d.client?.email, customerPhone: d.client?.phone, returnUrl: config.appOrigin, notifyUrl: `${config.appOrigin}/api/webhooks/cashfree` });
  } catch (error) { return bad(res, error instanceof CashfreeError ? error.message : 'Could not reach Cashfree', 502); }
  await pool.query(`UPDATE admin_documents SET link_id = $2, payment_link_url = $3, status = CASE WHEN status = 'DRAFT' THEN 'SENT' ELSE status END WHERE doc_id = $1`, [id, linkId, link.linkUrl]);
  recordAudit(req, { business_id: d.business_id, action: 'admin.invoice_link_created', resource_type: 'admin_document', resource_id: id, metadata: { number: d.doc_number } });
  res.json({ success: true, data: { payment_link_url: link.linkUrl } });
};

export const convert = async (req, res) => {
  const id = Number(req.params.id);
  const q = (await pool.query(`SELECT * FROM admin_documents WHERE doc_id = $1`, [id])).rows[0];
  if (!q || q.kind !== 'QUOTE') return bad(res, 'Quotation not found', 404);
  if (!['DRAFT', 'SENT', 'ACCEPTED'].includes(q.status)) return bad(res, 'This quotation cannot be turned into an invoice.', 409);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const inv = (await c.query(
      `INSERT INTO admin_documents (kind, doc_number, business_id, client, items, totals, intra_state, notes, from_quote_id, created_by)
       VALUES ('INVOICE',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [await nextNumber(c, 'INVOICE'), q.business_id, q.client, JSON.stringify(q.items), q.totals, q.intra_state, q.notes, id, req.auth.userId])).rows[0];
    await c.query(`UPDATE admin_documents SET status='CONVERTED', updated_at=CURRENT_TIMESTAMP WHERE doc_id=$1`, [id]);
    await c.query('COMMIT');
    recordAudit(req, { business_id: q.business_id, action: 'admin.quote_converted', resource_type: 'admin_document', resource_id: id, metadata: { invoice: inv.doc_number } });
    res.status(201).json({ success: true, data: inv });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

export const clientOf = async (req, res) => {
  const b = (await pool.query(`SELECT b.business_id, b.name, b.gstin, b.address, b.city, b.state, COALESCE(b.email, u.email) AS email, COALESCE(b.phone, u.phone) AS phone FROM businesses b JOIN users u ON u.user_id = b.owner_user_id WHERE b.business_id = $1`, [Number(req.params.businessId)])).rows[0];
  if (!b) return bad(res, 'Client not found', 404);
  res.json({ success: true, data: { business_id: b.business_id, name: b.name, gstin: b.gstin || '', address: [b.address, b.city].filter(Boolean).join(', '), state: b.state || '', email: b.email || '', phone: b.phone || '' } });
};

export const getCompany = async (_req, res) => res.json({ success: true, data: await company() });

export const saveCompany = async (req, res) => {
  const patch = {};
  for (const f of COMPANY_FIELDS) if (req.body?.[f] !== undefined) patch[f] = String(req.body[f]).trim().slice(0, f === 'terms' ? 1000 : 300);
  if (patch.gstin) { patch.gstin = patch.gstin.toUpperCase(); if (!GSTIN.test(patch.gstin)) return bad(res, 'That GSTIN does not look right (15 characters)'); }
  const v = await setPlatformSetting('company', patch, req.auth.userId);
  recordAudit(req, { action: 'admin.company_saved', resource_type: 'setting', resource_id: 'company' });
  res.json({ success: true, data: v.value });
};
