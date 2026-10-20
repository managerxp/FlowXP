/*
 * The gym's public and member-facing endpoints (/api/public/gym/*). No staff login: a gym is found by its public address or by an outlet's entrance
 * QR token, and a member by a session cookie they got by proving they hold their registered phone.
 *
 * What is shown is deliberately small. The entrance page says which gym and outlet and nothing else. A member sees their own pass, memberships,
 * visits and rewards, never another member's, and never the restricted health note or the staff's records of them.
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { cookieValue } from '../middleware/auth.js';
import { attempt } from '../modules/gym/access.js';
import { issuePass } from '../modules/gym/credentials.js';
import { viewsFor } from '../modules/gym/memberships.js';
import * as portal from '../modules/gym/portal.js';
import * as rewards from '../modules/gym/rewards.js';
import * as classes from '../modules/gym/classes.js';
import * as training from '../modules/gym/training.js';
import { GymError, addDays, getSettings, inTx, isoDate, localParts, safeEqual, wrapAll } from '../modules/gym/common.js';

export const MEMBER_COOKIE = 'flowxp_member';
const cookieOptions = () => ({ httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/api/public/gym' });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const notFound = () => new GymError(404, 'Not found');

/* A change made with the cookie must carry X-Requested-With: FlowXP, which another site's page cannot add (CORS refuses it). */
export const requireAppHeader = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'FlowXP') return res.status(403).json({ success: false, message: 'Not allowed' });
  next();
};

/** Attach the member's session (or refuse). The cookie value is never logged or echoed. */
export const memberSession = async (req, res, next) => {
  try {
    const token = cookieValue(req, MEMBER_COOKIE);
    const session = await portal.readSession(token);
    if (!session) return res.status(401).json({ success: false, message: 'Please sign in', code: 'SIGN_IN' });
    req.member = { token, session };
    next();
  } catch (error) { next(error); }
};

const gymInfo = async (gym) => ({ name: gym.name, logo_url: gym.logo_url, slug: gym.public_slug, self_checkin_enabled: Boolean(gym.self_checkin_enabled) });

/** GET /:slug  what a visitor to the gym's page may know */
const info = async (req, res) => {
  const gym = await portal.gymBySlug(req.params.slug);
  if (!gym) throw notFound();
  const branches = (await pool.query(`SELECT branch_id, name, city FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`, [gym.business_id])).rows;
  ok(res, { ...(await gymInfo(gym)), branches });
};

/** GET /in/:token  the page an entrance QR opens: which gym and outlet. It does not sign anyone in or let anyone in. */
const entrance = async (req, res) => {
  const found = await portal.byCheckinToken(req.params.token);
  if (!found) throw notFound();
  ok(res, { ...(await gymInfo(found)), branch_name: found.branch_name, daily_code_required: Boolean(found.self_checkin_daily_code) });
};

const requestOtp = async (req, res) => {
  const gym = await portal.gymBySlug(req.params.slug);
  if (!gym) throw notFound();
  await portal.requestCode(gym, req.body?.phone);
  portal.sweepSessions();
  ok(res, { sent: true, message: 'If that number belongs to a member, a code is on its way.' });
};

const verifyOtp = async (req, res) => {
  const gym = await portal.gymBySlug(req.params.slug);
  if (!gym) throw notFound();
  const { token, days } = await portal.verifyCode(gym, req.body?.phone, req.body?.code);
  res.cookie?.(MEMBER_COOKIE, token, { ...cookieOptions(), maxAge: days * 86400000 });
  const session = await portal.readSession(token);
  ok(res, { members: session.members.map((m) => ({ member_id: m.member_id, name: m.name })), active_member_id: session.active_member_id });
};

const logout = async (req, res) => {
  await portal.endSession(cookieValue(req, MEMBER_COOKIE));
  res.clearCookie?.(MEMBER_COOKIE, cookieOptions());
  ok(res, { signed_out: true });
};

