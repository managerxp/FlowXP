/*
 * Trainers, class timetable and booking, and personal-training and class packs.
 *
 * RULES THAT MATTER
 *   A seat is never sold twice: booking takes a lock on the class, counts the seats under the lock, and the database refuses a second live booking for the same
 *   member and class. When a seat opens, the first person on the waitlist who can still come takes it.
 *   Who may book follows the door's rules: a member can book a class if they could walk into the gym at the time of the class (membership running, paid as the plan
 *   asks, valid at that branch and at that hour). A class that is sold separately takes a session from a class pack instead.
 *   A pack session is reserved when it is booked, given back when it is cancelled in time, and kept when it is used, missed or cancelled too late.
 *   Times are the gym's own: a class is created for a date and a clock time, which Postgres turns into an instant in the gym's time zone.
 */
import { createInvoiceInTransaction } from '../billing.js';
import { toRupees } from '../../utils/money.js';
import { GymError, addDays, bool, clock, getBranchSettings, getSettings, int, isoDate, localParts, text, withRupees } from './common.js';
import { evaluate, loadMemberships, paymentOk } from './access.js';

const bad = (message) => new GymError(400, message);

/* ── time ───────────────────────────────────────────────────────────────────────────────────── */

/** A gym-local date and clock time as an instant. */
export const localToInstant = async (db, businessId, date, time) =>
  (await db.query(`SELECT (($2::date + $3::time) AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata')) AS t`, [businessId, date, time])).rows[0].t;

const hoursUntil = (when, now) => (new Date(when) - now) / 3600000;
const lockSession = async (db, businessId, sessionId) => {
  const s = (await db.query(
    `SELECT s.*, t.name AS class_name, t.requires_pack FROM gym_class_sessions s JOIN gym_class_types t ON t.class_type_id = s.class_type_id
     WHERE s.session_id = $1 AND s.business_id = $2 FOR NO KEY UPDATE OF s`, [sessionId, businessId])).rows[0];
  if (!s) throw new GymError(404, 'Not found');
  return s;
};

/* ── trainers ───────────────────────────────────────────────────────────────────────────────── */

export const listTrainers = async (db, businessId, { all = false } = {}) => (await db.query(
  `SELECT t.*, (SELECT COUNT(*)::int FROM gym_members m WHERE m.assigned_trainer_id = t.trainer_id AND m.status <> 'ARCHIVED') AS clients, u.name AS login_name
   FROM gym_trainers t LEFT JOIN users u ON u.user_id = t.user_id WHERE t.business_id = $1 ${all ? '' : 'AND t.is_active'} ORDER BY t.name`, [businessId])).rows;

