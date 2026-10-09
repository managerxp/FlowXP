/*
 * Notifications: decide who should hear about something, respect what they
 * asked to hear, store it, and queue any email.
 *
 * Who hears is decided by the same permissions that gate the underlying page,
 * so a notification can never reveal something its recipient couldn't open
 * (leakage findings go only to people with 'settings', for the same reason the
 * leakage page does). Delivery is never in the request path: notify() writes
 * rows and, for email, a job that the worker sends and retries.
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { enqueue } from './jobs.js';
import { pushToUsers } from './push.js';

/* category -> the permission (or any one of several) a person needs to receive it, and whether it goes to their phone unless they switch that off. */
export const CATEGORIES = {
  stock:        { label: 'Stock & purchasing', permission: 'inventory', push: true,  description: 'Items about to run out, and what to order.' },
  leakage:      { label: 'Revenue leakage',    permission: 'settings',  push: true,  description: 'Unusual discounts, cancellations, refunds and wastage.' },
  kitchen:      { label: 'Kitchen delays',     permission: 'reports',   push: true,  description: 'An order that is taking much longer than it should.' },
  sales:        { label: 'Daily summary',      permission: 'reports',   push: false, description: 'How the day went, each evening.' },
  integrations: { label: 'Integrations',       permission: 'settings',  push: true,  description: 'A delivery platform order that could not be received.' },
  account:      { label: 'Account',            permission: 'settings',  push: false, description: 'Your trial and subscription.' },
  // what happens on the floor, minute to minute: phone only, never kept in the inbox
  orders:       { label: 'New orders',         permission: ['billing', 'kitchen'], push: true, description: 'A guest or a delivery app has sent an order that needs accepting or cooking.' },
  ready:        { label: 'Order ready',        permission: 'billing',   push: true,  description: 'A dish for your table is ready to take out.' },
  bookings:     { label: 'New bookings',       permission: 'appointments', push: true, description: 'A client has booked online.' }
};

const allowed = (spec, who) => [].concat(spec.permission).some((p) => hasPermission(who, p));

const SEVERITIES = ['informational', 'warning', 'critical', 'positive'];

/**
 * Active members of a business who may receive a category, with their preference for it.
 * With a branchId (an outlet-level event) that is group users plus people pinned to that outlet;
 * without one (a business-wide event) only group users, so a pinned manager is never told about
 * other outlets. A business with a single outlet has no such distinction.
 */
export const recipientsFor = async (businessId, category, db = pool, branchId = null) => {
  const spec = CATEGORIES[category];
  if (!spec) throw new Error(`Unknown notification category: ${category}`);
  const { rows } = await db.query(
    `SELECT bu.user_id, bu.role, bu.permissions, u.email, u.name,
            COALESCE(np.in_app, TRUE) AS in_app, COALESCE(np.email, FALSE) AS email_on, COALESCE(np.push, $4::boolean) AS push_on
     FROM business_users bu
     JOIN users u ON u.user_id = bu.user_id
     LEFT JOIN notification_preferences np ON np.business_id = bu.business_id AND np.user_id = bu.user_id AND np.category = $2
     WHERE bu.business_id = $1 AND bu.status = 'ACTIVE'
       AND (bu.branch_id IS NULL OR (SELECT COUNT(*) FROM branches WHERE business_id = $1 AND status = 'ACTIVE') <= 1 OR bu.branch_id = $3::int)`,
    [businessId, category, branchId, spec.push]
  );
  return rows.filter((r) => allowed(spec, { role: r.role, permissions: r.permissions }));
};

/**
 * Notify everyone who should hear about `category`. Returns how many people
 * were newly notified (0 when it was already sent for this dedupeKey).
 */
