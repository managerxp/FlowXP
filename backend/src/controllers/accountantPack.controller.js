/*
 * GET  /api/reports/accountant-pack?from&to           the pack as a ZIP download
 * POST /api/reports/accountant-pack/email { email, from, to }   the same ZIP emailed to the accountant (their address is remembered for next time)
 * Both need the export permission (owners, admins and accountants have it).
 */
import pool from '../config/database.js';
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
