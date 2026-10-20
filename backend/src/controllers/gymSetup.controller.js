/*
 * Gym set-up: settings, outlet hours and the entrance QR, and plans. Permissions are decided in the router (gym.routes.js).
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { cleanHours, createPlan, listPlans, setPlanActive, updatePlan } from '../modules/gym/plans.js';
import { GymError, audit, bool, diff, getBranchSettings, getSettings, int, ok, randomToken, wrapAll } from '../modules/gym/common.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
// words the public address space already uses (/gym/in/<token>, /gym/me ...)
const RESERVED = new Set(['in', 'me', 'api', 'otp', 'verify', 'logout', 'admin', 'app', 'login', 'checkin']);

/** The address a branch's entrance QR points at. It identifies the outlet and grants nothing. */
export const checkinUrl = (token) => `${config.appOrigin}/gym/in/${token}`;

const branchesOf = async (businessId) => {
  const { rows } = await pool.query(`SELECT branch_id, name, city, is_primary, status FROM branches WHERE business_id = $1 ORDER BY is_primary DESC, branch_id`, [businessId]);
  const out = [];
  for (const b of rows) {
    const s = await getBranchSettings(pool, businessId, b.branch_id);
    out.push({ ...b, hours: s.hours, holidays: s.holidays, checkin_token: s.checkin_token, checkin_url: checkinUrl(s.checkin_token) });
  }
  return out;
};

const shape = (s) => ({
  member_prefix: s.member_prefix, public_slug: s.public_slug, grace_days: s.grace_days, cooldown_seconds: s.cooldown_seconds, visits_per_day: s.visits_per_day,
  checkout_enabled: s.checkout_enabled, reception_confirm: s.reception_confirm, self_checkin_enabled: s.self_checkin_enabled, self_checkin_daily_code: s.self_checkin_daily_code,
  self_checkin_fresh_otp_minutes: s.self_checkin_fresh_otp_minutes, session_days: s.session_days, pass_ttl_seconds: s.pass_ttl_seconds, travel_minutes: s.travel_minutes,
  class_cancel_hours: s.class_cancel_hours, pt_cancel_hours: s.pt_cancel_hours, class_booking_days: s.class_booking_days, class_waitlist: s.class_waitlist,
  portal_url: s.public_slug ? `${config.appOrigin}/gym/${s.public_slug}` : null
});

