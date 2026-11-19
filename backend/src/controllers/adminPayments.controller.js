/*
 * Payments collected by hand, and their receipts. A payment link that the client settled in cash, by UPI or by bank transfer is marked paid here: it goes through the very
 * same activation as a paid link (webhooks.controller.js), so the plan or add-on switches on and the payment counts in the revenue. A receipt can then be emailed.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { activateAddon, activateSubscription } from './webhooks.controller.js';
import { PAY_METHODS } from './adminDocuments.controller.js';
import { deliverMail, mailConfigured } from '../modules/mailer.js';
import { getPlatformSetting } from '../modules/platformSettings.js';
import { toRupees } from '../utils/money.js';
import PDFDocument from 'pdfkit';
import { render } from '../modules/messaging/templates.js';
import { deliver, channelsAvailable } from '../modules/messaging/provider.js';

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const KINDS = {
  plan: { table: 'subscription_orders', resource: 'subscription_order', what: (o) => `${o.plan_name || 'FlowXP'} subscription (${String(o.billing_cycle).toLowerCase()})` },
  addon: { table: 'addon_orders', resource: 'addon_order', what: (o) => `FlowXP add-on: ${o.addon_name || o.addon_key}` }
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const METHOD_LABEL = { UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', CARD: 'Card', OTHER: 'Other', ONLINE: 'Online payment link' };

const load = async (kind, businessId, orderId) => {
  const k = KINDS[kind];
  if (!k) return null;
  const join = kind === 'addon' ? 'LEFT JOIN addons a ON a.addon_key = o.addon_key' : 'LEFT JOIN plans p ON p.plan_code = o.plan_code';
  const extra = kind === 'addon' ? ', a.name AS addon_name' : ', p.name AS plan_name';
  return (await pool.query(
    `SELECT o.*${extra}, b.name AS business_name, u.name AS owner_name, u.email AS owner_email, COALESCE(b.phone, u.phone) AS owner_phone
       FROM ${k.table} o ${join} JOIN businesses b ON b.business_id = o.business_id JOIN users u ON u.user_id = b.owner_user_id
      WHERE o.order_id = $1 AND o.business_id = $2`, [orderId, businessId])).rows[0] || null;
};

export const receiptEmail = (o, kind, seller) => {
  const number = `RCP-${kind === 'addon' ? 'A' : 'S'}${o.order_id}`;
  const amount = `Rs ${toRupees(o.amount_paise).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = new Date(o.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const how = METHOD_LABEL[o.paid_method || 'ONLINE'] || o.paid_method;
  const what = KINDS[kind].what(o);
  const from = seller.name || 'FlowXP';
  const text = [`Payment receipt ${number}`, '', `Received from ${o.business_name}`, `For: ${what}`, `Amount: ${amount}`, `Paid by: ${how}`, `Date: ${when}`, '', `Thank you. ${from}`].join('\n');
  const row = (label, value) => `<tr><td style="padding:8px 0;color:#5b6b82">${label}</td><td align="right">${esc(value)}</td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0b1b33"><h2 style="margin:0 0 4px">Payment receipt</h2><p style="color:#5b6b82;margin:0 0 16px">${esc(number)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:15px">${row('Received from', o.business_name)}${row('For', what)}${row('Paid by', how)}${row('Date', when)}
  <tr><td style="padding:12px 0;border-top:1px solid #e3e8ef"><b>Amount received</b></td><td align="right" style="border-top:1px solid #e3e8ef"><b>${esc(amount)}</b></td></tr></table>
  <p style="color:#5b6b82;font-size:13px;margin-top:20px">Thank you. ${esc(from)}</p></div>`;
  return { subject: `Payment receipt ${number} from ${from}`, text, html, number };
};

const DAYS = { MONTHLY: 30, YEARLY: 365 };   // the same length the payment switches the plan on for (webhooks.controller.js)
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
/* The period the payment covers: from the day it was received */
export const receiptPeriod = (o) => {
  const start = new Date(o.paid_at);
  const end = new Date(start.getTime() + (DAYS[o.billing_cycle] || 30) * 86400000);
  return { start: day(start), end: day(end) };
};

/* The receipt as a one-page PDF */
export const receiptPdf = (o, kind, seller) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (b) => chunks.push(b)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
  const { number } = receiptEmail(o, kind, seller);
  const { start, end } = receiptPeriod(o);
  const ink = '#0b1b33'; const soft = '#5b6b82';
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text(seller.name || 'FlowXP');
  doc.font('Helvetica').fontSize(9).fillColor(soft).text([seller.address, seller.gstin && `GSTIN: ${seller.gstin}`, [seller.phone, seller.email].filter(Boolean).join('  |  ')].filter(Boolean).join('\n'));
  doc.moveDown(2).fillColor(ink).font('Helvetica-Bold').fontSize(20).text('PAYMENT RECEIPT');
  doc.font('Helvetica').fontSize(10).fillColor(soft).text(number).moveDown();
  const rows = [['Received from', o.business_name], ['Package', KINDS[kind].what(o)], ['Amount received', `Rs ${toRupees(o.amount_paise).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`], ['Paid by', METHOD_LABEL[o.paid_method || 'ONLINE'] || o.paid_method], ['Payment date', day(o.paid_at)], ['Start date', start], ['End date', end]];
  for (const [k, v] of rows) { const y = doc.y; doc.fillColor(soft).fontSize(11).text(k, 50, y, { width: 160 }); doc.fillColor(ink).text(String(v), 220, y, { width: 320 }); doc.moveDown(0.6); }
  doc.moveDown(2).fillColor(soft).fontSize(10).text(`Thank you. ${seller.name || 'FlowXP'}`);
  doc.end();
});

