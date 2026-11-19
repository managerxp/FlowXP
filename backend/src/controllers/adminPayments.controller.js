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

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const KINDS = {
  plan: { table: 'subscription_orders', resource: 'subscription_order', what: (o) => `FlowXP subscription (${String(o.billing_cycle).toLowerCase()})` },
  addon: { table: 'addon_orders', resource: 'addon_order', what: (o) => `FlowXP add-on: ${o.addon_name || o.addon_key}` }
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const METHOD_LABEL = { UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', CARD: 'Card', OTHER: 'Other', ONLINE: 'Online payment link' };

const load = async (kind, businessId, orderId) => {
  const k = KINDS[kind];
  if (!k) return null;
  const join = kind === 'addon' ? 'LEFT JOIN addons a ON a.addon_key = o.addon_key' : '';
  const extra = kind === 'addon' ? ', a.name AS addon_name' : '';
  return (await pool.query(
    `SELECT o.*${extra}, b.name AS business_name, u.name AS owner_name, u.email AS owner_email
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

const sendReceiptFor = async (o, kind) => {
  if (!o.owner_email) throw new Error('This business has no owner email.');
  if (!(await mailConfigured())) throw new Error('No email account is set up yet. Add it in Settings > Email.');
  const seller = (await getPlatformSetting('company'))?.value || {};
  const msg = receiptEmail(o, kind, seller);
  await deliverMail({ to: o.owner_email, subject: msg.subject, text: msg.text, html: msg.html, replyTo: seller.email || undefined, fromName: seller.name || undefined });
  await pool.query(`UPDATE ${KINDS[kind].table} SET receipt_sent_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [o.order_id]);
  return o.owner_email;
};

/* POST /api/admin/businesses/:id/orders/:kind/:orderId/mark-paid { method, paid_on?, note?, send_receipt? } */
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
  res.json({ success: true, data: { status: 'PAID', receipt_sent_to: receiptTo, receipt_error: receiptError } });
};

/* POST /api/admin/businesses/:id/orders/:kind/:orderId/receipt: email the owner a receipt for a paid order */
export const sendReceipt = async (req, res) => {
  const o = await load(req.params.kind, Number(req.params.id), Number(req.params.orderId));
  if (!o) return bad(res, 'Payment not found', 404);
  if (o.status !== 'PAID') return bad(res, 'A receipt is only for a payment that was received.', 409);
  try {
    const to = await sendReceiptFor(o, req.params.kind);
    recordAudit(req, { business_id: o.business_id, action: 'admin.receipt_sent', resource_type: KINDS[req.params.kind].resource, resource_id: o.order_id, metadata: { to } });
    res.json({ success: true, data: { sent_to: to } });
  } catch (e) { bad(res, e.message, 409); }
};