export const saveTrainer = async (db, businessId, id, b) => {
  const cur = id ? (await db.query(`SELECT * FROM gym_trainers WHERE trainer_id = $1 AND business_id = $2`, [id, businessId])).rows[0] : null;
  if (id && !cur) throw new GymError(404, 'Not found');
  const has = (k) => b[k] !== undefined;
  const t = {
    name: has('name') ? text(b.name, 'Name', { max: 120, required: true }) : cur?.name ?? text(b.name, 'Name', { max: 120, required: true }),
    phone: has('phone') ? text(b.phone, 'Phone', { max: 32 }) : cur?.phone ?? null,
    bio: has('bio') ? text(b.bio, 'About', { max: 500 }) : cur?.bio ?? null,
    specialties: has('specialties') ? text(b.specialties, 'Specialities', { max: 200 }) : cur?.specialties ?? null,
    branch_id: has('branch_id') ? (b.branch_id ? Number(b.branch_id) : null) : cur?.branch_id ?? null,
    user_id: has('user_id') ? (b.user_id ? Number(b.user_id) : null) : cur?.user_id ?? null
  };
  if (t.branch_id && !(await db.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2`, [t.branch_id, businessId])).rows.length) throw bad('Choose one of this gym\'s branches');
  if (t.user_id && !(await db.query(`SELECT 1 FROM business_users WHERE user_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [t.user_id, businessId])).rows.length) throw bad('That login does not belong to this gym');
  try {
    if (!id) return (await db.query(`INSERT INTO gym_trainers (business_id, branch_id, user_id, name, phone, bio, specialties) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [businessId, t.branch_id, t.user_id, t.name, t.phone, t.bio, t.specialties])).rows[0];
    return (await db.query(`UPDATE gym_trainers SET branch_id = $3, user_id = $4, name = $5, phone = $6, bio = $7, specialties = $8, is_active = COALESCE($9, is_active) WHERE trainer_id = $1 AND business_id = $2 RETURNING *`,
      [id, businessId, t.branch_id, t.user_id, t.name, t.phone, t.bio, t.specialties, has('is_active') ? bool(b.is_active) : null])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new GymError(409, 'That login is already another trainer');
    throw error;
  }
};

export const assignTrainer = async (db, businessId, memberId, trainerId) => {
  if (trainerId != null && !(await db.query(`SELECT 1 FROM gym_trainers WHERE trainer_id = $1 AND business_id = $2 AND is_active`, [trainerId, businessId])).rows.length) throw bad('That trainer is not available');
  const r = await db.query(`UPDATE gym_members SET assigned_trainer_id = $3 WHERE member_id = $1 AND business_id = $2 RETURNING member_id`, [memberId, businessId, trainerId]);
  if (!r.rows.length) throw new GymError(404, 'Not found');
};

/* ── class types and the timetable ──────────────────────────────────────────────────────────── */

export const listClassTypes = async (db, businessId, all = false) => (await db.query(`SELECT * FROM gym_class_types WHERE business_id = $1 ${all ? '' : 'AND is_active'} ORDER BY name`, [businessId])).rows;

export const saveClassType = async (db, businessId, id, b) => {
  const cur = id ? (await db.query(`SELECT * FROM gym_class_types WHERE class_type_id = $1 AND business_id = $2`, [id, businessId])).rows[0] : null;
  if (id && !cur) throw new GymError(404, 'Not found');
  const has = (k) => b[k] !== undefined;
  const c = {
    name: has('name') ? text(b.name, 'Name', { max: 80, required: true }) : cur?.name ?? text(b.name, 'Name', { max: 80, required: true }),
    description: has('description') ? text(b.description, 'Description', { max: 300 }) : cur?.description ?? null,
    duration_min: has('duration_min') ? int(b.duration_min, 'Length in minutes', { min: 10, max: 480, required: true }) : cur?.duration_min ?? 60,
    default_capacity: has('default_capacity') ? int(b.default_capacity, 'Places', { min: 1, max: 500, required: true }) : cur?.default_capacity ?? 20,
    requires_pack: has('requires_pack') ? bool(b.requires_pack) : cur?.requires_pack ?? false,
    is_active: has('is_active') ? bool(b.is_active) : cur?.is_active ?? true
  };
  if (!id) return (await db.query(`INSERT INTO gym_class_types (business_id, name, description, duration_min, default_capacity, requires_pack) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [businessId, c.name, c.description, c.duration_min, c.default_capacity, c.requires_pack])).rows[0];
  return (await db.query(`UPDATE gym_class_types SET name = $3, description = $4, duration_min = $5, default_capacity = $6, requires_pack = $7, is_active = $8 WHERE class_type_id = $1 AND business_id = $2 RETURNING *`,
    [id, businessId, c.name, c.description, c.duration_min, c.default_capacity, c.requires_pack, c.is_active])).rows[0];
};

/** Is this trainer free from `start` to `end`? Other classes and one-to-one sessions both count. */
const trainerBusy = async (db, trainerId, start, end, { exceptSession = null, exceptPt = null } = {}) => (await db.query(
  `SELECT 1 FROM gym_class_sessions WHERE trainer_id = $1 AND status = 'SCHEDULED' AND starts_at < $3 AND ends_at > $2 AND ($4::int IS NULL OR session_id <> $4)
   UNION ALL SELECT 1 FROM gym_pt_sessions WHERE trainer_id = $1 AND status = 'SCHEDULED' AND starts_at < $3 AND ends_at > $2 AND ($5::int IS NULL OR pt_id <> $5) LIMIT 1`,
  [trainerId, start, end, exceptSession, exceptPt])).rows.length > 0;

/**
 * Put a class on the timetable. `weeks` repeats it on the same weekday for that many weeks (up to 26). All or none: if any date clashes (a trainer already busy), nothing is made.
 * b: { class_type_id, branch_id, trainer_id?, date, start (HH:MM), capacity?, room?, weeks? }
 */
export const createSessions = async (db, businessId, branchId, b) => {
  const type = (await db.query(`SELECT * FROM gym_class_types WHERE class_type_id = $1 AND business_id = $2 AND is_active`, [Number(b.class_type_id), businessId])).rows[0];
  if (!type) throw bad('Choose a class');
  const date = isoDate(b.date, 'Date', { required: true }); const time = clock(b.start, 'Start time', { required: true });
  const capacity = b.capacity != null && b.capacity !== '' ? int(b.capacity, 'Places', { min: 1, max: 500 }) : type.default_capacity;
  const weeks = b.weeks != null && b.weeks !== '' ? int(b.weeks, 'Weeks', { min: 1, max: 26 }) : 1;
  const room = text(b.room, 'Room', { max: 60 });
  let trainerId = null;
  if (b.trainer_id) {
    trainerId = Number(b.trainer_id);
    if (!(await db.query(`SELECT 1 FROM gym_trainers WHERE trainer_id = $1 AND business_id = $2 AND is_active`, [trainerId, businessId])).rows.length) throw bad('That trainer is not available');
  }
  if (!(await db.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2`, [branchId, businessId])).rows.length) throw bad('Choose one of this gym\'s branches');
  const made = [];
  for (let w = 0; w < weeks; w++) {
    const day = addDays(date, w * 7);
    const starts = await localToInstant(db, businessId, day, time);
    const ends = new Date(new Date(starts).getTime() + type.duration_min * 60000);
    if (trainerId && await trainerBusy(db, trainerId, starts, ends)) throw new GymError(409, `The trainer already has something on ${day} at ${time}`);
    made.push((await db.query(
      `INSERT INTO gym_class_sessions (business_id, branch_id, class_type_id, trainer_id, starts_at, ends_at, capacity, room) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, branchId, type.class_type_id, trainerId, starts, ends, capacity, room])).rows[0]);
  }
  return made;
};