export const notify = async (businessId, { category, type, severity = 'informational', title, body = null, link = null, dedupeKey = null, metadata = {}, branchId = null, userIds = null, channels = {}, route = null, urgent = false }, db = pool) => {
  if (!SEVERITIES.includes(severity)) throw new Error(`Unknown severity: ${severity}`);
  let sent = 0;
  const phones = [];
  for (const person of await recipientsFor(businessId, category, db, branchId)) {
    if (userIds && !userIds.includes(person.user_id)) continue;
    const inApp = channels.inApp !== false && person.in_app;
    const email = channels.email !== false && person.email_on;
    const push = channels.push !== false && person.push_on;
    if (!inApp && !email && !push) continue;

    let created = true;
    if (inApp) {
      const { rowCount } = await db.query(
        `INSERT INTO notifications (business_id, user_id, category, type, severity, title, body, link, dedupe_key, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (business_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [businessId, person.user_id, category, type, severity, title.slice(0, 160), body, link, dedupeKey, JSON.stringify(metadata)]
      );
      created = rowCount > 0;
    }
    if (!created) continue;   // already told this person about this, for this period
    sent++;

    if (email && person.email) {
      await enqueue('email', { to: person.email, name: person.name, subject: `FlowXP: ${title}`, title, body, link }, { db });
    }
    if (push) phones.push(person.user_id);
  }
  // one job for everyone's phones; the app opens `route` (a screen it knows) when the notification is tapped
  if (phones.length) await pushToUsers(phones, { title, body, urgent, data: { route: route || null, category, business_id: businessId } }, db);
  return sent;
};

export const unreadCount = async (businessId, userId) =>
  Number((await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE business_id = $1 AND user_id = $2 AND read_at IS NULL`, [businessId, userId])).rows[0].n);

export const list = async (businessId, userId, { unreadOnly = false, limit = 30, before = null } = {}) => {
  const values = [businessId, userId];
  let extra = '';
  if (unreadOnly) extra += ' AND read_at IS NULL';
  if (before) { values.push(before); extra += ` AND notification_id < $${values.length}`; }
  values.push(Math.min(100, Math.max(1, limit)));
  const { rows } = await pool.query(
    `SELECT notification_id, category, type, severity, title, body, link, read_at, created_at
     FROM notifications WHERE business_id = $1 AND user_id = $2${extra} ORDER BY notification_id DESC LIMIT $${values.length}`,
    values
  );
  return rows;
};

export const markRead = async (businessId, userId, id) =>
  (await pool.query(`UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE business_id = $1 AND user_id = $2 AND notification_id = $3`, [businessId, userId, id])).rowCount;

export const markAllRead = async (businessId, userId) =>
  (await pool.query(`UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND user_id = $2 AND read_at IS NULL`, [businessId, userId])).rowCount;

/** The categories a person can receive, with their current choices. */
export const preferencesFor = async (tenant, userId) => {
  const saved = new Map((await pool.query(`SELECT category, in_app, email, push FROM notification_preferences WHERE business_id = $1 AND user_id = $2`, [tenant.businessId, userId])).rows.map((r) => [r.category, r]));
  return Object.entries(CATEGORIES)
    .filter(([, spec]) => allowed(spec, tenant))
    .map(([category, spec]) => ({ category, label: spec.label, description: spec.description, in_app: saved.get(category)?.in_app ?? true, email: saved.get(category)?.email ?? false, push: saved.get(category)?.push ?? spec.push }));
};

export const savePreferences = async (tenant, userId, choices) => {
  const allowed = new Set((await preferencesFor(tenant, userId)).map((p) => p.category));
  for (const c of choices) {
    if (!allowed.has(c.category)) continue;
    await pool.query(
      `INSERT INTO notification_preferences (business_id, user_id, category, in_app, email, push) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (business_id, user_id, category) DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email, push = COALESCE(EXCLUDED.push, notification_preferences.push)`,
      [tenant.businessId, userId, c.category, Boolean(c.in_app), Boolean(c.email), typeof c.push === 'boolean' ? c.push : null]
    );
  }
};
