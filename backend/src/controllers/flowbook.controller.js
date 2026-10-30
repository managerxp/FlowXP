/*
 * The FlowBook feed: switch it on or off, see what has been sent to the books and what could not be, retry. FlowBook is part of
 * this app, so there is no address and no secret to enter. See modules/flowbook/outbox.js.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { ensureLink } from '../modules/flowbook/outbox.js';

const status = async (businessId) => {
  const link = (await pool.query(`SELECT base_url, enabled, enabled_from, last_ok_at, last_error FROM flowbook_links WHERE business_id = $1`, [businessId])).rows[0] || null;
  const counts = Object.fromEntries((await pool.query(`SELECT status, COUNT(*)::int AS n FROM flowbook_outbox WHERE business_id = $1 GROUP BY status`, [businessId])).rows.map((r) => [r.status, r.n]));
  const problems = (await pool.query(
    `SELECT outbox_id, event_type, source_id, status, last_error, attempts, created_at FROM flowbook_outbox
      WHERE business_id = $1 AND status IN ('SKIPPED','DEAD') ORDER BY outbox_id DESC LIMIT 30`, [businessId])).rows;
  return { connected: Boolean(link), link, counts: { pending: counts.PENDING || 0, sent: counts.SENT || 0, skipped: counts.SKIPPED || 0, dead: counts.DEAD || 0 }, problems };
};

export const get = async (req, res) => res.json({ success: true, data: await status(req.tenant.businessId) });

/* PUT /api/flowbook { enabled }: sales made from now on are sent to the books (or not) */
export const save = async (req, res) => {
  const b = req.tenant.businessId;
  const enabled = req.body?.enabled === true;
  await ensureLink(b, enabled);
  recordAudit(req, { action: 'flowbook.link_saved', resource_type: 'flowbook_link', resource_id: b, metadata: { enabled } });
  res.json({ success: true, data: await status(b) });
};

/* POST /api/flowbook/retry — put parked (DEAD) events back in the queue */
export const retry = async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE flowbook_outbox SET status = 'PENDING', attempts = 0, next_attempt_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND status = 'DEAD'`, [req.tenant.businessId]);
  recordAudit(req, { action: 'flowbook.retry', resource_type: 'flowbook_link', resource_id: req.tenant.businessId, metadata: { events: rowCount } });
  res.json({ success: true, data: { retried: rowCount } });
};