/** The timetable for a range (gym-local dates), with seats taken, and, when asked, what one member's booking is. */
export const listSessions = async (db, businessId, { from, to, branchId = null, memberId = null, includeCancelled = false, trainerId = null }) => {
  const rows = (await db.query(
    `SELECT s.session_id, s.branch_id, s.starts_at, s.ends_at, s.capacity, s.room, s.status, s.cancel_reason, s.class_type_id, t.name AS class_name, t.requires_pack, s.trainer_id, tr.name AS trainer_name,
            (SELECT COUNT(*)::int FROM gym_class_bookings b WHERE b.session_id = s.session_id AND b.status IN ('BOOKED','ATTENDED','NO_SHOW')) AS booked,
            (SELECT COUNT(*)::int FROM gym_class_bookings b WHERE b.session_id = s.session_id AND b.status = 'WAITLISTED') AS waitlisted,
            (SELECT b.status FROM gym_class_bookings b WHERE b.session_id = s.session_id AND b.member_id = $5 AND b.status <> 'CANCELLED') AS my_status,
            (SELECT b.booking_id FROM gym_class_bookings b WHERE b.session_id = s.session_id AND b.member_id = $5 AND b.status <> 'CANCELLED') AS my_booking
     FROM gym_class_sessions s JOIN gym_class_types t ON t.class_type_id = s.class_type_id LEFT JOIN gym_trainers tr ON tr.trainer_id = s.trainer_id
     WHERE s.business_id = $1
       AND (s.starts_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date BETWEEN $2::date AND $3::date
       AND ($4::int IS NULL OR s.branch_id = $4) AND ($6::int IS NULL OR s.trainer_id = $6) ${includeCancelled ? '' : "AND s.status <> 'CANCELLED'"} ORDER BY s.starts_at, s.session_id`,
    [businessId, from, to, branchId, memberId, trainerId])).rows;
  return rows.map((r) => ({ ...r, seats_left: Math.max(0, r.capacity - r.booked) }));
};

/* ── eligibility ────────────────────────────────────────────────────────────────────────────── */

/** Could this member come to the gym at the time of this class? The same rules as the door, judged at the class's date and hour. */
const gymEligibility = async (db, businessId, member, session, memberships) => {
  const settings = await getSettings(db, businessId);
  const branch = await getBranchSettings(db, businessId, session.branch_id);
  const at = await localParts(db, businessId, new Date(session.starts_at));
  const ctx = { ...at, today: at.date, branchId: session.branch_id, graceDefault: settings.grace_days, hours: branch.hours, holidays: branch.holidays };
  return evaluate({ member, memberships, ctx });
};

const loadMember = async (db, businessId, memberId) => (await db.query(`SELECT member_id, status FROM gym_members WHERE member_id = $1 AND business_id = $2`, [memberId, businessId])).rows[0] || null;

/** A pack the member can use at `at` for this kind, with sessions left. Locks the row. */
export const usablePack = async (db, businessId, memberId, kind, at) => {
  const { date } = await localParts(db, businessId, at);
  // lock the packs first, THEN count what is left: counted in the same statement, two bookings racing for the last session would both read the old count
  const packs = (await db.query(
    `SELECT p.*, p.start_date::text AS start_date, p.expires_on::text AS expires_on, i.status AS inv_status, i.total_paise, i.amount_paid_paise, i.balance_due_paise, i.credited_paise
     FROM gym_packs p LEFT JOIN invoices i ON i.invoice_id = p.invoice_id AND i.business_id = p.business_id
     WHERE p.business_id = $1 AND p.member_id = $2 AND p.kind = $3 AND p.status = 'ACTIVE' AND p.start_date <= $4::date AND p.expires_on >= $4::date ORDER BY p.expires_on, p.pack_id FOR UPDATE OF p`,
    [businessId, memberId, kind, date])).rows;
  for (const p of packs) p.sessions_left = p.sessions_total - (await db.query(`SELECT COUNT(*)::int AS n FROM gym_pack_usage WHERE pack_id = $1 AND status <> 'RELEASED'`, [p.pack_id])).rows[0].n;
  return packs.find((p) => p.sessions_left > 0 && paymentOk({ payment_basis: p.payment_basis, payment_policy: p.payment_policy, pay_later_until: null }, p.invoice_id ? { inv_status: p.inv_status, total_paise: p.total_paise, amount_paid_paise: p.amount_paid_paise, balance_due_paise: p.balance_due_paise, credited_paise: p.credited_paise } : null, date)) || null;
};

