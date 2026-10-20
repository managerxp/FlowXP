/*
 * Trainers, classes, packs, one-to-one sessions, workout plans, goals and measurements, for staff. The rules are in modules/gym/classes.js and training.js;
 * permissions are decided in the router. A trainer's own login reaches only their assigned members (members.js `visibleTo`), checked here by `visible`.
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { recordInvoiceCreated } from '../modules/billing.js';
import { send } from '../modules/messaging/index.js';
import { visibleTo } from '../modules/gym/members.js';
import * as classes from '../modules/gym/classes.js';
import * as training from '../modules/gym/training.js';
import { GymError, addDays, audit, inTx, isoDate, localParts, ok, wrapAll } from '../modules/gym/common.js';

const id = (req, name = 'id') => { const n = Number(req.params[name]); if (!Number.isInteger(n) || n <= 0) throw new GymError(404, 'Not found'); return n; };
const manager = (req) => hasPermission(req.tenant, 'gym_setup');

const visible = async (req, memberId) => {
  const params = [req.tenant.businessId, memberId];
  if (!(await pool.query(`SELECT 1 FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(req.tenant, params)}`, params)).rows.length) throw new GymError(404, 'Not found');
};

/** Tell members about a class (best effort, after the booking is saved): a seat they were waiting for, a class that was cancelled. */
const tell = async (businessId, memberIds, sessionId, what) => {
  try {
    const s = (await pool.query(
      `SELECT t.name AS class_name, s.starts_at, COALESCE(b.timezone, 'Asia/Kolkata') AS tz, b.name AS business FROM gym_class_sessions s JOIN gym_class_types t ON t.class_type_id = s.class_type_id JOIN businesses b ON b.business_id = s.business_id WHERE s.session_id = $1`, [sessionId])).rows[0];
    if (!s || !memberIds.length) return;
    const when = new Date(s.starts_at).toLocaleString('en-IN', { timeZone: s.tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const people = (await pool.query(`SELECT gm.member_id, gm.customer_id, gm.branch_id, c.name, c.phone FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.business_id = $1 AND gm.member_id = ANY($2::int[])`, [businessId, memberIds])).rows;
    for (const p of people) {
      if (!p.phone) continue;
      await send(pool, { businessId, branchId: p.branch_id, customerId: p.customer_id, phone: p.phone, kind: 'GYM_CLASS', values: { name: p.name, business: s.business, class: `${s.class_name} (${what})`, when }, related: { type: 'gym_class', id: sessionId } });
    }
  } catch (error) { console.error('[gym] class message failed:', error.message); }
};

/* ── trainers ───────────────────────────────────────────────────────────────────────────────── */

const trainers = async (req, res) => ok(res, await classes.listTrainers(pool, req.tenant.businessId, { all: req.query.all === 'true' }));
const trainerSave = async (req, res) => {
  const t = await inTx((db) => classes.saveTrainer(db, req.tenant.businessId, req.params.id ? id(req) : null, req.body || {}));
  audit(req, req.params.id ? 'gym.trainer_updated' : 'gym.trainer_added', 'gym_trainer', t.trainer_id, null, { name: t.name });
  ok(res, t, req.params.id ? 200 : 201);
};
const assign = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  await inTx((db) => classes.assignTrainer(db, req.tenant.businessId, memberId, req.body?.trainer_id ? Number(req.body.trainer_id) : null));
  audit(req, 'gym.trainer_assigned', 'gym_member', memberId, null, { trainer_id: req.body?.trainer_id ?? null });
  ok(res, { assigned: true });
};

/* ── class types and the timetable ──────────────────────────────────────────────────────────── */

const classTypes = async (req, res) => ok(res, await classes.listClassTypes(pool, req.tenant.businessId, req.query.all === 'true'));
const classTypeSave = async (req, res) => {
  const c = await inTx((db) => classes.saveClassType(db, req.tenant.businessId, req.params.id ? id(req) : null, req.body || {}));
  audit(req, req.params.id ? 'gym.class_type_updated' : 'gym.class_type_added', 'gym_class_type', c.class_type_id, null, { name: c.name });
  ok(res, c, req.params.id ? 200 : 201);
};

const sessions = async (req, res) => {
  const { date: today } = await localParts(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || today; const to = isoDate(req.query.to, 'To') || addDays(from, 6);
  ok(res, await classes.listSessions(pool, req.tenant.businessId, { from, to, branchId: req.tenant.scopeBranchId, trainerId: req.query.trainer_id ? Number(req.query.trainer_id) : null, includeCancelled: req.query.cancelled === 'true' }));
};
const sessionCreate = async (req, res) => {
  const made = await inTx((db) => classes.createSessions(db, req.tenant.businessId, req.tenant.branchId, req.body || {}));
  audit(req, 'gym.classes_scheduled', 'gym_class_session', made[0].session_id, null, { count: made.length });
  ok(res, made, 201);
};
const sessionCancel = async (req, res) => {
  const sessionId = id(req);
  const own = (await pool.query(`SELECT 1 FROM gym_class_sessions WHERE session_id = $1 AND business_id = $2${req.tenant.scopeBranchId != null ? ' AND branch_id = $3' : ''}`, [sessionId, req.tenant.businessId, ...(req.tenant.scopeBranchId != null ? [req.tenant.scopeBranchId] : [])])).rows.length;
  if (!own) throw new GymError(404, 'Not found');
  const out = await inTx((db) => classes.cancelSession(db, { businessId: req.tenant.businessId, sessionId, reason: req.body?.reason }));
  audit(req, 'gym.class_cancelled', 'gym_class_session', sessionId, null, { cancelled_bookings: out.cancelled, reason: req.body?.reason || null });
  tell(req.tenant.businessId, out.members, sessionId, 'cancelled');
  ok(res, out);
};
const bookings = async (req, res) => {
  const sessionId = id(req);
  const own = (await pool.query(`SELECT 1 FROM gym_class_sessions WHERE session_id = $1 AND business_id = $2${req.tenant.scopeBranchId != null ? ' AND branch_id = $3' : ''}`, [sessionId, req.tenant.businessId, ...(req.tenant.scopeBranchId != null ? [req.tenant.scopeBranchId] : [])])).rows.length;
  if (!own) throw new GymError(404, 'Not found');
  ok(res, await classes.sessionBookings(pool, req.tenant.businessId, sessionId));
};

const book = async (req, res) => {
  const sessionId = id(req);
  const memberId = Number(req.body?.member_id);
  if (!Number.isInteger(memberId)) throw new GymError(400, 'Choose a member');
  await visible(req, memberId);
  const out = await inTx((db) => classes.bookClass(db, { businessId: req.tenant.businessId, sessionId, memberId, source: 'STAFF', userId: req.auth.userId }));
  audit(req, 'gym.class_booked', 'gym_class_booking', out.booking_id, null, { session_id: sessionId, member_id: memberId, status: out.status });
  ok(res, out, 201);
};
const ownBooking = async (req) => {
  const b = (await pool.query(`SELECT member_id FROM gym_class_bookings WHERE booking_id = $1 AND business_id = $2`, [id(req), req.tenant.businessId])).rows[0];
  if (!b) throw new GymError(404, 'Not found');
  await visible(req, b.member_id);
};
const cancelBooking = async (req, res) => {
  await ownBooking(req);
  const sessionId = (await pool.query(`SELECT session_id FROM gym_class_bookings WHERE booking_id = $1`, [id(req)])).rows[0].session_id;
  const out = await inTx((db) => classes.cancelBooking(db, { businessId: req.tenant.businessId, bookingId: id(req) }));
  audit(req, 'gym.class_booking_cancelled', 'gym_class_booking', id(req), null, { late: out.late_cancel });
  if (out.promoted.length) tell(req.tenant.businessId, out.promoted.map((p) => p.member_id), sessionId, 'your place is confirmed');
  ok(res, out);
};
const attend = async (req, res) => {
  await ownBooking(req);
  const out = await inTx((db) => classes.markAttendance(db, { businessId: req.tenant.businessId, bookingId: id(req), status: String(req.body?.status || '').toUpperCase() }));
  audit(req, 'gym.class_attendance', 'gym_class_booking', id(req), null, out);
  ok(res, out);
};

/* ── packs and one-to-one sessions ──────────────────────────────────────────────────────────── */

const packs = async (req, res) => { const memberId = id(req); await visible(req, memberId); ok(res, await classes.listPacks(pool, req.tenant.businessId, memberId)); };
const sellPack = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const sold = await inTx((db) => classes.sellPack(db, req.tenant, req.auth.userId, memberId, req.body || {}, { allowDiscount: manager(req), allowComplimentary: manager(req) }));
  if (sold.invoice) recordInvoiceCreated(req, sold.invoice);
  audit(req, 'gym.pack_sold', 'gym_pack', sold.pack_id, null, { member_id: memberId, invoice_id: sold.invoice?.invoice_id ?? null });
  ok(res, sold, 201);
};
const ptList = async (req, res) => {
  const { date: today } = await localParts(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || today; const to = isoDate(req.query.to, 'To') || addDays(from, 6);
  let trainerId = req.query.trainer_id ? Number(req.query.trainer_id) : null;
  if (!manager(req) && !hasPermission(req.tenant, 'gym_desk')) {   // a trainer's own login sees their own sessions
    const mine = (await pool.query(`SELECT trainer_id FROM gym_trainers WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, req.tenant.userId])).rows[0];
    trainerId = mine?.trainer_id ?? -1;
  }
  ok(res, await classes.listPt(pool, req.tenant.businessId, { from, to, trainerId, branchId: req.tenant.scopeBranchId, memberId: req.query.member_id ? Number(req.query.member_id) : null }));
};
const ptBook = async (req, res) => {
  const memberId = Number(req.body?.member_id);
  if (!Number.isInteger(memberId)) throw new GymError(400, 'Choose a member');
  await visible(req, memberId);
  const out = await inTx((db) => classes.bookPt(db, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, memberId, b: req.body, userId: req.auth.userId }));
  audit(req, 'gym.pt_booked', 'gym_pt_session', out.pt_id, null, { member_id: memberId });
  ok(res, out, 201);
};
const ownPt = async (req) => {
  const p = (await pool.query(`SELECT member_id FROM gym_pt_sessions WHERE pt_id = $1 AND business_id = $2`, [id(req), req.tenant.businessId])).rows[0];
  if (!p) throw new GymError(404, 'Not found');
  await visible(req, p.member_id);
};
const ptCancel = async (req, res) => { await ownPt(req); const out = await inTx((db) => classes.cancelPt(db, { businessId: req.tenant.businessId, ptId: id(req) })); audit(req, 'gym.pt_cancelled', 'gym_pt_session', id(req), null, out); ok(res, out); };
const ptFinish = async (req, res) => { await ownPt(req); const out = await inTx((db) => classes.finishPt(db, { businessId: req.tenant.businessId, ptId: id(req), status: String(req.body?.status || '').toUpperCase() })); audit(req, 'gym.pt_closed', 'gym_pt_session', id(req), null, out); ok(res, out); };

const trainerReport = async (req, res) => {
  const { date: today } = await localParts(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || `${today.slice(0, 7)}-01`; const to = isoDate(req.query.to, 'To') || today;
  ok(res, { from, to, trainers: await classes.trainerReport(pool, req.tenant.businessId, { from, to, branchId: req.tenant.scopeBranchId }) });
};

/* ── workouts, goals, measurements ──────────────────────────────────────────────────────────── */

const exercises = async (req, res) => ok(res, await training.listExercises(pool, req.tenant.businessId, { q: req.query.q, all: req.query.all === 'true' }));
const exerciseSave = async (req, res) => { const e = await inTx((db) => training.saveExercise(db, req.tenant.businessId, req.params.id ? id(req) : null, req.body || {})); ok(res, e, req.params.id ? 200 : 201); };

const myTrainerId = async (req) => (await pool.query(`SELECT trainer_id FROM gym_trainers WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, req.tenant.userId])).rows[0]?.trainer_id ?? null;

const templates = async (req, res) => ok(res, await training.listWorkouts(pool, req.tenant.businessId, { templates: true }));
const templateCreate = async (req, res) => { const wid = await inTx((db) => training.createWorkout(db, { businessId: req.tenant.businessId, userId: req.auth.userId, b: req.body || {} })); ok(res, { workout_id: wid }, 201); };

const memberWorkouts = async (req, res) => { const memberId = id(req); await visible(req, memberId); ok(res, await training.listWorkouts(pool, req.tenant.businessId, { memberId })); };
const workoutCreate = async (req, res) => {
  const memberId = id(req);
  await visible(req, memberId);
  const trainerId = await myTrainerId(req);
  const wid = await inTx((db) => (req.body?.template_id
    ? training.assignTemplate(db, { businessId: req.tenant.businessId, templateId: Number(req.body.template_id), memberId, trainerId, userId: req.auth.userId })
    : training.createWorkout(db, { businessId: req.tenant.businessId, memberId, trainerId, userId: req.auth.userId, b: req.body || {} })));
  audit(req, 'gym.workout_plan_made', 'gym_workout_plan', wid, null, { member_id: memberId });
  ok(res, { workout_id: wid }, 201);
};
const workoutUpdate = async (req, res) => {
  const w = (await pool.query(`SELECT member_id, is_template FROM gym_workout_plans WHERE workout_id = $1 AND business_id = $2`, [id(req), req.tenant.businessId])).rows[0];
  if (!w) throw new GymError(404, 'Not found');
  if (w.member_id) await visible(req, w.member_id); else if (!manager(req)) throw new GymError(404, 'Not found');
  await inTx((db) => training.updateWorkout(db, { businessId: req.tenant.businessId, workoutId: id(req), b: req.body || {} }));
  ok(res, { updated: true });
};

const progress = async (req, res) => { const memberId = id(req); await visible(req, memberId); ok(res, await training.progress(pool, req.tenant.businessId, memberId)); };
const goalAdd = async (req, res) => { const memberId = id(req); await visible(req, memberId); const g = await inTx((db) => training.addGoal(db, { businessId: req.tenant.businessId, memberId, userId: req.auth.userId, b: req.body || {} })); ok(res, g, 201); };
const goalStatus = async (req, res) => { const memberId = id(req); await visible(req, memberId); ok(res, await inTx((db) => training.setGoalStatus(db, { businessId: req.tenant.businessId, goalId: id(req, 'goalId'), memberId, status: req.body?.status }))); };
const measurementAdd = async (req, res) => { const memberId = id(req); await visible(req, memberId); const m = await inTx((db) => training.addMeasurement(db, { businessId: req.tenant.businessId, memberId, userId: req.auth.userId, b: req.body || {} })); ok(res, m, 201); };

export default wrapAll({ trainers, trainerSave, assign, classTypes, classTypeSave, sessions, sessionCreate, sessionCancel, bookings, book, cancelBooking, attend, packs, sellPack, ptList, ptBook, ptCancel, ptFinish, trainerReport, exercises, exerciseSave, templates, templateCreate, memberWorkouts, workoutCreate, workoutUpdate, progress, goalAdd, goalStatus, measurementAdd });