const sendReceiptFor = async (o, kind) => {
  if (!o.owner_email) throw new Error('This business has no owner email.');
  if (!(await mailConfigured())) throw new Error('No email account is set up yet. Add it in Settings > Email.');
  const seller = (await getPlatformSetting('company'))?.value || {};
  const msg = receiptEmail(o, kind, seller);
  await deliverMail({ to: o.owner_email, subject: msg.subject, text: msg.text, html: msg.html, attachments: [{ filename: `${msg.number}.pdf`, content: await receiptPdf(o, kind, seller), contentType: 'application/pdf' }], replyTo: seller.email || undefined, fromName: seller.name || undefined });
  await pool.query(`UPDATE ${KINDS[kind].table} SET receipt_sent_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [o.order_id]);
  return o.owner_email;
};

/* The receipt as a WhatsApp message from FlowXP's own number (an approved template). Returns the number it went to. */
const whatsappReceiptFor = async (o, kind) => {
  const to = String(o.owner_phone || '').replace(/\D/g, '');
  if (to.length < 10) throw new Error('This business has no WhatsApp number.');
  if (!(await channelsAvailable()).includes('WHATSAPP')) throw new Error('WhatsApp is not connected yet. Add it in Settings > Messaging.');
  const seller = (await getPlatformSetting('company'))?.value || {};
  const { number } = receiptEmail(o, kind, seller);
  const { start, end } = receiptPeriod(o);
  const message = render('ADMIN_RECEIPT', { name: o.owner_name || 'there', package: `Receipt ${number}: ${KINDS[kind].what(o)}`, amount: `Rs ${toRupees(o.amount_paise).toFixed(2)}`, start, end });
  const r = await deliver({ channel: 'WHATSAPP', to, kind: 'ADMIN_RECEIPT', text: message.text, template: message.template, document: { buffer: await receiptPdf(o, kind, seller), filename: `${number}.pdf` } });
  if (r.status !== 'SENT') throw new Error(r.note || 'WhatsApp did not send it.');
  await pool.query(`UPDATE ${KINDS[kind].table} SET receipt_sent_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [o.order_id]);
  return to;
};

/* POST /api/admin/businesses/:id/orders/:kind/:orderId/mark-paid { method, paid_on?, note?, send_receipt?, send_whatsapp? } */
export const markPaid = async (req, res) => {
  const businessId = Number(req.params.id);
  const orderId = Number(req.params.orderId);
  const kind = req.params.kind;
  const o = await load(kind, businessId, orderId);
  if (!o) return bad(res, 'Payment link not found', 404);
  if (o.status === 'PAID') return bad(res, 'This payment is already marked paid.', 409);
  if (o.status === 'CANCELLED') return bad(res, 'This link was cancelled.', 409);
  const method = String(req.body?.method || 'CASH');
  if (!PAY_METHODS.includes(method)) return bad(res, 'Choose how it was paid: UPI, bank transfer, cash, cheque, card or other.');
  const paidOn = req.body?.paid_on ? String(req.body.paid_on).slice(0, 10) : null;
  if (paidOn && (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn)))) return bad(res, 'That payment date is not a date.');
  if (paidOn && paidOn > new Date().toISOString().slice(0, 10)) return bad(res, 'The payment date cannot be in the future.');
  const manual = { method, paidOn, note: String(req.body?.note || '').trim().slice(0, 200) || null, by: req.auth.userId };
  const done = await (kind === 'addon' ? activateAddon : activateSubscription)(req, { orderId }, manual);
  if (!done) return bad(res, 'This payment was just marked paid.', 409);
  recordAudit(req, { business_id: businessId, action: 'admin.payment_marked_paid', resource_type: KINDS[kind].resource, resource_id: orderId, metadata: { amount_paise: o.amount_paise, method, ...(paidOn && { paid_on: paidOn }) } });
  let receiptTo = null;
  let receiptError = null;
  if (req.body?.send_receipt === true) {
    try { receiptTo = await sendReceiptFor({ ...o, ...done }, kind); } catch (e) { receiptError = e.message; }
  }
  let whatsappTo = null;
  if (req.body?.send_whatsapp === true) {
    try { whatsappTo = await whatsappReceiptFor({ ...o, ...done }, kind); } catch (e) { receiptError = [receiptError, e.message].filter(Boolean).join(' '); }
  }
  res.json({ success: true, data: { status: 'PAID', receipt_sent_to: receiptTo, whatsapp_sent_to: whatsappTo, receipt_error: receiptError } });
};

/* POST /api/admin/businesses/:id/orders/:kind/:orderId/receipt: email the owner a receipt for a paid order */
export const sendReceipt = async (req, res) => {
  const o = await load(req.params.kind, Number(req.params.id), Number(req.params.orderId));
  if (!o) return bad(res, 'Payment not found', 404);
  if (o.status !== 'PAID') return bad(res, 'A receipt is only for a payment that was received.', 409);
  const wa = req.body?.channel === 'whatsapp';
  try {
    const to = await (wa ? whatsappReceiptFor : sendReceiptFor)(o, req.params.kind);
    recordAudit(req, { business_id: o.business_id, action: wa ? 'admin.receipt_whatsapped' : 'admin.receipt_sent', resource_type: KINDS[req.params.kind].resource, resource_id: o.order_id, metadata: { to } });
    res.json({ success: true, data: { sent_to: to } });
  } catch (e) { bad(res, e.message, 409); }
};