const reserve = (db, businessId, packId, refType, refId) =>
  db.query(`INSERT INTO gym_pack_usage (pack_id, business_id, ref_type, ref_id) VALUES ($1,$2,$3,$4)`, [packId, businessId, refType, refId]);
const settleUsage = (db, refType, refId, status) =>
  db.query(`UPDATE gym_pack_usage SET status = $3 WHERE ref_type = $1 AND ref_id = $2 AND status = 'RESERVED'`, [refType, refId, status]);

/** Does the member already have a class or a one-to-one session overlapping [start, end)? */
const memberBusy = async (db, businessId, memberId, start, end, { exceptBooking = null, exceptPt = null } = {}) => (await db.query(
  `SELECT 1 FROM gym_class_bookings b JOIN gym_class_sessions s ON s.session_id = b.session_id WHERE b.business_id = $1 AND b.member_id = $2 AND b.status IN ('BOOKED','WAITLISTED') AND s.status = 'SCHEDULED' AND s.starts_at < $4 AND s.ends_at > $3 AND ($5::int IS NULL OR b.booking_id <> $5)
   UNION ALL SELECT 1 FROM gym_pt_sessions WHERE business_id = $1 AND member_id = $2 AND status = 'SCHEDULED' AND starts_at < $4 AND ends_at > $3 AND ($6::int IS NULL OR pt_id <> $6) LIMIT 1`,
  [businessId, memberId, start, end, exceptBooking, exceptPt])).rows.length > 0;

/* ── booking ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Book a member into a class: a seat if there is one, otherwise the waitlist (if the gym uses one). Call inside a transaction.
 * source 'MEMBER' also applies the booking window (how far ahead a member may book); staff can book any time before the class starts.
 */
