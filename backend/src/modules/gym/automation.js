/*
 * Gym reminders that go out by themselves, built on FlowXP's messaging (the business's own channel and provider, opt-outs for promotional ones) and
 * the job worker's scan. Nothing here talks to WhatsApp or SMS: a message is handed to messaging's `send()`.
 *
 * Each reminder is claimed in gym_message_log before it is sent. The log is unique per reminder and record ("expiry:41:2026-11-02"), so a retried scan,
 * a slow provider or two workers running at once can never send a member the same message twice. A reminder is only claimed when the business has a
 * messaging channel switched on, so turning one on later does not find a backlog of old claims. Reminders go out between 9 am and 8 pm gym time.
 */
import pool from '../../config/database.js';
import { registerScan } from '../jobs.js';
import { send, getSettings as getMessagingSettings } from '../messaging/index.js';
import { awardBirthday, getRules, sweepExpired } from './rewards.js';
import { addDays, bool, inTx, int, localParts, SQL_PHONE_KEY } from './common.js';

export const AUTOMATIONS = {
  WELCOME: { label: 'Welcome message', description: 'Greet a new member with their member number.', default_on: true, config: {} },
  EXPIRY_REMINDER: { label: 'Membership ending soon', description: 'Remind a member before their membership ends, unless they have already renewed.', default_on: false, config: { days_before: 7 } },
  MONTH_START: { label: 'Start-of-month reminder', description: 'On one day each month (the 1st by default), remind every member whose membership ends this month, with the renewal amount. Members who already renewed are left out.', default_on: false, config: { day: 1 } },
  EXPIRED_NOTICE: { label: 'Membership ended', description: 'Tell a member the day after their membership ended, if they have not renewed.', default_on: false, config: {} },
  PAYMENT_DUE: { label: 'Payment reminder', description: 'Remind a member about a membership that is still not paid for.', default_on: false, config: { days_overdue: 2, repeat_days: 7 } },
  INACTIVE: { label: 'We miss you', description: 'Nudge a member with a running membership who has not visited for a while. Sent only to members who agreed to offers.', default_on: false, config: { days: 21 } },
  BIRTHDAY_POINTS: { label: 'Birthday points', description: 'Give reward points on a member\'s birthday (set the amount under Rewards).', default_on: true, config: {}, internal: true }
};
const RANGES = { day: [1, 28], days_before: [1, 60], days_overdue: [1, 90], repeat_days: [1, 60], days: [7, 365] };

export const getAutomations = async (db, businessId) => {
  const rows = new Map((await db.query(`SELECT automation_key, is_enabled, config FROM gym_automations WHERE business_id = $1`, [businessId])).rows.map((r) => [r.automation_key, r]));
  return Object.entries(AUTOMATIONS).map(([key, def]) => {
    const row = rows.get(key);
    return { key, label: def.label, description: def.description, internal: Boolean(def.internal), is_enabled: row ? row.is_enabled : def.default_on, config: { ...def.config, ...(row?.config || {}) }, defaults: def.config };
  });
};

export const saveAutomation = async (db, businessId, key, { is_enabled, config }) => {
  const def = AUTOMATIONS[key];
  if (!def) return null;
  const clean = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (!(k in def.config)) continue;
    const [min, max] = RANGES[k];
    clean[k] = int(v, k, { min, max, required: true });
  }
  await db.query(
    `INSERT INTO gym_automations (business_id, automation_key, is_enabled, config) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (business_id, automation_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, config = EXCLUDED.config`,
    [businessId, key, bool(is_enabled), JSON.stringify(clean)]);
  return (await getAutomations(db, businessId)).find((a) => a.key === key);
};

const dateText = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Claim a reminder. True means this caller owns it and may send; false means it has been claimed before. */
const claim = async (db, { businessId, key, ref, memberId, date }) =>
  (await db.query(`INSERT INTO gym_message_log (business_id, automation_key, ref, member_id, sent_on) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING log_id`, [businessId, key, ref, memberId, date])).rows.length > 0;

const deliver = async (db, { businessId, branchId, customerId, phone, kind, values, memberId }) => {
  try {
    await send(db, { businessId, branchId, customerId, phone, kind, values, related: { type: 'gym_member', id: memberId } });
  } catch (error) { console.error(`[gym] ${kind} message failed:`, error.message); }
};

const PEOPLE = `gm.member_id, gm.branch_id, gm.customer_id, c.name, c.phone`;
const FROM = `gym_members gm JOIN customers c ON c.customer_id = gm.customer_id`;
const REACHABLE = `gm.status = 'ACTIVE' AND ${SQL_PHONE_KEY('c.phone')} <> ''`;

