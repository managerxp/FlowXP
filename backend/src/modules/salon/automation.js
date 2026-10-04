/*
 * Salon automations: reminders and nudges that run by themselves, built on FlowXP's messaging and job worker.
 *
 * Nothing here talks to WhatsApp, SMS or email. A message is handed to messaging's `send()`, which applies the
 * business's chosen channel (off, WhatsApp or SMS), respects opt-outs for promotional messages, records the
 * message and reports the outcome. Swapping or adding a provider is a change in modules/messaging/provider.js and
 * leaves this file alone; email and any future channel plug in the same way.
 *
 * Each automation is a row in salon_automations (on/off plus its settings). The worker calls `runScan` every
 * tick; it does real work at most every few minutes, and salon_automation_log (unique per automation, record and
 * day) guarantees a customer never gets the same reminder twice however often the scan runs. A failure in one
 * automation or one message never stops the others.
 */
import crypto from 'node:crypto';
import pool from '../../config/database.js';
import { registerScan } from '../jobs.js';
import { notify } from '../notifications.js';
import { send } from '../messaging/index.js';
import { businessToday } from '../../utils/dates.js';
import { toRupees } from '../../utils/money.js';
import { SalonError, bool, int, text } from './common.js';
import { getSettings } from './settings.js';
import { alertCounts } from './alerts.js';
import { expirePoints, expiringSoonAll } from './loyalty.js';
import { expireMemberships, expirePackages } from './entitlements.js';
import { localParts, toClock } from './schedule.js';
import { segmentCondition, parseSegment } from './segments.js';

export const AUTOMATIONS = {
  APPOINTMENT_UPDATES: { label: 'Appointment confirmations', description: 'Tell a client when an appointment is booked or cancelled.', default_on: true, config: {} },
  APPOINTMENT_REMINDER: { label: 'Appointment reminder', description: 'Remind a client before their appointment.', default_on: false, config: { hours_before: 24 } },
  BIRTHDAY: { label: 'Birthday message', description: 'Wish a client on their birthday.', default_on: false, config: { offer_text: 'Enjoy a special treat on us this month.' } },
  ANNIVERSARY: { label: 'Anniversary message', description: 'Wish a client on their anniversary.', default_on: false, config: { offer_text: 'Celebrate with a little something from us.' } },
  MEMBERSHIP_EXPIRY: { label: 'Membership expiry reminder', description: 'Remind a member before their membership ends.', default_on: false, config: { days_before: 7 } },
  POINTS_EXPIRY: { label: 'Loyalty points expiry', description: 'Warn a client before their points expire.', default_on: false, config: { days_before: 14 } },
  REVISIT: { label: 'Revisit reminder', description: 'Invite a client back some days after their last visit.', default_on: false, config: { days_after: 30 } },
  INACTIVE: { label: 'Inactive customer reminder', description: 'Win back a client who has not visited for a long time.', default_on: false, config: { days: 60, offer_text: 'Come back and see what is new.' } },
  PAYMENT_REMINDER: { label: 'Payment reminder', description: 'Remind a client about a bill that is still unpaid.', default_on: false, config: { days_overdue: 3, repeat_days: 7 } },
  LOW_STOCK: { label: 'Stock alerts', description: 'Notify the team about low, expiring and expired stock.', default_on: true, config: {}, internal: true }
};

const ranges = {
  hours_before: [1, 168], days_before: [1, 90], days_after: [7, 365], days: [14, 730], days_overdue: [1, 120], repeat_days: [1, 60]
};

export const getAutomations = async (db, businessId) => {
  const rows = new Map((await db.query(`SELECT automation_key, is_enabled, config FROM salon_automations WHERE business_id = $1`, [businessId])).rows.map((r) => [r.automation_key, r]));
  return Object.entries(AUTOMATIONS).map(([key, def]) => {
    const row = rows.get(key);
    return { key, label: def.label, description: def.description, internal: Boolean(def.internal), is_enabled: row ? row.is_enabled : def.default_on, config: { ...def.config, ...(row?.config || {}) }, defaults: def.config };
  });
};