const get = async (req, res) => {
  const settings = await getSettings(pool, req.tenant.businessId);
  const tz = (await pool.query(`SELECT COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0].tz;
  ok(res, { ...shape(settings), timezone: tz, branches: await branchesOf(req.tenant.businessId) });
};

const update = async (req, res) => {
  const b = req.body || {};
  const cur = await getSettings(pool, req.tenant.businessId);
  const next = {};
  if (b.member_prefix !== undefined) {
    const v = String(b.member_prefix).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(v)) throw new GymError(400, 'The member code prefix is 1 to 8 letters or digits');
    next.member_prefix = v;
  }
  if (b.public_slug !== undefined) {
    const v = String(b.public_slug || '').trim().toLowerCase();
    if (v && (!SLUG.test(v) || RESERVED.has(v))) throw new GymError(400, 'The address is 3 to 40 letters, digits or hyphens, and not a word FlowXP already uses');
    next.public_slug = v || null;
  }
  const ints = [['grace_days', 'Grace days', 0, 60], ['cooldown_seconds', 'Repeat-scan wait', 0, 3600], ['visits_per_day', 'Visits a day', 0, 20], ['session_days', 'Sign-in length', 1, 90], ['pass_ttl_seconds', 'Pass lifetime', 15, 300], ['travel_minutes', 'Two-outlet check', 0, 600], ['class_cancel_hours', 'Class cancellation notice', 0, 168], ['pt_cancel_hours', 'Training cancellation notice', 0, 168], ['class_booking_days', 'Class booking window', 1, 90]];
  for (const [k, label, min, max] of ints) if (b[k] !== undefined) next[k] = int(b[k], label, { min, max, required: true });
  if (b.self_checkin_fresh_otp_minutes !== undefined) next.self_checkin_fresh_otp_minutes = int(b.self_checkin_fresh_otp_minutes, 'Code freshness', { min: 1, max: 1440 });
  for (const k of ['checkout_enabled', 'reception_confirm', 'self_checkin_enabled', 'self_checkin_daily_code', 'class_waitlist']) if (b[k] !== undefined) next[k] = bool(b[k]);
  const keys = Object.keys(next);
  if (keys.length) {
    try {
      await pool.query(`UPDATE gym_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE business_id = $1`, [req.tenant.businessId, ...keys.map((k) => next[k])]);
    } catch (error) {
      if (error.code === '23505') throw new GymError(409, 'That address is taken. Choose another');
      throw error;
    }
  }
  const after = await getSettings(pool, req.tenant.businessId);
  audit(req, 'gym.settings_updated', 'gym_settings', req.tenant.businessId, null, diff(shape(cur), shape(after)));
  ok(res, { ...shape(after), branches: await branchesOf(req.tenant.businessId) });
};

const ownBranch = async (req) => {
  const id = Number(req.params.id);
  const b = (await pool.query(`SELECT branch_id FROM branches WHERE branch_id = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows[0];
  if (!b) throw new GymError(404, 'Not found');
  return id;
};

const updateBranch = async (req, res) => {
  const id = await ownBranch(req);
  await getBranchSettings(pool, req.tenant.businessId, id);
  const b = req.body || {};
  if (b.hours !== undefined) await pool.query(`UPDATE gym_branch_settings SET hours = $2::jsonb, updated_at = now() WHERE branch_id = $1`, [id, b.hours == null ? null : JSON.stringify(cleanHours(b.hours))]);
  if (b.holidays !== undefined) {
    if (!Array.isArray(b.holidays) || b.holidays.length > 400 || b.holidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(String(d)))) throw new GymError(400, 'Holidays are a list of dates (YYYY-MM-DD)');
    await pool.query(`UPDATE gym_branch_settings SET holidays = $2::jsonb, updated_at = now() WHERE branch_id = $1`, [id, JSON.stringify([...new Set(b.holidays.map(String))].sort())]);
  }
  audit(req, 'gym.branch_updated', 'branch', id, null, { hours: b.hours !== undefined, holidays: b.holidays !== undefined });
  ok(res, (await branchesOf(req.tenant.businessId)).find((x) => x.branch_id === id));
};

/** A new entrance QR link for an outlet: the printed poster with the old one stops working (the page it pointed at no longer resolves). */
const rotateCheckinToken = async (req, res) => {
  const id = await ownBranch(req);
  await getBranchSettings(pool, req.tenant.businessId, id);
  await pool.query(`UPDATE gym_branch_settings SET checkin_token = $2, updated_at = now() WHERE branch_id = $1`, [id, randomToken(16)]);
  audit(req, 'gym.checkin_qr_rotated', 'branch', id);
  ok(res, (await branchesOf(req.tenant.businessId)).find((x) => x.branch_id === id));
};

/* ── plans ──────────────────────────────────────────────────────────────────────────────────── */

const plans = async (req, res) => ok(res, await listPlans(pool, req.tenant.businessId, { all: req.query.all === 'true', kind: req.query.kind ? String(req.query.kind).toUpperCase() : null }));
const planCreate = async (req, res) => {
  const plan = await createPlan(pool, req.tenant.businessId, req.body);
  audit(req, 'gym.plan_created', 'gym_plan', plan.plan_id, null, { name: plan.name, price: plan.price });
  ok(res, plan, 201);
};
const planUpdate = async (req, res) => {
  const plan = await updatePlan(pool, req.tenant.businessId, Number(req.params.id), req.body);
  audit(req, 'gym.plan_updated', 'gym_plan', plan.plan_id, null, { name: plan.name, price: plan.price });
  ok(res, plan);
};
const planArchive = async (req, res) => { const p = await setPlanActive(pool, req.tenant.businessId, Number(req.params.id), false); audit(req, 'gym.plan_archived', 'gym_plan', p.plan_id); ok(res, p); };
const planRestore = async (req, res) => { const p = await setPlanActive(pool, req.tenant.businessId, Number(req.params.id), true); audit(req, 'gym.plan_restored', 'gym_plan', p.plan_id); ok(res, p); };

export default wrapAll({ get, update, updateBranch, rotateCheckinToken, plans, planCreate, planUpdate, planArchive, planRestore });