/** One business, one moment. Returns how many messages were sent (for the tests and the log). */
export const runBusiness = async (businessId, { now = new Date(), db = pool } = {}) => {
  const biz = (await db.query(`SELECT name FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  if (!biz) return 0;
  const { date: today, minutes } = await localParts(db, businessId, now);
  const autos = new Map((await getAutomations(db, businessId)).map((a) => [a.key, a]));
  let sent = 0;

  // points that are not for sale: expiry and birthdays are bookkeeping, done whatever the messaging channel
  if (autos.get('BIRTHDAY_POINTS').is_enabled) {
    const rules = await getRules(db, businessId);
    if (rules.is_enabled && rules.birthday_points > 0) {
      const people = (await db.query(`SELECT member_id FROM gym_members WHERE business_id = $1 AND status = 'ACTIVE' AND dob IS NOT NULL AND to_char(dob, 'MM-DD') = $2`, [businessId, today.slice(5)])).rows;
      for (const p of people) await awardBirthday(db, { businessId, memberId: p.member_id, year: today.slice(0, 4), now });
    }
  }
  const expiring = (await db.query(`SELECT DISTINCT member_id FROM gym_points_ledger WHERE business_id = $1 AND kind = 'EARN' AND remaining > 0 AND expires_on < $2::date`, [businessId, today])).rows;
  for (const e of expiring) { try { await inTx((c) => sweepExpired(c, businessId, e.member_id, today)); } catch (error) { console.error('[gym] points expiry failed:', error.message); } }

  // messages: only with a channel on, and not in the middle of the night
  const channel = (await getMessagingSettings(db, businessId)).channel;
  if (channel === 'OFF' || minutes < 9 * 60 || minutes >= 20 * 60) return sent;
  const base = { businessId, date: today };

  const exp = autos.get('EXPIRY_REMINDER');
  if (exp.is_enabled) {
    const target = addDays(today, Number(exp.config.days_before));
    const rows = (await db.query(
      `SELECT ${PEOPLE}, ms.membership_id, ms.plan_name, ms.end_date::text AS end_date FROM gym_memberships ms JOIN ${FROM} ON gm.member_id = ms.member_id
       WHERE ms.business_id = $1 AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP' AND ms.end_date = $2::date AND ${REACHABLE}
         AND NOT EXISTS (SELECT 1 FROM gym_memberships n WHERE n.member_id = ms.member_id AND n.status = 'ACTIVE' AND n.kind = 'MEMBERSHIP' AND n.end_date > ms.end_date)`, [businessId, target])).rows;
    for (const r of rows) if (await claim(db, { ...base, key: 'EXPIRY_REMINDER', ref: `expiry:${r.membership_id}:${r.end_date}`, memberId: r.member_id })) { sent += 1; await deliver(db, { businessId, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, kind: 'GYM_EXPIRY', memberId: r.member_id, values: { name: r.name, business: biz.name, plan: r.plan_name, date: dateText(r.end_date) } }); }
  }

  // the first of the month (or the day the owner chose): everyone whose membership ends this month hears about it once, with the renewal amount
  const monthly = autos.get('MONTH_START');
  if (monthly.is_enabled && Number(today.slice(8, 10)) === Number(monthly.config.day)) {
    const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const rows = (await db.query(
      `SELECT ${PEOPLE}, ms.membership_id, ms.plan_name, ms.price_paise, ms.end_date::text AS end_date FROM gym_memberships ms JOIN ${FROM} ON gm.member_id = ms.member_id
       WHERE ms.business_id = $1 AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP' AND ms.end_date BETWEEN $2::date AND $3::date AND ${REACHABLE}
         AND NOT EXISTS (SELECT 1 FROM gym_memberships n WHERE n.member_id = ms.member_id AND n.status = 'ACTIVE' AND n.kind = 'MEMBERSHIP' AND n.end_date > ms.end_date)`, [businessId, today, monthEnd])).rows;
    for (const r of rows) if (await claim(db, { ...base, key: 'MONTH_START', ref: `monthstart:${r.member_id}:${today.slice(0, 7)}`, memberId: r.member_id })) {
      sent += 1;
      await deliver(db, { businessId, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, kind: 'GYM_MONTH_START', memberId: r.member_id, values: { name: r.name, business: biz.name, plan: r.plan_name, date: dateText(r.end_date), amount: `₹${(Number(r.price_paise) / 100).toLocaleString('en-IN')}` } });
    }
  }

  const ended = autos.get('EXPIRED_NOTICE');
  if (ended.is_enabled) {
    const rows = (await db.query(
      `SELECT ${PEOPLE}, ms.membership_id, ms.plan_name, ms.end_date::text AS end_date FROM gym_memberships ms JOIN ${FROM} ON gm.member_id = ms.member_id
       WHERE ms.business_id = $1 AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP' AND ms.end_date = $2::date AND ${REACHABLE}
         AND NOT EXISTS (SELECT 1 FROM gym_memberships n WHERE n.member_id = ms.member_id AND n.status = 'ACTIVE' AND n.kind = 'MEMBERSHIP' AND n.end_date > ms.end_date)`, [businessId, addDays(today, -1)])).rows;
    for (const r of rows) if (await claim(db, { ...base, key: 'EXPIRED_NOTICE', ref: `expired:${r.membership_id}:${r.end_date}`, memberId: r.member_id })) { sent += 1; await deliver(db, { businessId, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, kind: 'GYM_EXPIRED', memberId: r.member_id, values: { name: r.name, business: biz.name, plan: r.plan_name, date: dateText(r.end_date) } }); }
  }

  const due = autos.get('PAYMENT_DUE');
  if (due.is_enabled) {
    const { days_overdue: after, repeat_days: every } = due.config;
    const rows = (await db.query(
      `SELECT ${PEOPLE}, ms.membership_id, ms.plan_name, i.balance_due_paise, (($2::date) - (ms.created_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date) AS age
       FROM gym_memberships ms JOIN invoices i ON i.invoice_id = ms.invoice_id JOIN ${FROM} ON gm.member_id = ms.member_id
       WHERE ms.business_id = $1 AND ms.status = 'ACTIVE' AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND ${REACHABLE}`, [businessId, today])).rows;
    for (const r of rows) {
      if (r.age < after) continue;
      const round = Math.floor((r.age - after) / every);
      if (await claim(db, { ...base, key: 'PAYMENT_DUE', ref: `due:${r.membership_id}:${round}`, memberId: r.member_id })) { sent += 1; await deliver(db, { businessId, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, kind: 'GYM_PAYMENT_DUE', memberId: r.member_id, values: { name: r.name, business: biz.name, plan: r.plan_name, amount: `₹${(Number(r.balance_due_paise) / 100).toLocaleString('en-IN')}` } }); }
    }
  }

  const quiet = autos.get('INACTIVE');
  if (quiet.is_enabled) {
    const days = Number(quiet.config.days);
    const rows = (await db.query(
      `SELECT ${PEOPLE}, GREATEST(0, ($2::date) - COALESCE((SELECT MAX(a.local_date) FROM gym_attendance a WHERE a.member_id = gm.member_id AND a.status <> 'VOIDED'), gm.joined_on)) AS away
       FROM ${FROM} WHERE gm.business_id = $1 AND ${REACHABLE} AND gm.consent_marketing
         AND EXISTS (SELECT 1 FROM gym_memberships ms WHERE ms.member_id = gm.member_id AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP' AND ms.start_date <= $2::date AND ms.end_date >= $2::date)`, [businessId, today])).rows;
    for (const r of rows) {
      if (r.away < days) continue;
      if (await claim(db, { ...base, key: 'INACTIVE', ref: `inactive:${r.member_id}:${today.slice(0, 7)}`, memberId: r.member_id })) { sent += 1; await deliver(db, { businessId, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, kind: 'GYM_INACTIVE', memberId: r.member_id, values: { name: r.name, business: biz.name, days: String(r.away) } }); }
    }
  }
  return sent;
};

/** A new member's welcome, after the registration has been saved. Never throws: a message problem is not a registration problem. */
export const sendWelcome = async (businessId, memberId) => {
  try {
    const auto = (await getAutomations(pool, businessId)).find((a) => a.key === 'WELCOME');
    if (!auto?.is_enabled) return;
    const m = (await pool.query(`SELECT ${PEOPLE}, gm.member_code, b.name AS business FROM ${FROM} JOIN businesses b ON b.business_id = gm.business_id WHERE gm.member_id = $1 AND gm.business_id = $2`, [memberId, businessId])).rows[0];
    if (!m?.phone) return;
    const { date } = await localParts(pool, businessId);
    if (!await claim(pool, { businessId, key: 'WELCOME', ref: `welcome:${memberId}`, memberId, date })) return;
    await deliver(pool, { businessId, branchId: m.branch_id, customerId: m.customer_id, phone: m.phone, kind: 'GYM_WELCOME', memberId, values: { name: m.name, business: m.business, code: m.member_code } });
  } catch (error) { console.error('[gym] welcome failed:', error.message); }
};

/* the worker's scan: every gym, at most every five minutes */
let last = 0;
export const runScan = async () => {
  if (Date.now() - last < 5 * 60 * 1000) return;
  last = Date.now();
  const gyms = (await pool.query(`SELECT business_id FROM businesses WHERE business_type = 'GYM' AND status = 'ACTIVE'`)).rows;
  for (const g of gyms) {
    try { await runBusiness(g.business_id); } catch (error) { console.error(`[gym] reminders for ${g.business_id} failed:`, error.message); }
  }
};
registerScan(runScan);
