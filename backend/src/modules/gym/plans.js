/*
 * Membership plans: what the gym sells. A sold membership keeps its own copy of the rules (see memberships.js), so editing or archiving a plan
 * never changes what someone already bought.
 */
import { AUDIENCES, GymError, PAYMENT_POLICIES, PLAN_KINDS, bool, clock, int, money, num, oneOf, text, toMinutes, withRupees } from './common.js';

const bad = (message) => new GymError(400, message);

/** A plan's time window from the request: { days: [1..5], from: '06:00', to: '11:00' } or null for any time. */
export const cleanWindow = (value) => {
  if (value == null || value === '' || (typeof value === 'object' && !Object.keys(value).length)) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('The allowed times are not valid');
  const out = {};
  if (value.days != null) {
    if (!Array.isArray(value.days) || value.days.some((d) => !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 6)) throw bad('Days must be numbers from 0 (Sunday) to 6 (Saturday)');
    const days = [...new Set(value.days.map(Number))].sort();
    if (days.length && days.length < 7) out.days = days;
  }
  const from = clock(value.from, 'From time'); const to = clock(value.to, 'To time');
  if ((from && !to) || (!from && to)) throw bad('Give both a from and a to time, or neither');
  if (from && to && toMinutes(from) !== toMinutes(to)) { out.from = from; out.to = to; }
  return Object.keys(out).length ? out : null;
};

/** Hours of an outlet: { "1": { open, close }, ... }. Null = open all day. */
export const cleanHours = (value) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('The opening hours are not valid');
  const out = {};
  for (const [day, h] of Object.entries(value)) {
    if (!/^[0-6]$/.test(day)) throw bad('Opening hours are given by weekday, 0 (Sunday) to 6 (Saturday)');
    if (h == null) continue;   // no entry = closed that day
    const open = clock(h.open, 'Opening time', { required: true }); const close = clock(h.close, 'Closing time', { required: true });
    out[day] = { open, close };
  }
  return out;
};

