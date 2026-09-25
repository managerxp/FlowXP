/*
 * Customer messaging: settings, the message log, sending a bill by hand, campaigns, opt-out.
 * The rules (who may be messaged, what is recorded) live in modules/messaging; this file
 * validates input, applies outlet scope and shapes responses.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { branchFilter } from '../utils/scope.js';
import { channelsAvailable, isConnected, providerName } from '../modules/messaging/provider.js';
import { KINDS, TEMPLATES, metaBody } from '../modules/messaging/templates.js';
import { SEGMENTS, audience, cleanSettings, getSettings, resend, sendBill, startCampaign } from '../modules/messaging/index.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const provider = () => ({ name: providerName(), connected: isConnected(), channels: channelsAvailable() });

/* GET /api/messaging/settings */
export const getSettingsHandler = async (req, res) => {
  res.json({ success: true, data: { settings: await getSettings(pool, req.tenant.businessId), provider: provider(), segments: SEGMENTS } });
};

/* PUT /api/messaging/settings */
export const putSettings = async (req, res) => {
  const current = await getSettings(pool, req.tenant.businessId);
  const { settings, error } = cleanSettings(req.body, current);
  if (error) return bad(res, error);
  await pool.query(`UPDATE businesses SET messaging_settings = $1 WHERE business_id = $2`, [JSON.stringify(settings), req.tenant.businessId]);
  recordAudit(req, { action: 'messaging.settings_updated', resource_type: 'business', resource_id: req.tenant.businessId, metadata: req.body });
  res.json({ success: true, data: { settings, provider: provider(), segments: SEGMENTS } });
};

/* GET /api/messaging/templates — the WhatsApp templates to create once in Meta Business Manager */
export const templates = (_req, res) => {
  res.json({ success: true, data: KINDS.map((kind) => ({ kind, name: TEMPLATES[kind].name, promo: TEMPLATES[kind].promo, body: metaBody(kind) })) });
};

/* GET /api/messaging/messages?status=&kind=&limit= */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  const clauses = [];
  if (req.query.status) { values.push(String(req.query.status).toUpperCase()); clauses.push(`m.status = $${values.length}`); }
  if (req.query.kind) { values.push(String(req.query.kind).toUpperCase()); clauses.push(`m.kind = $${values.length}`); }
  // an outlet sees its own messages plus business-wide ones (offers), which have no outlet
  const scope = req.tenant.scopeBranchId == null ? '' : ` AND (m.branch_id = $${values.push(req.tenant.scopeBranchId)} OR m.branch_id IS NULL)`;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const { rows } = await pool.query(
    `SELECT m.message_id, m.kind, m.channel, m.phone, m.body, m.status, m.error, m.batch, m.created_at, m.sent_at, c.name AS customer_name
     FROM messages m LEFT JOIN customers c ON c.customer_id = m.customer_id
     WHERE m.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY m.message_id DESC LIMIT ${limit}`, values);
  res.json({ success: true, data: rows });
};

/* POST /api/messaging/messages/:id/resend */
export const resendHandler = async (req, res) => {
  const r = await resend(pool, req.tenant.businessId, req.params.id);
  if (r.problem) return bad(res, r.problem, r.code);
  res.json({ success: true, data: r.message });
};

/* POST /api/messaging/send-bill { invoice_id, phone? } */
export const sendBillHandler = async (req, res) => {
  const id = Number(req.body?.invoice_id);
  if (!id) return bad(res, 'Choose an invoice');
  const values = [id, req.tenant.businessId];
  const own = (await pool.query(`SELECT 1 FROM invoices WHERE invoice_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', values)}`, values)).rows.length;
  if (!own) return bad(res, 'Invoice not found', 404);
  const r = await sendBill(pool, { businessId: req.tenant.businessId, invoiceId: id, phone: req.body?.phone || null, createdBy: req.auth.userId });
  if (r.problem) return bad(res, r.problem, r.code);
  if (r.skipped === 'OFF') return bad(res, 'Turn messaging on first (Messaging settings)', 409);
  if (r.skipped === 'NO_PHONE') return bad(res, 'Enter a valid 10-digit mobile number');
  recordAudit(req, { action: 'messaging.bill_sent', resource_type: 'invoice', resource_id: id, metadata: { status: r.status } });
  res.status(201).json({ success: true, data: r });
};

/* POST /api/messaging/campaigns/preview { segment, days? } */
export const preview = async (req, res) => {
  const a = await audience(pool, req.tenant.businessId, req.body || {});
  if (a.error) return bad(res, a.error);
  res.json({ success: true, data: { count: Math.min(a.customers.length, 1000), capped: a.customers.length > 1000, sample: a.customers.slice(0, 5).map((c) => c.name) } });
};

/* POST /api/messaging/campaigns { segment, days?, text } — an offer to that audience; one campaign per hour */
export const campaign = async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (text.length < 5 || text.length > 300) return bad(res, 'Write the offer in 5 to 300 characters');
  if (/https?:\/\//i.test(text) && !req.body?.allow_links) return bad(res, 'Links in offers are often blocked by WhatsApp; leave the link out or confirm you want it');
  const settings = await getSettings(pool, req.tenant.businessId);
  if (settings.channel === 'OFF') return bad(res, 'Turn messaging on first (Messaging settings)', 409);

  const recent = (await pool.query(`SELECT 1 FROM messages WHERE business_id = $1 AND kind = 'OFFER' AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' LIMIT 1`, [req.tenant.businessId])).rows.length;
  if (recent) return bad(res, 'An offer was sent in the last hour. Wait before sending another so customers are not flooded.', 429);

  const a = await audience(pool, req.tenant.businessId, req.body || {});
  if (a.error) return bad(res, a.error);
  if (!a.customers.length) return bad(res, 'Nobody matches that audience');
  const { batch, recipients } = await startCampaign(pool, { businessId: req.tenant.businessId, customers: a.customers, text, createdBy: req.auth.userId });
  recordAudit(req, { action: 'messaging.campaign_sent', resource_type: 'campaign', resource_id: batch, metadata: { segment: req.body.segment, recipients } });
  res.status(202).json({ success: true, data: { batch, recipients } });
};

/* GET /api/messaging/campaigns/:batch — how a campaign is going */
export const campaignStatus = async (req, res) => {
  const { rows } = await pool.query(`SELECT status, COUNT(*)::int AS n FROM messages WHERE business_id = $1 AND batch = $2 GROUP BY status`, [req.tenant.businessId, req.params.batch]);
  res.json({ success: true, data: Object.fromEntries(rows.map((r) => [r.status.toLowerCase(), r.n])) });
};

/* POST /api/customers/:id/marketing { opt_out } — stop (or resume) offers and reminders to one customer */
export const setOptOut = async (req, res) => {
  const optOut = req.body?.opt_out === true;
  const { rowCount } = await pool.query(`UPDATE customers SET marketing_opt_out = $1 WHERE customer_id = $2 AND business_id = $3`, [optOut, req.params.id, req.tenant.businessId]);
  if (!rowCount) return bad(res, 'Not found', 404);
  recordAudit(req, { action: 'customer.marketing_opt_out', resource_type: 'customer', resource_id: req.params.id, metadata: { opt_out: optOut } });
  res.json({ success: true, data: { customer_id: Number(req.params.id), marketing_opt_out: optOut } });
};