/** GET /me  the signed-in member's own page */
const me = async (req, res) => {
  const { session } = req.member;
  const m = (await pool.query(
    `SELECT gm.member_id, gm.member_code, gm.status, gm.photo_url, gm.joined_on::text AS joined_on, c.name FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.member_id = $1 AND gm.business_id = $2`,
    [session.active_member_id, session.business_id])).rows[0];
  if (!m) throw notFound();
  const { date: today } = await localParts(pool, session.business_id);
  const memberships = (await viewsFor(pool, session.business_id, m.member_id, today)).map((v) => ({
    membership_id: v.membership_id, plan_name: v.plan_name, start_date: v.start_date, end_date: v.end_date, state: v.state, payment: v.payment, days_left: v.days_left, amount_due: v.amount_due, freezes: v.freezes
  }));
  const visits = (await pool.query(
    `SELECT check_in_at, check_out_at, local_date::text AS local_date FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND status <> 'VOIDED' ORDER BY check_in_at DESC LIMIT 30`, [m.member_id, session.business_id])).rows;
  const stats = (await pool.query(
    `SELECT COUNT(*)::int AS visits, COUNT(*) FILTER (WHERE local_date >= $3::date - 30)::int AS visits_30d FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND status <> 'VOIDED'`, [m.member_id, session.business_id, today])).rows[0];
  const settings = await getSettings(pool, session.business_id);
  // rewards, only when the gym has them on and its plan includes them
  const row = await portal.gymById(session.business_id);
  const rules = row && await portal.portalEnabled(row, 'gym_rewards') ? await rewards.getRules(pool, session.business_id) : null;
  const points = rules?.is_enabled ? await rewards.memberPoints(pool, session.business_id, m.member_id, { limit: 10 }) : null;
  const catalogue = points ? (await pool.query(`SELECT name, description, points_cost FROM gym_rewards WHERE business_id = $1 AND is_active AND (stock IS NULL OR stock > 0) ORDER BY points_cost`, [session.business_id])).rows : [];
  const classesOn = Boolean(row && await portal.portalEnabled(row, 'gym_classes'));
  ok(res, {
    features: { classes: classesOn },
    points: points && { balance: points.balance, expiring_in_30_days: points.expiring_in_30_days, recent: points.entries.map((e) => ({ points: e.points, reason: e.reason, at: e.created_at })) }, rewards: catalogue,
    gym: session.business_name, member: m, members: session.members.map((x) => ({ member_id: x.member_id, name: x.name })),
    memberships, recent_visits: visits, stats, self_checkin_enabled: settings.self_checkin_enabled
  });
};

/** POST /me/pass  a fresh phone pass token: show it as a QR, it lasts a minute and works once */
const pass = async (req, res) => {
  const { session } = req.member;
  const made = await inTx((db) => issuePass(db, { businessId: session.business_id, memberId: session.active_member_id }));
  res.set('Cache-Control', 'no-store');
  ok(res, made);
};

const switchTo = async (req, res) => {
  await portal.switchMember(req.member.token, req.body?.member_id, req.member.session);
  ok(res, { active_member_id: Number(req.body.member_id) });
};

/** POST /me/checkin { token, daily_code?, member_id?, idempotency_key? }  check in at the outlet whose entrance QR this is */
const checkin = async (req, res) => {
  const { session } = req.member;
  const found = await portal.byCheckinToken(req.body?.token);
  if (!found || found.business_id !== session.business_id) throw notFound();
  if (!found.self_checkin_enabled) throw new GymError(403, 'Check-in from your phone is not switched on at this gym. Please use the front desk');
  const memberId = req.body?.member_id != null ? Number(req.body.member_id) : session.active_member_id;
  if (!session.members.some((x) => x.member_id === memberId)) throw notFound();
  const wanted = await portal.todaysCode(found.business_id, found.branch_id);
  const typed = String(req.body?.daily_code ?? '').trim();
  const result = await attempt({
    businessId: found.business_id, branchId: found.branch_id, source: 'SELF', memberId, freshOtpAt: session.otp_verified_at,
    dailyCodeOk: typed.length === wanted.length && safeEqual(typed, wanted), idempotencyKey: req.body?.idempotency_key ? `self:${session.token_hash.slice(0, 12)}:${String(req.body.idempotency_key).slice(0, 50)}` : null
  });
  if (result.unavailable) return res.status(503).json({ success: false, message: result.message, code: result.reason });
  ok(res, { decision: result.decision, reason: result.reason, message: result.message, needs: result.needs ?? null, membership: result.membership, member: result.member ? { name: result.member.name } : null });
};