export const bookClass = async (db, { businessId, sessionId, memberId, source = 'STAFF', userId = null, now = new Date() }) => {
  const s = await lockSession(db, businessId, sessionId);
  if (s.status !== 'SCHEDULED') throw new GymError(409, 'This class is not running');
  if (new Date(s.starts_at) <= now) throw new GymError(409, 'This class has already started');
  const settings = await getSettings(db, businessId);
  if (source === 'MEMBER' && hoursUntil(s.starts_at, now) > settings.class_booking_days * 24) throw new GymError(409, `Classes can be booked up to ${settings.class_booking_days} days ahead`);
  const member = await loadMember(db, businessId, memberId);
  if (!member || member.status === 'ARCHIVED') throw new GymError(404, 'Not found');
  if (member.status !== 'ACTIVE') throw new GymError(409, 'This account is not active');

  let pack = null;
  if (s.requires_pack) {
    pack = await usablePack(db, businessId, memberId, 'CLASS_PACK', new Date(s.starts_at));
    if (!pack) throw new GymError(409, 'This class needs a class pack with sessions left');
  } else {
    const v = await gymEligibility(db, businessId, member, s, await loadMemberships(db, businessId, memberId));
    if (v.decision !== 'APPROVED') throw new GymError(409, `They cannot book this class: ${v.reason.toLowerCase().replace(/_/g, ' ')}`, { code: v.reason });
  }
  if ((await db.query(`SELECT 1 FROM gym_class_bookings WHERE session_id = $1 AND member_id = $2 AND status <> 'CANCELLED'`, [sessionId, memberId])).rows.length) throw new GymError(409, 'They are already booked into this class');
  if (await memberBusy(db, businessId, memberId, s.starts_at, s.ends_at)) throw new GymError(409, 'They already have something booked at that time');
  const taken = (await db.query(`SELECT COUNT(*)::int AS n FROM gym_class_bookings WHERE session_id = $1 AND status IN ('BOOKED','ATTENDED','NO_SHOW')`, [sessionId])).rows[0].n;
  const seat = taken < s.capacity;
  if (!seat && !settings.class_waitlist) throw new GymError(409, 'This class is full');
  let row;
  try {
    row = (await db.query(
      `INSERT INTO gym_class_bookings (business_id, session_id, member_id, status, pack_id, source, created_by, booked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [businessId, sessionId, memberId, seat ? 'BOOKED' : 'WAITLISTED', seat ? pack?.pack_id ?? null : null, source, userId, now])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new GymError(409, 'They are already booked into this class');
    throw error;
  }
  if (seat && pack) await reserve(db, businessId, pack.pack_id, 'CLASS', row.booking_id);
  const position = seat ? null : (await db.query(`SELECT COUNT(*)::int AS n FROM gym_class_bookings WHERE session_id = $1 AND status = 'WAITLISTED' AND booking_id <= $2`, [sessionId, row.booking_id])).rows[0].n;
  return { booking_id: row.booking_id, status: row.status, waitlist_position: position };
};

/** The first people waiting, in the order they asked, who can still come, take free seats. Returns who was promoted (so they can be told). */
const promoteWaitlist = async (db, businessId, s, now) => {
  const promoted = [];
  for (;;) {
    const taken = (await db.query(`SELECT COUNT(*)::int AS n FROM gym_class_bookings WHERE session_id = $1 AND status IN ('BOOKED','ATTENDED','NO_SHOW')`, [s.session_id])).rows[0].n;
    if (taken >= s.capacity) break;
    const waiting = (await db.query(`SELECT * FROM gym_class_bookings WHERE session_id = $1 AND status = 'WAITLISTED' ORDER BY booked_at, booking_id FOR UPDATE`, [s.session_id])).rows;
    let took = false;
    for (const w of waiting) {
      const member = await loadMember(db, businessId, w.member_id);
      let ok = member?.status === 'ACTIVE';
      let pack = null;
      if (ok && s.requires_pack) { pack = await usablePack(db, businessId, w.member_id, 'CLASS_PACK', new Date(s.starts_at)); ok = Boolean(pack); }
      else if (ok) ok = (await gymEligibility(db, businessId, member, s, await loadMemberships(db, businessId, w.member_id))).decision === 'APPROVED';
      if (ok && await memberBusy(db, businessId, w.member_id, s.starts_at, s.ends_at, { exceptBooking: w.booking_id })) ok = false;
      if (!ok) continue;   // not eligible any more: they stay on the list, and the next person is offered the seat
      await db.query(`UPDATE gym_class_bookings SET status = 'BOOKED', pack_id = $2 WHERE booking_id = $1`, [w.booking_id, pack?.pack_id ?? null]);
      if (pack) await reserve(db, businessId, pack.pack_id, 'CLASS', w.booking_id);
      promoted.push({ booking_id: w.booking_id, member_id: w.member_id });
      took = true;
      break;
    }
    if (!took) break;
  }
  return promoted;
};

/** Cancel a booking. A seat given up inside the cancellation window keeps its pack session. The freed seat goes to the waitlist. */
export const cancelBooking = async (db, { businessId, bookingId, now = new Date() }) => {
  const b = (await db.query(`SELECT * FROM gym_class_bookings WHERE booking_id = $1 AND business_id = $2`, [bookingId, businessId])).rows[0];
  if (!b) throw new GymError(404, 'Not found');
  const s = await lockSession(db, businessId, b.session_id);
  const cur = (await db.query(`SELECT * FROM gym_class_bookings WHERE booking_id = $1 FOR UPDATE`, [bookingId])).rows[0];
  if (!['BOOKED', 'WAITLISTED'].includes(cur.status)) throw new GymError(409, 'This booking cannot be cancelled');
  const settings = await getSettings(db, businessId);
  const late = cur.status === 'BOOKED' && hoursUntil(s.starts_at, now) < settings.class_cancel_hours;
  await db.query(`UPDATE gym_class_bookings SET status = 'CANCELLED', cancelled_at = $2, late_cancel = $3 WHERE booking_id = $1`, [bookingId, now, late]);
  if (cur.status === 'BOOKED') await settleUsage(db, 'CLASS', bookingId, late ? 'CONSUMED' : 'RELEASED');
  const promoted = cur.status === 'BOOKED' && s.status === 'SCHEDULED' && new Date(s.starts_at) > now ? await promoteWaitlist(db, businessId, s, now) : [];
  return { late_cancel: late, promoted };
};

/** After the class: they came, or they did not. A no-show keeps the pack session. */
export const markAttendance = async (db, { businessId, bookingId, status, now = new Date() }) => {
  if (!['ATTENDED', 'NO_SHOW', 'BOOKED'].includes(status)) throw bad('Mark them as attended or no-show');
  const b = (await db.query(`SELECT * FROM gym_class_bookings WHERE booking_id = $1 AND business_id = $2`, [bookingId, businessId])).rows[0];
  if (!b) throw new GymError(404, 'Not found');
  const s = await lockSession(db, businessId, b.session_id);
  if (s.status === 'CANCELLED') throw new GymError(409, 'This class was cancelled');
  if (new Date(s.starts_at) > new Date(now.getTime() + 15 * 60000)) throw new GymError(409, 'The class has not started yet');
  const cur = (await db.query(`SELECT * FROM gym_class_bookings WHERE booking_id = $1 FOR UPDATE`, [bookingId])).rows[0];
  if (!['BOOKED', 'ATTENDED', 'NO_SHOW'].includes(cur.status)) throw new GymError(409, 'Only a booked place can be marked');
  await db.query(`UPDATE gym_class_bookings SET status = $2::varchar, attended_at = CASE WHEN $2::text = 'ATTENDED' THEN $3::timestamptz ELSE NULL END WHERE booking_id = $1`, [bookingId, status, now]);
  if (status !== 'BOOKED') await settleUsage(db, 'CLASS', bookingId, 'CONSUMED');
  return { status };
};

/** Cancel a whole class (the trainer is ill). Everyone is let off without a late fee and any pack session returns. Returns the people to tell. */
export const cancelSession = async (db, { businessId, sessionId, reason }) => {
  const s = await lockSession(db, businessId, sessionId);
  if (s.status !== 'SCHEDULED') throw new GymError(409, 'This class is not running');
  await db.query(`UPDATE gym_class_sessions SET status = 'CANCELLED', cancel_reason = $2 WHERE session_id = $1`, [sessionId, text(reason, 'Reason', { max: 200 })]);
  const people = (await db.query(`SELECT booking_id, member_id, status FROM gym_class_bookings WHERE session_id = $1 AND status IN ('BOOKED','WAITLISTED') FOR UPDATE`, [sessionId])).rows;
  for (const p of people) {
    await db.query(`UPDATE gym_class_bookings SET status = 'CANCELLED', cancelled_at = now(), late_cancel = FALSE WHERE booking_id = $1`, [p.booking_id]);
    await settleUsage(db, 'CLASS', p.booking_id, 'RELEASED');
  }
  return { cancelled: people.length, members: people.map((p) => p.member_id) };
};

export const sessionBookings = async (db, businessId, sessionId) => (await db.query(
  `SELECT b.booking_id, b.member_id, b.status, b.late_cancel, b.source, b.booked_at, gm.member_code, c.name AS member_name, b.pack_id
   FROM gym_class_bookings b JOIN gym_members gm ON gm.member_id = b.member_id JOIN customers c ON c.customer_id = gm.customer_id
   WHERE b.business_id = $1 AND b.session_id = $2 AND b.status <> 'CANCELLED' ORDER BY CASE b.status WHEN 'WAITLISTED' THEN 1 ELSE 0 END, b.booked_at, b.booking_id`, [businessId, sessionId])).rows;

/* ── packs: sold like a membership ──────────────────────────────────────────────────────────── */

/** Sell a personal-training or class pack and bill it. Call inside a transaction. */
export const sellPack = async (db, tenant, userId, memberId, input, { allowDiscount = false, allowComplimentary = false } = {}) => {
  const member = await loadMember(db, tenant.businessId, memberId);
  if (!member || member.status === 'ARCHIVED') throw new GymError(404, 'Not found');
  const plan = (await db.query(`SELECT * FROM gym_plans WHERE plan_id = $1 AND business_id = $2 AND is_active`, [Number(input.plan_id), tenant.businessId])).rows[0];
  if (!plan || plan.kind === 'MEMBERSHIP') throw bad('Choose a personal-training or class pack');
  const customer = (await db.query(`SELECT customer_id FROM gym_members WHERE member_id = $1`, [memberId])).rows[0].customer_id;
  const { date: today } = await localParts(db, tenant.businessId);
  const start = input.start_date ? isoDate(input.start_date, 'Start date') : today;
  const end = addDays(start, plan.duration_days - 1);
  const discount = input.discount ? Number(input.discount) : 0;
  if (discount && !allowDiscount) throw new GymError(403, 'You cannot give a discount. Ask a manager');
  const complimentary = input.complimentary === true;
  if (complimentary && !allowComplimentary) throw new GymError(403, 'Only a manager can give a pack free');
  let invoice = null;
  if (!complimentary) {
    invoice = await createInvoiceInTransaction(db, tenant, userId, {
      customerId: customer, items: [{ description: `${plan.name} (${plan.sessions} sessions, to ${end})`, quantity: 1, unit_price: toRupees(plan.price_paise), tax_rate: Number(plan.tax_rate), discount: discount || undefined }],
      payment: input.payment, payments: input.payments, notes: input.notes || `Gym pack: ${plan.name}`, invoiceDate: today
    });
  }
  const row = (await db.query(
    `INSERT INTO gym_packs (business_id, member_id, plan_id, plan_name, kind, sessions_total, start_date, expires_on, price_paise, payment_policy, payment_basis, invoice_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING pack_id`,
    [tenant.businessId, memberId, plan.plan_id, plan.name, plan.kind, plan.sessions, start, end, invoice ? Math.round((invoice.subtotal - invoice.discount) * 100) : 0, plan.payment_policy === 'PAY_LATER' ? 'FULL_REQUIRED' : plan.payment_policy, complimentary ? 'COMPED' : 'INVOICE', invoice?.invoice_id ?? null, userId])).rows[0];
  return { pack_id: row.pack_id, sessions: plan.sessions, expires_on: end, invoice };
};

export const listPacks = async (db, businessId, memberId) => withRupees((await db.query(
  `SELECT p.pack_id, p.plan_name, p.kind, p.sessions_total, p.start_date::text AS start_date, p.expires_on::text AS expires_on, p.status, p.invoice_id, p.price_paise,
          p.sessions_total - (SELECT COUNT(*)::int FROM gym_pack_usage u WHERE u.pack_id = p.pack_id AND u.status <> 'RELEASED') AS sessions_left,
          (SELECT COUNT(*)::int FROM gym_pack_usage u WHERE u.pack_id = p.pack_id AND u.status = 'CONSUMED') AS sessions_used,
          COALESCE(i.balance_due_paise, 0) AS due_paise
   FROM gym_packs p LEFT JOIN invoices i ON i.invoice_id = p.invoice_id WHERE p.business_id = $1 AND p.member_id = $2 ORDER BY p.created_at DESC`, [businessId, memberId])).rows);

/** A cancelled or fully refunded invoice ends the pack it paid for, and the one-to-one sessions that were waiting on it. */
export const onInvoiceVoided = async (db, { businessId, invoiceId }) => {
  const packs = (await db.query(`UPDATE gym_packs SET status = 'CANCELLED' WHERE invoice_id = $1 AND business_id = $2 AND status = 'ACTIVE' RETURNING pack_id`, [invoiceId, businessId])).rows;
  for (const p of packs) {
    await db.query(`UPDATE gym_pt_sessions SET status = 'CANCELLED' WHERE pack_id = $1 AND status = 'SCHEDULED'`, [p.pack_id]);
    await db.query(`UPDATE gym_pack_usage SET status = 'RELEASED' WHERE pack_id = $1 AND status = 'RESERVED'`, [p.pack_id]);
    await db.query(`UPDATE gym_class_bookings SET status = 'CANCELLED', cancelled_at = now() WHERE pack_id = $1 AND status = 'BOOKED'`, [p.pack_id]);
  }
  return packs.length;
};

/* ── one-to-one sessions ────────────────────────────────────────────────────────────────────── */

/** Book a personal-training session from the member's pack. b: { trainer_id, date, start, minutes? } */
export const bookPt = async (db, { businessId, branchId, memberId, b, userId = null, now = new Date() }) => {
  const trainerId = Number(b.trainer_id);
  const trainer = (await db.query(`SELECT * FROM gym_trainers WHERE trainer_id = $1 AND business_id = $2 AND is_active FOR UPDATE`, [trainerId, businessId])).rows[0];
  if (!trainer) throw bad('That trainer is not available');
  const member = await loadMember(db, businessId, memberId);
  if (!member || member.status === 'ARCHIVED') throw new GymError(404, 'Not found');
  if (member.status !== 'ACTIVE') throw new GymError(409, 'This account is not active');
  const date = isoDate(b.date, 'Date', { required: true }); const time = clock(b.start, 'Start time', { required: true });
  const minutes = b.minutes != null && b.minutes !== '' ? int(b.minutes, 'Length in minutes', { min: 15, max: 180 }) : 60;
  const starts = await localToInstant(db, businessId, date, time);
  const ends = new Date(new Date(starts).getTime() + minutes * 60000);
  if (new Date(starts) <= now) throw new GymError(409, 'That time has already passed');
  if (await trainerBusy(db, trainerId, starts, ends)) throw new GymError(409, 'The trainer is not free then');
  if (await memberBusy(db, businessId, memberId, starts, ends)) throw new GymError(409, 'They already have something booked at that time');
  const pack = await usablePack(db, businessId, memberId, 'PT_PACK', new Date(starts));
  if (!pack) throw new GymError(409, 'They need a personal-training pack with sessions left');
  const pt = (await db.query(
    `INSERT INTO gym_pt_sessions (business_id, branch_id, trainer_id, member_id, pack_id, starts_at, ends_at, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING pt_id`,
    [businessId, branchId, trainerId, memberId, pack.pack_id, starts, ends, text(b.notes, 'Notes', { max: 500 }), userId])).rows[0];
  await reserve(db, businessId, pack.pack_id, 'PT', pt.pt_id);
  return { pt_id: pt.pt_id, starts_at: starts, pack_id: pack.pack_id, sessions_left: pack.sessions_left - 1 };
};

export const cancelPt = async (db, { businessId, ptId, now = new Date() }) => {
  const pt = (await db.query(`SELECT * FROM gym_pt_sessions WHERE pt_id = $1 AND business_id = $2 FOR UPDATE`, [ptId, businessId])).rows[0];
  if (!pt) throw new GymError(404, 'Not found');
  if (pt.status !== 'SCHEDULED') throw new GymError(409, 'This session cannot be cancelled');
  const settings = await getSettings(db, businessId);
  const late = hoursUntil(pt.starts_at, now) < settings.pt_cancel_hours;
  await db.query(`UPDATE gym_pt_sessions SET status = 'CANCELLED' WHERE pt_id = $1`, [ptId]);
  await settleUsage(db, 'PT', ptId, late ? 'CONSUMED' : 'RELEASED');
  return { late_cancel: late };
};

export const finishPt = async (db, { businessId, ptId, status, now = new Date() }) => {
  if (!['COMPLETED', 'NO_SHOW'].includes(status)) throw bad('Mark the session as completed or no-show');
  const pt = (await db.query(`SELECT * FROM gym_pt_sessions WHERE pt_id = $1 AND business_id = $2 FOR UPDATE`, [ptId, businessId])).rows[0];
  if (!pt) throw new GymError(404, 'Not found');
  if (pt.status !== 'SCHEDULED') throw new GymError(409, 'This session is already closed');
  if (new Date(pt.starts_at) > new Date(now.getTime() + 15 * 60000)) throw new GymError(409, 'The session has not started yet');
  await db.query(`UPDATE gym_pt_sessions SET status = $2 WHERE pt_id = $1`, [ptId, status]);
  await settleUsage(db, 'PT', ptId, 'CONSUMED');
  return { status };
};

export const listPt = async (db, businessId, { from, to, trainerId = null, memberId = null, branchId = null }) => (await db.query(
  `SELECT p.pt_id, p.trainer_id, tr.name AS trainer_name, p.member_id, gm.member_code, c.name AS member_name, p.starts_at, p.ends_at, p.status, p.notes, p.branch_id
   FROM gym_pt_sessions p JOIN gym_trainers tr ON tr.trainer_id = p.trainer_id JOIN gym_members gm ON gm.member_id = p.member_id JOIN customers c ON c.customer_id = gm.customer_id
   WHERE p.business_id = $1 AND (p.starts_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date BETWEEN $2::date AND $3::date
     AND ($4::int IS NULL OR p.trainer_id = $4) AND ($5::int IS NULL OR p.member_id = $5) AND ($6::int IS NULL OR p.branch_id = $6) ORDER BY p.starts_at`,
  [businessId, from, to, trainerId, memberId, branchId])).rows;

/* ── trainers: workload and results ─────────────────────────────────────────────────────────── */

export const trainerReport = async (db, businessId, { from, to, branchId = null }) => (await db.query(
  `SELECT t.trainer_id, t.name,
     (SELECT COUNT(*)::int FROM gym_members m WHERE m.assigned_trainer_id = t.trainer_id AND m.status = 'ACTIVE') AS clients,
     COALESCE(cl.classes, 0) AS classes, COALESCE(cl.seats, 0) AS seats, COALESCE(cl.booked, 0) AS booked, COALESCE(cl.attended, 0) AS attended,
     COALESCE(pt.completed, 0) AS pt_completed, COALESCE(pt.no_show, 0) AS pt_no_show, COALESCE(pt.cancelled, 0) AS pt_cancelled
   FROM gym_trainers t
   LEFT JOIN LATERAL (SELECT COUNT(*)::int AS classes, SUM(s.capacity)::int AS seats,
        SUM((SELECT COUNT(*) FROM gym_class_bookings b WHERE b.session_id = s.session_id AND b.status IN ('BOOKED','ATTENDED','NO_SHOW')))::int AS booked,
        SUM((SELECT COUNT(*) FROM gym_class_bookings b WHERE b.session_id = s.session_id AND b.status = 'ATTENDED'))::int AS attended
      FROM gym_class_sessions s WHERE s.trainer_id = t.trainer_id AND s.status <> 'CANCELLED' AND ($4::int IS NULL OR s.branch_id = $4)
        AND (s.starts_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date BETWEEN $2::date AND $3::date) cl ON TRUE
   LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE p.status = 'COMPLETED')::int AS completed, COUNT(*) FILTER (WHERE p.status = 'NO_SHOW')::int AS no_show, COUNT(*) FILTER (WHERE p.status = 'CANCELLED')::int AS cancelled
      FROM gym_pt_sessions p WHERE p.trainer_id = t.trainer_id AND ($4::int IS NULL OR p.branch_id = $4)
        AND (p.starts_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date BETWEEN $2::date AND $3::date) pt ON TRUE
   WHERE t.business_id = $1 ORDER BY t.name`, [businessId, from, to, branchId])).rows.map((r) => ({ ...r, fill_rate: r.seats ? Math.round((r.booked / r.seats) * 100) : null, attendance_rate: r.booked ? Math.round((r.attended / r.booked) * 100) : null }));
