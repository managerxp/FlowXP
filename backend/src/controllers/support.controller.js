/*
 * Support center. A signed-in person raises a ticket from the web app or the phone; FlowXP's admin answers from the Super Admin;
 * both sides see one conversation. OPEN = waiting for FlowXP, ANSWERED = waiting for the client, CLOSED = done (a reply reopens it).
 *
 *   POST /api/support/tickets            { subject, category, body }       raise one
 *   GET  /api/support/tickets                                              my tickets
 *   GET  /api/support/tickets/:id                                          one, with every message
 *   POST /api/support/tickets/:id/reply  { body }                          write back
 *   POST /api/support/tickets/:id/close
 *   GET  /api/admin/support/tickets?status&search     all tickets          GET /:id   one       POST /:id/reply   answer
 *   PATCH /api/admin/support/tickets/:id { status }                         close or reopen
 *
 * The person and business come from the signed-in session, never from the request, so nobody can write into someone else's ticket.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { getPlatformSetting } from '../modules/platformSettings.js';
import { pushToUsers } from '../modules/push.js';
import { sendMail } from '../modules/mailer.js';

export const CATEGORIES = ['BILLING', 'WHATSAPP', 'SETUP', 'BUG', 'QUESTION', 'OTHER'];
export const STATUSES = ['OPEN', 'ANSWERED', 'CLOSED'];
const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

const messagesOf = async (id) => (await pool.query(
  `SELECT m.message_id, m.sender, m.body, m.created_at, u.name AS from_name FROM support_messages m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.ticket_id = $1 ORDER BY m.message_id`, [id])).rows;

/* ── the client's side ──────────────────────────────────────────────────── */
export const create = async (req, res) => {
  const subject = clean(req.body?.subject, 160); const body = clean(req.body?.body, 4000);
  if (subject.length < 3) return bad(res, 'Give your question a short title.');
  if (body.length < 10) return bad(res, 'Tell us a little more, in at least a few words.');
  const category = CATEGORIES.includes(String(req.body?.category)) ? String(req.body.category) : 'OTHER';
  const t = (await pool.query(
    `INSERT INTO support_tickets (business_id, user_id, subject, category) VALUES ($1,$2,$3,$4) RETURNING ticket_id`,
    [req.tenant.businessId, req.auth.userId, subject, category])).rows[0];
  await pool.query(`INSERT INTO support_messages (ticket_id, sender, user_id, body) VALUES ($1,'CLIENT',$2,$3)`, [t.ticket_id, req.auth.userId, body]);
  notifyTeam(req.tenant.businessId, req.auth.userId, subject, body).catch(() => {});
  res.status(201).json({ success: true, data: { ticket_id: Number(t.ticket_id) } });
};

/* An email to FlowXP's own support address (Super Admin > Invoices > company email), so a new ticket is seen even when no one has the console open. */
const notifyTeam = async (businessId, userId, subject, body) => {
  const to = (await getPlatformSetting('company'))?.value?.email;
  if (!to) return;
  const who = (await pool.query(`SELECT u.name, b.name AS business FROM users u, businesses b WHERE u.user_id = $1 AND b.business_id = $2`, [userId, businessId])).rows[0];
  await sendMail({ to, subject: `Support: ${subject}`, text: `${who?.name || 'A client'} (${who?.business || 'a business'}) wrote:\n\n${body}\n\nAnswer it in Super Admin > Support.` });
};

export const mine = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ticket_id, subject, category, status, unread_client, created_at, last_message_at FROM support_tickets
      WHERE business_id = $1 AND user_id = $2 ORDER BY last_message_at DESC LIMIT 100`, [req.tenant.businessId, req.auth.userId]);
  res.json({ success: true, data: rows.map((r) => ({ ...r, ticket_id: Number(r.ticket_id) })) });
};

const mineOne = async (req) => (await pool.query(
  `SELECT * FROM support_tickets WHERE ticket_id = $1 AND business_id = $2 AND user_id = $3`, [Number(req.params.id) || 0, req.tenant.businessId, req.auth.userId])).rows[0];

export const getMine = async (req, res) => {
  const t = await mineOne(req);
  if (!t) return bad(res, 'Not found', 404);
  await pool.query(`UPDATE support_tickets SET unread_client = FALSE WHERE ticket_id = $1`, [t.ticket_id]);
  res.json({ success: true, data: { ...t, ticket_id: Number(t.ticket_id), unread_client: false, messages: await messagesOf(t.ticket_id) } });
};

export const replyMine = async (req, res) => {
  const t = await mineOne(req);
  if (!t) return bad(res, 'Not found', 404);
  const body = clean(req.body?.body, 4000);
  if (!body) return bad(res, 'Write your message first.');
  await pool.query(`INSERT INTO support_messages (ticket_id, sender, user_id, body) VALUES ($1,'CLIENT',$2,$3)`, [t.ticket_id, req.auth.userId, body]);
  await pool.query(`UPDATE support_tickets SET status = 'OPEN', unread_admin = TRUE, closed_at = NULL, last_message_at = CURRENT_TIMESTAMP WHERE ticket_id = $1`, [t.ticket_id]);
  res.status(201).json({ success: true, data: { messages: await messagesOf(t.ticket_id) } });
};

export const closeMine = async (req, res) => {
  const t = await mineOne(req);
  if (!t) return bad(res, 'Not found', 404);
  await pool.query(`UPDATE support_tickets SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP WHERE ticket_id = $1`, [t.ticket_id]);
  res.json({ success: true, data: { status: 'CLOSED' } });
};

/** How many of my tickets have an answer I have not read, for a badge. */
export const unreadMine = async (req, res) => {
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM support_tickets WHERE business_id = $1 AND user_id = $2 AND unread_client`, [req.tenant.businessId, req.auth.userId])).rows[0].n;
  res.json({ success: true, data: { unread: n } });
};