/** Validate one automation's update: { is_enabled?, config? }. Returns the row to store. */
export const cleanAutomation = (key, body) => {
  const def = AUTOMATIONS[key];
  if (!def) throw new SalonError(404, 'Not found');
  const out = {};
  if ('is_enabled' in body) out.is_enabled = bool(body.is_enabled);
  if (body.config && typeof body.config === 'object') {
    const config = {};
    for (const [k, v] of Object.entries(body.config)) {
      if (!(k in def.config)) throw new SalonError(400, `Unknown setting: ${k}`);
      if (k in ranges) config[k] = int(v, def.label, { min: ranges[k][0], max: ranges[k][1], required: true });
      else config[k] = text(v, def.label, { max: 200, required: true });
    }
    out.config = config;
  }
  return out;
};

export const saveAutomation = async (db, businessId, key, patch) => {
  const current = (await getAutomations(db, businessId)).find((a) => a.key === key);
  const next = { is_enabled: patch.is_enabled ?? current.is_enabled, config: { ...current.config, ...(patch.config || {}) } };
  await db.query(
    `INSERT INTO salon_automations (business_id, automation_key, is_enabled, config) VALUES ($1,$2,$3,$4)
     ON CONFLICT (business_id, automation_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, config = EXCLUDED.config, updated_at = CURRENT_TIMESTAMP`,
    [businessId, key, next.is_enabled, JSON.stringify(next.config)]);
  return { ...current, ...next };
};

/** Claim the right to send this reminder once. False when it has already gone (or been claimed) for that day. */
const claim = async (db, businessId, key, relatedType, relatedId, runOn) =>
  (await db.query(
    `INSERT INTO salon_automation_log (business_id, automation_key, related_type, related_id, run_on) VALUES ($1,$2,$3,$4,$5::date)
     ON CONFLICT DO NOTHING RETURNING log_id`, [businessId, key, relatedType, relatedId, runOn])).rows.length > 0;