const branchIdsOf = async (db, businessId, ids) => {
  if (ids == null) return null;
  if (!Array.isArray(ids)) throw bad('Branches must be a list');
  const list = [...new Set(ids.map(Number))];
  if (!list.length) return null;
  if (list.some((n) => !Number.isInteger(n) || n <= 0)) throw bad('A branch is not valid');
  const found = (await db.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND branch_id = ANY($2::int[])`, [businessId, list])).rows.length;
  if (found !== list.length) throw bad('One of the branches is not part of this gym');
  return list;
};

export const cleanPlan = async (db, businessId, input, current = null) => {
  const b = input || {};
  const has = (k) => b[k] !== undefined;
  const pick = (k, fn, fallback) => (has(k) ? fn(b[k]) : (current ? current[k] : fallback));
  const kind = pick('kind', (v) => oneOf(v, 'Kind', PLAN_KINDS, { required: true }), 'MEMBERSHIP');
  const plan = {
    name: has('name') ? text(b.name, 'Name', { max: 80, required: true }) : current?.name ?? text(b.name, 'Name', { max: 80, required: true }),
    description: pick('description', (v) => text(v, 'Description', { max: 300 }), null),
    kind,
    audience: pick('audience', (v) => oneOf(v, 'Audience', AUDIENCES, { required: true }), 'STANDARD'),
    duration_days: pick('duration_days', (v) => int(v, 'Duration in days', { min: 1, max: 3660, required: true }), undefined),
    price_paise: has('price') ? money(b.price, 'Price', { required: true }) : current ? Number(current.price_paise) : money(b.price, 'Price', { required: true }),
    tax_rate: pick('tax_rate', (v) => num(v, 'GST rate', { min: 0, max: 100, required: true }), 18),
    hsn_sac: pick('hsn_sac', (v) => text(v, 'HSN/SAC', { max: 16 }), null),
    sessions: pick('sessions', (v) => int(v, 'Sessions', { min: 1, max: 1000 }), null),
    max_members: pick('max_members', (v) => int(v, 'People covered', { min: 1, max: 50, required: true }), 1),
    allowed_branch_ids: has('allowed_branch_ids') ? await branchIdsOf(db, businessId, b.allowed_branch_ids) : current ? current.allowed_branch_ids : null,
    time_window: has('time_window') ? cleanWindow(b.time_window) : current ? current.time_window : null,
    grace_days: pick('grace_days', (v) => int(v, 'Grace days', { min: 0, max: 60 }), null),
    payment_policy: pick('payment_policy', (v) => oneOf(v, 'Payment rule', PAYMENT_POLICIES, { required: true }), 'FULL_REQUIRED'),
    pay_later_days: pick('pay_later_days', (v) => int(v, 'Pay-later days', { min: 0, max: 90, required: true }), 0),
    freeze_allowed: has('freeze_allowed') ? bool(b.freeze_allowed) : current ? current.freeze_allowed : true,
    max_freeze_days: pick('max_freeze_days', (v) => int(v, 'Most freeze days', { min: 0, max: 365, required: true }), 30),
    sort_order: pick('sort_order', (v) => int(v, 'Order', { min: 0, max: 1000 }) ?? 0, 0)
  };
  if (plan.duration_days == null) throw bad('Duration in days is required');
  if (plan.payment_policy === 'PAY_LATER' && !plan.pay_later_days) throw bad('Say how many days a member may pay later');
  if (plan.kind !== 'MEMBERSHIP' && !plan.sessions) throw bad('A personal-training or class pack needs a number of sessions');
  if (plan.audience === 'FAMILY' && plan.max_members < 2) throw bad('A family plan covers at least two people');
  return plan;
};

const COLUMNS = ['name', 'description', 'kind', 'audience', 'duration_days', 'price_paise', 'tax_rate', 'hsn_sac', 'sessions', 'max_members', 'allowed_branch_ids', 'time_window', 'grace_days', 'payment_policy', 'pay_later_days', 'freeze_allowed', 'max_freeze_days', 'sort_order'];
const values = (p) => COLUMNS.map((c) => (c === 'time_window' ? (p.time_window ? JSON.stringify(p.time_window) : null) : p[c]));

export const listPlans = async (db, businessId, { all = false, kind = null } = {}) => {
  const params = [businessId];
  let sql = `SELECT * FROM gym_plans WHERE business_id = $1`;
  if (!all) sql += ` AND is_active`;
  if (kind) { params.push(kind); sql += ` AND kind = $${params.length}`; }
  return withRupees((await db.query(`${sql} ORDER BY sort_order, price_paise, plan_id`, params)).rows);
};

export const getPlan = async (db, businessId, planId) => (await db.query(`SELECT * FROM gym_plans WHERE plan_id = $1 AND business_id = $2`, [planId, businessId])).rows[0] || null;

export const createPlan = async (db, businessId, input) => {
  const p = await cleanPlan(db, businessId, input);
  const cols = COLUMNS.join(', '); const marks = COLUMNS.map((_, i) => `$${i + 2}${COLUMNS[i] === 'time_window' ? '::jsonb' : ''}`).join(', ');
  return withRupees((await db.query(`INSERT INTO gym_plans (business_id, ${cols}) VALUES ($1, ${marks}) RETURNING *`, [businessId, ...values(p)])).rows[0]);
};

export const updatePlan = async (db, businessId, planId, input) => {
  const cur = await getPlan(db, businessId, planId);
  if (!cur) throw new GymError(404, 'Not found');
  const p = await cleanPlan(db, businessId, input, cur);
  const sets = COLUMNS.map((c, i) => `${c} = $${i + 3}${c === 'time_window' ? '::jsonb' : ''}`).join(', ');
  return withRupees((await db.query(`UPDATE gym_plans SET ${sets} WHERE plan_id = $1 AND business_id = $2 RETURNING *`, [planId, businessId, ...values(p)])).rows[0]);
};

export const setPlanActive = async (db, businessId, planId, active) => {
  const r = (await db.query(`UPDATE gym_plans SET is_active = $3 WHERE plan_id = $1 AND business_id = $2 RETURNING *`, [planId, businessId, active])).rows[0];
  if (!r) throw new GymError(404, 'Not found');
  return withRupees(r);
};
