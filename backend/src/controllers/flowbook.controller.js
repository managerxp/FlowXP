/*
 * The FlowBook link: connect, see what has been sent and what could not be, retry, test.
 * The secret comes from FlowBook (Integrations Hub); it is stored encrypted and never returned. See modules/flowbook/outbox.js.
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';
import config from '../config/env.js';
import { decrypt, encrypt } from '../modules/crypto.js';
import { recordAudit } from '../modules/events.js';
import { hasPlanFeature } from '../modules/planFeatures.js';
import { DOMAIN, defaultSend } from '../modules/flowbook/outbox.js';
import { envelope, signature } from '../modules/flowbook/events.js';

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1)/i;

/** https only; on a production server also no address inside the network, so a setting cannot aim the server at itself. */
export const checkUrl = (value) => {
  let u;
  try { u = new URL(String(value || '').trim()); } catch { return { error: 'Enter the address of FlowBook, like https://books.example.com' }; }
  const production = config.isProduction;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !production)) return { error: 'The FlowBook address must start with https://' };
  if (production && PRIVATE_HOST.test(u.hostname)) return { error: 'That address is not a public FlowBook address' };
  return { url: `${u.protocol}//${u.host}` };
};

/* POST /api/flowbook/launch: the one sign-in. The person is already signed in to FlowXP, so FlowBook gets a signed 60-second
   handoff (who they are, which business, and the business's own trial or plan) instead of asking for another password. */
export const launch = async (req, res) => {
  if (!config.flowbookAppUrl || !config.flowbookSsoSecret) return res.status(503).json({ success: false, message: 'FlowBook is not set up on this server yet' });
  if (!hasPlanFeature(req.tenant, 'flowbook_app')) return res.status(402).json({ success: false, message: 'FlowBook is switched off for this business. Contact us to turn it on.' });
  // FlowBook is the offer of the business that signed up for FlowBook; a business of another type has it once it is paying (the FlowXP link)
  if (req.tenant.businessType !== 'FLOWBOOK' && !(req.tenant.subscription.status === 'ACTIVE' && hasPlanFeature(req.tenant, 'flowbook'))) {
    return res.status(402).json({ success: false, message: 'FlowBook is not part of this business plan. Start a FlowBook free trial from the FlowBook page, or contact us.' });
  }
  const u = (await pool.query(`SELECT name, email FROM users WHERE user_id = $1`, [req.tenant.userId])).rows[0];
  const s = req.tenant.subscription;
  const body = Buffer.from(JSON.stringify({
    sub: String(req.tenant.userId), email: u.email, name: u.name, bid: String(req.tenant.businessId), bname: req.tenant.name, role: req.tenant.role,
    status: s.status, tend: s.trial_ends_at, exp: Date.now() + 60_000
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.flowbookSsoSecret).update(body).digest('base64url');
  res.json({ success: true, data: { url: `${config.flowbookAppUrl}/sso#${body}.${sig}` } });
};

const status = async (businessId) => {
  const link = (await pool.query(`SELECT base_url, enabled, enabled_from, last_ok_at, last_error FROM flowbook_links WHERE business_id = $1`, [businessId])).rows[0] || null;
  const counts = Object.fromEntries((await pool.query(`SELECT status, COUNT(*)::int AS n FROM flowbook_outbox WHERE business_id = $1 GROUP BY status`, [businessId])).rows.map((r) => [r.status, r.n]));
  const problems = (await pool.query(
    `SELECT outbox_id, event_type, source_id, status, last_error, attempts, created_at FROM flowbook_outbox
      WHERE business_id = $1 AND status IN ('SKIPPED','DEAD') ORDER BY outbox_id DESC LIMIT 30`, [businessId])).rows;
  return { connected: Boolean(link), link, counts: { pending: counts.PENDING || 0, sent: counts.SENT || 0, skipped: counts.SKIPPED || 0, dead: counts.DEAD || 0 }, problems };
};

export const get = async (req, res) => res.json({ success: true, data: await status(req.tenant.businessId) });

/* PUT /api/flowbook { base_url, secret?, enabled } */
export const save = async (req, res) => {
  const body = req.body || {};
  const b = req.tenant.businessId;
  const existing = (await pool.query(`SELECT enabled FROM flowbook_links WHERE business_id = $1`, [b])).rows[0];
  const url = checkUrl(body.base_url);
  if (url.error) return res.status(400).json({ success: false, message: url.error });
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  if (!existing && !secret) return res.status(400).json({ success: false, message: 'Paste the secret from FlowBook (Integrations, FlowXP)' });
  if (secret && !/^fxs_[0-9a-f]{32,}$/.test(secret)) return res.status(400).json({ success: false, message: 'That does not look like a FlowBook secret (it starts with fxs_)' });
  const enabled = body.enabled === true;
  await pool.query(
    `INSERT INTO flowbook_links (business_id, base_url, secret_enc, enabled, enabled_from) VALUES ($1,$2,$3,$4::boolean, CASE WHEN $4::boolean THEN CURRENT_TIMESTAMP END)
     ON CONFLICT (business_id) DO UPDATE SET base_url = $2, secret_enc = COALESCE($5, flowbook_links.secret_enc), enabled = $4::boolean,
       enabled_from = CASE WHEN $4::boolean AND (NOT flowbook_links.enabled OR flowbook_links.enabled_from IS NULL) THEN CURRENT_TIMESTAMP ELSE flowbook_links.enabled_from END, updated_at = CURRENT_TIMESTAMP`,
    [b, url.url, secret ? encrypt(secret, DOMAIN) : '', enabled, secret ? encrypt(secret, DOMAIN) : null]);
  recordAudit(req, { action: 'flowbook.link_saved', resource_type: 'flowbook_link', resource_id: b, metadata: { enabled } });
  res.json({ success: true, data: await status(b) });
};

/* POST /api/flowbook/retry — put parked (DEAD) events back in the queue */
export const retry = async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE flowbook_outbox SET status = 'PENDING', attempts = 0, next_attempt_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND status = 'DEAD'`, [req.tenant.businessId]);
  recordAudit(req, { action: 'flowbook.retry', resource_type: 'flowbook_link', resource_id: req.tenant.businessId, metadata: { events: rowCount } });
  res.json({ success: true, data: { retried: rowCount } });
};

/* POST /api/flowbook/test — a signed test event, so a wrong address or secret shows now rather than at the first sale */
export const test = async (req, res) => {
  const link = (await pool.query(`SELECT base_url, secret_enc FROM flowbook_links WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  if (!link) return res.status(400).json({ success: false, message: 'Save the connection first' });
  const body = envelope({ eventId: crypto.randomUUID(), type: 'connection.test', businessId: req.tenant.businessId, sequence: 0, occurredAt: new Date().toISOString(), payload: {} });
  try {
    await defaultSend(`${link.base_url}/v1/integrations/flowxp/events`, body, signature(decrypt(link.secret_enc, DOMAIN), body));
    res.json({ success: true, data: { ok: true } });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
};