/* ── Super Admin ────────────────────────────────────────────────────────── */
export const adminList = async (req, res) => {
  const params = []; const where = [];
  const status = String(req.query.status || '').toUpperCase();
  if (STATUSES.includes(status)) { params.push(status); where.push(`t.status = $${params.length}`); }
  const search = clean(req.query.search, 80);
  if (search) { params.push(`%${search}%`); where.push(`(t.subject ILIKE $${params.length} OR b.name ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  const { rows } = await pool.query(
    `SELECT t.ticket_id, t.subject, t.category, t.status, t.unread_admin, t.created_at, t.last_message_at, b.business_id, b.name AS business_name, u.name AS user_name, u.email AS user_email
       FROM support_tickets t LEFT JOIN businesses b ON b.business_id = t.business_id LEFT JOIN users u ON u.user_id = t.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (t.status = 'OPEN') DESC, t.last_message_at DESC LIMIT 200`, params);
  res.json({ success: true, data: rows.map((r) => ({ ...r, ticket_id: Number(r.ticket_id) })) });
};

export const adminGet = async (req, res) => {
  const id = Number(req.params.id) || 0;
  const t = (await pool.query(
    `SELECT t.*, b.name AS business_name, b.business_type, u.name AS user_name, u.email AS user_email, COALESCE(u.phone, b.phone) AS user_phone
       FROM support_tickets t LEFT JOIN businesses b ON b.business_id = t.business_id LEFT JOIN users u ON u.user_id = t.user_id WHERE t.ticket_id = $1`, [id])).rows[0];
  if (!t) return bad(res, 'Not found', 404);
  await pool.query(`UPDATE support_tickets SET unread_admin = FALSE WHERE ticket_id = $1`, [id]);
  res.json({ success: true, data: { ...t, ticket_id: Number(t.ticket_id), unread_admin: false, messages: await messagesOf(id) } });
};

export const adminReply = async (req, res) => {
  const id = Number(req.params.id) || 0;
  const t = (await pool.query(`SELECT * FROM support_tickets WHERE ticket_id = $1`, [id])).rows[0];
  if (!t) return bad(res, 'Not found', 404);
  const body = clean(req.body?.body, 4000);
  if (!body) return bad(res, 'Write your answer first.');
  await pool.query(`INSERT INTO support_messages (ticket_id, sender, user_id, body) VALUES ($1,'ADMIN',$2,$3)`, [id, req.auth.userId, body]);
  await pool.query(`UPDATE support_tickets SET status = 'ANSWERED', unread_client = TRUE, unread_admin = FALSE, closed_at = NULL, last_message_at = CURRENT_TIMESTAMP WHERE ticket_id = $1`, [id]);
  if (t.user_id && t.business_id) {
    const title = 'FlowXP support replied';
    await pool.query(
      `INSERT INTO notifications (business_id, user_id, category, type, severity, title, body, link, dedupe_key, metadata) VALUES ($1,$2,'account','support_reply','informational',$3,$4,$5,$6,'{}')
       ON CONFLICT (business_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [t.business_id, t.user_id, title, t.subject.slice(0, 120), `/app/support?open=${id}`, `support-${id}-${Date.now()}`]);
    pushToUsers([t.user_id], { title, body: t.subject.slice(0, 120), data: { route: 'support', business_id: t.business_id } }).catch(() => {});
  }
  recordAudit(req, { business_id: t.business_id, action: 'admin.support_replied', resource_type: 'support_ticket', resource_id: id, metadata: {} });
  res.status(201).json({ success: true, data: { messages: await messagesOf(id) } });
};

export const adminSetStatus = async (req, res) => {
  const id = Number(req.params.id) || 0;
  const status = String(req.body?.status || '').toUpperCase();
  if (!['OPEN', 'CLOSED'].includes(status)) return bad(res, 'Choose Open or Closed.');
  const out = await pool.query(`UPDATE support_tickets SET status = $2::varchar, closed_at = CASE WHEN $2::varchar = 'CLOSED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE ticket_id = $1 RETURNING business_id`, [id, status]);
  if (!out.rowCount) return bad(res, 'Not found', 404);
  recordAudit(req, { business_id: out.rows[0].business_id, action: `admin.support_${status.toLowerCase()}`, resource_type: 'support_ticket', resource_id: id, metadata: {} });
  res.json({ success: true, data: { status } });
};

/** Tickets waiting for FlowXP, for the badge in the console. */
export const adminCount = async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM support_tickets WHERE status = 'OPEN'`)).rows[0].n;
