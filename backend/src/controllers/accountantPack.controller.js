/*
 * GET  /api/reports/accountant-pack?from&to           the pack as a ZIP download
 * POST /api/reports/accountant-pack/email { email, from, to }   the same ZIP emailed to the accountant (their address is remembered for next time)
 * Both need the export permission (owners, admins and accountants have it).
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';
import config from '../config/env.js';
import { sendMail } from '../modules/mailer.js';
import { buildPack, zip } from '../modules/accountantPack.js';
import { checkEmail } from '../utils/validate.js';
import { recordAudit } from '../modules/events.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const period = async (src, businessId) => {
  const to = DATE.test(src.to || '') ? src.to : await businessToday(businessId);
  const from = DATE.test(src.from || '') ? src.from : addDaysISO(to, -30);
  return from > to ? null : { from, to };
};
const SPAN_LIMIT_DAYS = 400;
const tooLong = ({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86400000 > SPAN_LIMIT_DAYS;
const fileName = ({ from, to }) => `accountant-pack-${from}-to-${to}.zip`;

export const download = async (req, res) => {
  const p = await period(req.query, req.tenant.businessId);
  if (!p) return res.status(400).json({ success: false, message: 'The start date is after the end date' });
  if (tooLong(p)) return res.status(400).json({ success: false, message: 'Choose a period of up to about a year' });
  const bytes = zip(await buildPack(req.tenant, p.from, p.to));
  recordAudit(req, { action: 'reports.accountant_pack', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { ...p, via: 'download' } });
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${fileName(p)}"`);
  res.send(bytes);
};

/*
 * Sharing on WhatsApp: a ZIP cannot ride in a wa.me message, so the message carries a download link that works for 7 days with no sign-in.
 * The link is the period and the business, signed with the server's secret (HMAC): it cannot be changed to another business or period,
 * and it opens only the same pack the owner could download.
 */
const LINK_DAYS = 7;
const sign = (body) => crypto.createHmac('sha256', `${config.jwtSecret}:accountant-pack`).update(body).digest('base64url');
export const packToken = (businessId, { from, to }, expiresAt) => { const body = `${businessId}.${from}.${to}.${expiresAt}`; return `${Buffer.from(body).toString('base64url')}.${sign(body)}`; };
export const readPackToken = (token, now = Date.now()) => {
  const [b64, mac] = String(token || '').split('.');
  if (!b64 || !mac) return null;
  const body = Buffer.from(b64, 'base64url').toString();
  const expected = sign(body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const [businessId, from, to, exp] = body.split('.');
  if (!(Number(exp) > now) || !DATE.test(from) || !DATE.test(to)) return null;
  return { businessId: Number(businessId), from, to };
};

/* POST /api/reports/accountant-pack/whatsapp { from, to, phone? } — the message and the wa.me address; the shop's own WhatsApp sends it */
export const whatsapp = async (req, res) => {
  const p = await period(req.body || {}, req.tenant.businessId);
  if (!p) return res.status(400).json({ success: false, message: 'The start date is after the end date' });
  if (tooLong(p)) return res.status(400).json({ success: false, message: 'Choose a period of up to about a year' });
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  const to = phone.length === 10 ? `91${phone}` : phone.length >= 11 && phone.length <= 15 ? phone : '';
  const business = (await pool.query('SELECT name FROM businesses WHERE business_id = $1', [req.tenant.businessId])).rows[0];
  const link = `${config.appOrigin}/api/public/accountant-pack/${packToken(req.tenant.businessId, p, Date.now() + LINK_DAYS * 86400000)}`;
  const text = [`Accounts for ${business?.name || 'the business'}, ${p.from} to ${p.to}: sales and purchase registers, HSN and tax summaries, profit and loss, expenses and dues.`, '', `Download (works for ${LINK_DAYS} days): ${link}`].join('\n');
  if (to) await pool.query(`UPDATE businesses SET receipt_settings = receipt_settings || $1::jsonb WHERE business_id = $2`, [JSON.stringify({ accountant_phone: to }), req.tenant.businessId]);
  recordAudit(req, { action: 'reports.accountant_pack', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { ...p, via: 'whatsapp' } });
  res.json({ success: true, data: { link, text, phone: to || null, wa_url: `https://wa.me/${to}?text=${encodeURIComponent(text)}` } });
};

/* GET /api/public/accountant-pack/:token — the ZIP behind a shared link */
export const publicDownload = async (req, res) => {
  const t = readPackToken(req.params.token);
  if (!t) return res.status(404).type('text/plain').send('This link has expired or is not valid. Ask for a new one.');
  const bytes = zip(await buildPack({ businessId: t.businessId, branchId: null, scopeBranchId: null, role: 'OWNER', permissions: {} }, t.from, t.to));
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${fileName(t)}"`);
  res.send(bytes);
};

export const email = async (req, res) => {
  const to = String(req.body?.email || '').trim();
  const bad = checkEmail(to);
  if (bad) return res.status(400).json({ success: false, message: bad });
  const p = await period(req.body || {}, req.tenant.businessId);
  if (!p) return res.status(400).json({ success: false, message: 'The start date is after the end date' });
  if (tooLong(p)) return res.status(400).json({ success: false, message: 'Choose a period of up to about a year' });
  const business = (await pool.query('SELECT name FROM businesses WHERE business_id = $1', [req.tenant.businessId])).rows[0];
  const bytes = zip(await buildPack(req.tenant, p.from, p.to));
  await sendMail({
    to, subject: `${business?.name || 'FlowXP'}: accounts for ${p.from} to ${p.to}`,
    text: [`Hello,`, '', `Attached are the accounts for ${business?.name || 'the business'} for ${p.from} to ${p.to}: the sales and purchase registers, HSN and tax-rate summaries, profit and loss, expenses, every transaction, and what is owed each way.`, '', 'Sent from FlowXP.'].join('\n'),
    attachments: [{ filename: fileName(p), content: bytes, contentType: 'application/zip' }]
  });
  await pool.query(`UPDATE businesses SET receipt_settings = receipt_settings || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE business_id = $2`, [JSON.stringify({ accountant_email: to }), req.tenant.businessId]);
  recordAudit(req, { action: 'reports.accountant_pack', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { ...p, via: 'email' } });
  res.json({ success: true, data: { sent_to: to } });
};