/** PUT /me/profile  what a member may change themselves. The phone number is not one of them: it is what proves who they are, so the front desk changes it. */
const profile = async (req, res) => {
  const { session } = req.member;
  const b = req.body || {};
  const { text, phone, bool } = await import('../modules/gym/common.js');
  const sets = {}; const cust = {};
  if (b.emergency_name !== undefined) sets.emergency_name = text(b.emergency_name, 'Emergency contact', { max: 120 });
  if (b.emergency_phone !== undefined) sets.emergency_phone = phone(b.emergency_phone, 'Emergency phone');
  if (b.email !== undefined) {
    const email = text(b.email, 'Email', { max: 160 });
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new GymError(400, 'Enter a valid email address');
    cust.email = email;
  }
  if (b.consent_marketing !== undefined) { sets.consent_marketing = bool(b.consent_marketing); cust.marketing_opt_out = !sets.consent_marketing; }
  await inTx(async (db) => {
    const m = (await db.query(`SELECT customer_id FROM gym_members WHERE member_id = $1 AND business_id = $2`, [session.active_member_id, session.business_id])).rows[0];
    const upd = async (table, key, id, obj) => { const k = Object.keys(obj); if (k.length) await db.query(`UPDATE ${table} SET ${k.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE ${key} = $1`, [id, ...k.map((c) => obj[c])]); };
    await upd('gym_members', 'member_id', session.active_member_id, sets);
    await upd('customers', 'customer_id', m.customer_id, cust);
  });
  ok(res, { saved: true });
};

/* ── classes and training, for the signed-in member (only when the gym's plan includes them) ── */

const needFeature = async (session, feature) => {
  const row = await portal.gymById(session.business_id);
  if (!row || !(await portal.portalEnabled(row, feature))) throw notFound();
};

/** GET /me/classes?from&to  the timetable, with this member's own booking on each class */
const myClasses = async (req, res) => {
  const { session } = req.member;
  await needFeature(session, 'gym_classes');
  const { date: today } = await localParts(pool, session.business_id);
  const from = isoDate(req.query.from, 'From') || today;
  const to = isoDate(req.query.to, 'To') || addDays(from, 6);
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 31) throw new GymError(400, 'Ask for a month at most');
  const rows = await classes.listSessions(pool, session.business_id, { from, to, memberId: session.active_member_id });
  const branches = new Map((await pool.query(`SELECT branch_id, name FROM branches WHERE business_id = $1`, [session.business_id])).rows.map((b) => [b.branch_id, b.name]));
  ok(res, rows.map((r) => ({ session_id: r.session_id, class_name: r.class_name, branch: branches.get(r.branch_id), starts_at: r.starts_at, ends_at: r.ends_at, trainer: r.trainer_name, seats_left: r.seats_left, waitlisted: r.waitlisted, my_status: r.my_status, my_booking: r.my_booking, needs_pack: r.requires_pack })));
};
const myBook = async (req, res) => {
  const { session } = req.member;
  await needFeature(session, 'gym_classes');
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) throw notFound();
  const out = await inTx((db) => classes.bookClass(db, { businessId: session.business_id, sessionId, memberId: session.active_member_id, source: 'MEMBER' }));
  ok(res, out, 201);
};
const myCancel = async (req, res) => {
  const { session } = req.member;
  await needFeature(session, 'gym_classes');
  const bookingId = Number(req.params.id);
  const mine = Number.isInteger(bookingId) && (await pool.query(`SELECT 1 FROM gym_class_bookings WHERE booking_id = $1 AND business_id = $2 AND member_id = $3`, [bookingId, session.business_id, session.active_member_id])).rows.length;
  if (!mine) throw notFound();
  const out = await inTx((db) => classes.cancelBooking(db, { businessId: session.business_id, bookingId }));
  ok(res, { late_cancel: out.late_cancel });
};
/** GET /me/training  the member's own workout plan, goals, measurements and packs */
const myTraining = async (req, res) => {
  const { session } = req.member;
  await needFeature(session, 'gym_classes');
  const memberId = session.active_member_id;
  ok(res, {
    workouts: await training.listWorkouts(pool, session.business_id, { memberId }),
    ...(await training.progress(pool, session.business_id, memberId)),
    packs: (await classes.listPacks(pool, session.business_id, memberId)).filter((p) => p.status === 'ACTIVE')
  });
};

const attendance = async (req, res) => {
  const { session } = req.member;
  const rows = (await pool.query(
    `SELECT check_in_at, check_out_at, local_date::text AS local_date FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND status <> 'VOIDED' ORDER BY check_in_at DESC LIMIT 100`, [session.active_member_id, session.business_id])).rows;
  ok(res, rows);
};

export default wrapAll({ myClasses, myBook, myCancel, myTraining, profile, info, entrance, requestOtp, verifyOtp, logout, me, pass, switchTo, checkin, attendance });