const whenText = (instant, tz) => {
  const p = localParts(instant, tz);
  return `${new Date(`${p.date}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })}, ${toClock(p.minutes)}`;
};

/* ── appointment confirmations (event-driven) ─────────────────────────────────────────────── */

/**
 * Called after an appointment is booked, moved or cancelled. Unawaited and never throws: a message problem must
 * not fail a booking.
 */
export const afterAppointment = (businessId, appointmentId, event) => {
  (async () => {
    const auto = (await getAutomations(pool, businessId)).find((a) => a.key === 'APPOINTMENT_UPDATES');
    if (!auto?.is_enabled) return;
    const a = (await pool.query(
      `SELECT a.appointment_id, a.branch_id, a.customer_id, a.start_at, COALESCE(c.name, a.guest_name) AS name, COALESCE(c.phone, a.guest_phone) AS phone,
              b.name AS business, COALESCE(b.timezone, 'Asia/Kolkata') AS tz,
              (SELECT string_agg(p.name, ', ' ORDER BY l.start_at) FROM salon_appointment_services l JOIN products p ON p.product_id = l.service_id WHERE l.appointment_id = a.appointment_id) AS services
       FROM salon_appointments a JOIN businesses b ON b.business_id = a.business_id LEFT JOIN customers c ON c.customer_id = a.customer_id
       WHERE a.appointment_id = $1 AND a.business_id = $2`, [appointmentId, businessId])).rows[0];
    if (!a?.phone) return;
    const cancelled = event === 'CANCELLED';
    await send(pool, {
      businessId, branchId: a.branch_id, customerId: a.customer_id, phone: a.phone, kind: cancelled ? 'SALON_APPT_CANCELLED' : 'SALON_APPT_BOOKED',
      values: { name: a.name || 'there', business: a.business, when: whenText(a.start_at, a.tz), services: a.services || 'your services' }, related: { type: 'salon_appointment', id: a.appointment_id }
    });
  })().catch((error) => console.error('[salon] appointment message failed:', error.message));
};

/* ── the scheduled ones ───────────────────────────────────────────────────────────────────── */

const reach = async (db, job, customer, kind, values) => {
  if (!customer.phone) return false;
  const r = await send(db, { businessId: job.businessId, branchId: null, customerId: customer.customer_id ?? null, phone: customer.phone, kind, values: { business: job.business, ...values }, related: job.related ?? null });
  return !r.skipped;
};

const runners = {
  async APPOINTMENT_REMINDER(db, job, config) {
    const rows = (await db.query(
      `SELECT a.appointment_id, a.customer_id, a.start_at, COALESCE(c.name, a.guest_name) AS name, COALESCE(c.phone, a.guest_phone) AS phone,
              (SELECT string_agg(p.name, ', ' ORDER BY l.start_at) FROM salon_appointment_services l JOIN products p ON p.product_id = l.service_id WHERE l.appointment_id = a.appointment_id) AS services
       FROM salon_appointments a LEFT JOIN customers c ON c.customer_id = a.customer_id
       WHERE a.business_id = $1 AND a.status IN ('BOOKED','CONFIRMED') AND a.reminder_sent_at IS NULL AND a.start_at > now() AND a.start_at <= now() + ($2 || ' hours')::interval LIMIT 200`,
      [job.businessId, String(config.hours_before)])).rows;
    for (const a of rows) {
      const sent = await reach(db, { ...job, related: { type: 'salon_appointment', id: a.appointment_id } }, { customer_id: a.customer_id, phone: a.phone }, 'SALON_APPT_REMINDER', { name: a.name || 'there', when: whenText(a.start_at, job.tz), services: a.services || 'your services' });
      // marked either way: a client with no usable number should not be retried every few minutes
      await db.query(`UPDATE salon_appointments SET reminder_sent_at = now() WHERE appointment_id = $1`, [a.appointment_id]);
      void sent;
    }
    return rows.length;
  },

  async BIRTHDAY(db, job, config) { return specialDay(db, job, config, 'dob', 'BIRTHDAY', 'SALON_BIRTHDAY'); },
  async ANNIVERSARY(db, job, config) { return specialDay(db, job, config, 'anniversary', 'ANNIVERSARY', 'SALON_ANNIVERSARY'); },

  async MEMBERSHIP_EXPIRY(db, job, config) {
    const rows = (await db.query(
      `SELECT m.membership_id, m.plan_name, m.expiry_date, m.customer_id, c.name, c.phone FROM salon_customer_memberships m JOIN customers c ON c.customer_id = m.customer_id
       WHERE m.business_id = $1 AND m.status = 'ACTIVE' AND m.expiry_date BETWEEN $2::date AND $2::date + $3::int AND c.status = 'ACTIVE' LIMIT 200`, [job.businessId, job.today, config.days_before])).rows;
    let n = 0;
    for (const m of rows) {
      if (!(await claim(db, job.businessId, 'MEMBERSHIP_EXPIRY', 'membership', m.membership_id, m.expiry_date))) continue;
      if (await reach(db, job, m, 'SALON_MEMBER_EXPIRY', { name: m.name, plan: m.plan_name, date: String(m.expiry_date).slice(0, 10) })) { n++; await db.query(`UPDATE salon_customer_memberships SET reminder_sent_at = now() WHERE membership_id = $1`, [m.membership_id]); }
    }
    return n;
  },

  async POINTS_EXPIRY(db, job, config) {
    const days = (await db.query(`SELECT expiry_days FROM points_programs WHERE business_id = $1 AND is_enabled`, [job.businessId])).rows[0]?.expiry_days;
    if (!days) return 0;
    let n = 0;
    for (const p of (await expiringSoonAll(db, job.businessId, days, config.days_before)).slice(0, 200)) {
      // at most one warning a month per client
      const recent = (await db.query(`SELECT 1 FROM salon_automation_log WHERE business_id = $1 AND automation_key = 'POINTS_EXPIRY' AND related_id = $2 AND run_on > $3::date - 30 LIMIT 1`, [job.businessId, p.customer_id, job.today])).rows.length;
      if (recent) continue;
      const c = (await db.query(`SELECT customer_id, name, phone FROM customers WHERE customer_id = $1 AND status = 'ACTIVE'`, [p.customer_id])).rows[0];
      if (!c || !(await claim(db, job.businessId, 'POINTS_EXPIRY', 'customer', c.customer_id, job.today))) continue;
      if (await reach(db, job, c, 'SALON_POINTS_EXPIRY', { name: c.name, points: p.points, days: config.days_before })) n++;
    }
    return n;
  },

  async REVISIT(db, job, config) {
    const rows = (await db.query(
      `SELECT c.customer_id, c.name, c.phone, st.last_visit FROM salon_customer_stats st JOIN customers c ON c.customer_id = st.customer_id
       WHERE st.business_id = $1 AND c.status = 'ACTIVE' AND st.last_visit <= $2::date - $3::int AND st.last_visit > $2::date - $3::int - 14
         AND NOT EXISTS (SELECT 1 FROM salon_appointments a WHERE a.customer_id = c.customer_id AND a.status IN ('BOOKED','CONFIRMED') AND a.start_at > now()) LIMIT 200`, [job.businessId, job.today, config.days_after])).rows;
    let n = 0;
    for (const c of rows) {
      if (!(await claim(db, job.businessId, 'REVISIT', 'customer', c.customer_id, c.last_visit))) continue;
      if (await reach(db, job, c, 'SALON_REVISIT', { name: c.name })) n++;
    }
    return n;
  },

  async INACTIVE(db, job, config) {
    const rows = (await db.query(
      `SELECT c.customer_id, c.name, c.phone, st.last_visit FROM salon_customer_stats st JOIN customers c ON c.customer_id = st.customer_id
       WHERE st.business_id = $1 AND c.status = 'ACTIVE' AND st.visits > 0 AND st.last_visit <= $2::date - $3::int
         AND NOT EXISTS (SELECT 1 FROM salon_appointments a WHERE a.customer_id = c.customer_id AND a.status IN ('BOOKED','CONFIRMED') AND a.start_at > now()) LIMIT 200`, [job.businessId, job.today, config.days])).rows;
    let n = 0;
    for (const c of rows) {
      if (!(await claim(db, job.businessId, 'INACTIVE', 'customer', c.customer_id, c.last_visit))) continue;
      if (await reach(db, job, c, 'SALON_INACTIVE', { name: c.name, offer: config.offer_text })) n++;
    }
    return n;
  },

  async PAYMENT_REMINDER(db, job, config) {
    const rows = (await db.query(
      `SELECT i.invoice_id, i.invoice_number, i.balance_due_paise, c.customer_id, c.name, c.phone FROM invoices i JOIN customers c ON c.customer_id = i.customer_id
       WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND i.invoice_date <= $2::date - $3::int ORDER BY i.invoice_date LIMIT 200`, [job.businessId, job.today, config.days_overdue])).rows;
    let n = 0;
    for (const i of rows) {
      const recent = (await db.query(`SELECT 1 FROM salon_automation_log WHERE business_id = $1 AND automation_key = 'PAYMENT_REMINDER' AND related_id = $2 AND run_on > $3::date - $4::int LIMIT 1`, [job.businessId, i.invoice_id, job.today, config.repeat_days])).rows.length;
      if (recent || !(await claim(db, job.businessId, 'PAYMENT_REMINDER', 'invoice', i.invoice_id, job.today))) continue;
      if (await reach(db, { ...job, related: { type: 'invoice', id: i.invoice_id } }, i, 'SALON_PAYMENT_DUE', { name: i.name, number: i.invoice_number, amount: `₹${toRupees(i.balance_due_paise).toLocaleString('en-IN')}` })) n++;
    }
    return n;
  },

  async LOW_STOCK(db, job) {
    const c = await alertCounts(db, job.businessId, job.today);
    if (!(c.low + c.out + c.expiring + c.expired)) return 0;
    const parts = [c.out && `${c.out} out of stock`, c.low && `${c.low} running low`, c.expiring && `${c.expiring} expiring soon`, c.expired && `${c.expired} expired`].filter(Boolean);
    return notify(job.businessId, {
      category: 'stock', type: 'salon_stock', severity: c.out || c.expired ? 'critical' : 'warning', title: 'Salon stock needs attention', body: parts.join(', '), link: '/app/salon/stock',
      dedupeKey: `salon-stock-${job.today}`
    }, db);
  }
};

/* birthdays and anniversaries: clients whose day is today */
async function specialDay(db, job, config, column, key, kind) {
  const [, m, d] = job.today.split('-').map(Number);
  const rows = (await db.query(
    `SELECT c.customer_id, c.name, c.phone FROM salon_customer_profiles p JOIN customers c ON c.customer_id = p.customer_id
     WHERE p.business_id = $1 AND c.status = 'ACTIVE' AND p.${column} IS NOT NULL AND EXTRACT(MONTH FROM p.${column}) = $2 AND EXTRACT(DAY FROM p.${column}) = $3 LIMIT 500`, [job.businessId, m, d])).rows;
  let n = 0;
  for (const c of rows) {
    if (!(await claim(db, job.businessId, key, 'customer', c.customer_id, job.today))) continue;
    if (await reach(db, job, c, kind, { name: c.name, offer: config.offer_text })) n++;
  }
  return n;
}

/** Run one salon's automations. Each is isolated; returns { KEY: count } for those that ran. */
export const runForBusiness = async (db, businessId) => {
  const b = (await db.query(`SELECT name, COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1 AND business_type = 'SALON' AND status = 'ACTIVE'`, [businessId])).rows[0];
  if (!b) return {};
  const today = await businessToday(businessId, db);
  const job = { businessId, business: b.name, tz: b.tz, today };
  const out = {};

  // housekeeping that is not optional: entitlements lapse on their date, points lapse when the owner said they do
  try {
    await expireMemberships(db, businessId, today);
    await expirePackages(db, businessId, today);
    const days = (await db.query(`SELECT expiry_days FROM points_programs WHERE business_id = $1 AND is_enabled`, [businessId])).rows[0]?.expiry_days;
    if (days && (await claim(db, businessId, 'POINTS_LAPSE', 'business', businessId, today))) out.POINTS_LAPSE = (await expirePoints(db, businessId, days)).points;
  } catch (error) { console.error(`[salon] housekeeping failed for ${businessId}:`, error.message); }

  for (const a of await getAutomations(db, businessId)) {
    if (!a.is_enabled || !runners[a.key]) continue;
    try { out[a.key] = await runners[a.key](db, job, a.config); }
    catch (error) { console.error(`[salon] ${a.key} failed for business ${businessId}:`, error.message); }
  }
  return out;
};

let lastScan = 0;
export const SCAN_EVERY_MS = 10 * 60 * 1000;

/** The worker hook: every salon, at most once per SCAN_EVERY_MS. */
export const runScan = async ({ force = false } = {}) => {
  if (!force && Date.now() - lastScan < SCAN_EVERY_MS) return;
  lastScan = Date.now();
  const { rows } = await pool.query(`SELECT business_id FROM businesses WHERE business_type = 'SALON' AND status = 'ACTIVE' AND subscription_status IN ('TRIAL','ACTIVE')`);
  for (const r of rows) await runForBusiness(pool, r.business_id);
};
registerScan(runScan);

/* ── promotional campaigns to a segment ───────────────────────────────────────────────────── */

export const CAMPAIGN_LIMIT = 1000;

/** Clients in a segment who can be messaged (a mobile number, not opted out). */
export const campaignAudience = async (db, businessId, segmentKey) => {
  const settings = await getSettings(db, businessId);
  const seg = parseSegment(segmentKey, settings.segment_rules);
  if (!seg) throw new SalonError(400, 'Choose who to send to');
  const today = await businessToday(businessId, db);
  const values = [businessId];
  const cond = segmentCondition(seg, settings.segment_rules, today, values);
  return (await db.query(
    `SELECT c.customer_id, c.name, c.phone FROM customers c JOIN salon_customer_stats st ON st.customer_id = c.customer_id
     WHERE c.business_id = $1 AND c.status = 'ACTIVE' AND NOT c.marketing_opt_out AND LENGTH(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')) >= 10 AND ${cond} ORDER BY c.customer_id LIMIT ${CAMPAIGN_LIMIT + 1}`, values)).rows;
};

export const sendCampaign = async (db, { businessId, segment, offer, userId }) => {
  const audience = await campaignAudience(db, businessId, segment);
  if (audience.length > CAMPAIGN_LIMIT) throw new SalonError(409, `That is more than ${CAMPAIGN_LIMIT} people. Pick a smaller segment.`);
  const business = (await db.query(`SELECT name FROM businesses WHERE business_id = $1`, [businessId])).rows[0].name;
  const batch = crypto.randomBytes(6).toString('hex');
  const tally = { SENT: 0, QUEUED: 0, FAILED: 0, SKIPPED: 0 };
  for (const c of audience) {
    const r = await send(db, { businessId, customerId: c.customer_id, phone: c.phone, kind: 'OFFER', values: { name: c.name, business, offer }, batch, createdBy: userId });
    const k = r.skipped ? 'SKIPPED' : (r.status || 'QUEUED');
    tally[k] = (tally[k] || 0) + 1;
  }
  return { batch, recipients: audience.length, ...tally };
};
