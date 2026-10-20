/*
 * Trainers, the class timetable and booking, class and personal-training packs, workout plans, goals and measurements, and who may see what.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, addPlan, day, fakeRes, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const classes = await import('../src/modules/gym/classes.js');
const training = await import('../src/modules/gym/training.js');
const api = (await import('../src/controllers/gymTraining.controller.js')).default;
const membersApi = (await import('../src/controllers/gymMembers.controller.js')).default;
const invoicesApi = await import('../src/controllers/invoices.controller.js');
const router = (await import('../src/routes/gym.routes.js')).default;
const { inTx } = await import('../src/modules/gym/common.js');

test.after(cleanup);

// Monday 7 December 2026, 11:30 in Kolkata: the "now" of the logic tests
const NOW = new Date('2026-12-07T06:00:00Z');
const MON = '2026-12-14';
const TODAY_DATE = '2026-12-07';
const ok = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };
const fails = (res, status) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body; };
const tx = (fn) => inTx(fn);
const running = (g, m, over = {}) => addMembership(pool, g, m, { start: '2026-11-01', end: '2027-02-28', ...over });
const trainerOf = (g, name = 'Coach', over = {}) => tx((db) => classes.saveTrainer(db, g.businessId, null, { name, ...over }));
const typeOf = (g, over = {}) => tx((db) => classes.saveClassType(db, g.businessId, null, { name: 'Yoga', duration_min: 60, default_capacity: 3, ...over }));
const sessionsOf = (g, over) => tx((db) => classes.createSessions(db, g.businessId, g.branchId, over));
const book = (g, sessionId, memberId, over = {}) => tx((db) => classes.bookClass(db, { businessId: g.businessId, sessionId, memberId, now: NOW, ...over }));
const status = async (bookingId) => (await pool.query(`SELECT status, late_cancel, pack_id FROM gym_class_bookings WHERE booking_id = $1`, [bookingId])).rows[0];

let A; let B;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'cls', { branches: 2 });
  B = await makeGym(pool, 'clsB');
});

/* ── trainers ─────────────────────────────────────────────────────────────── */

test('trainers: validated, linked to a staff login once, and scoped to the gym', { skip }, async () => {
  await assert.rejects(trainerOf(A, ''), (e) => e.status === 400);
  await assert.rejects(trainerOf(A, 'Bad branch', { branch_id: B.branchId }), (e) => e.status === 400);
  await assert.rejects(trainerOf(A, 'Stranger login', { user_id: B.userId }), (e) => e.status === 400, 'a login from another gym');
  const t = await trainerOf(A, 'Coach Meena', { phone: '9000000001', specialties: 'Yoga, mobility', user_id: A.userId });
  assert.equal(t.name, 'Coach Meena');
  await assert.rejects(trainerOf(A, 'Same login', { user_id: A.userId }), (e) => e.status === 409);
  const updated = await tx((db) => classes.saveTrainer(db, A.businessId, t.trainer_id, { bio: 'Ten years of coaching', is_active: true }));
  assert.equal(updated.bio, 'Ten years of coaching');
  assert.equal(updated.name, 'Coach Meena', 'what was not sent stays');
  await assert.rejects(tx((db) => classes.saveTrainer(db, B.businessId, t.trainer_id, { name: 'Taken' })), (e) => e.status === 404);
  const m = await addMember(pool, A, { name: 'Client' });
  await tx((db) => classes.assignTrainer(db, A.businessId, m, t.trainer_id));
  await assert.rejects(tx((db) => classes.assignTrainer(db, B.businessId, m, t.trainer_id)), (e) => e.status === 400 || e.status === 404);
  assert.equal((await classes.listTrainers(pool, A.businessId)).find((x) => x.trainer_id === t.trainer_id).clients, 1);
  assert.equal((await classes.listTrainers(pool, B.businessId)).length, 0);
});

/* ── the timetable ────────────────────────────────────────────────────────── */

test('a class is made for a date and a clock time in the gym\'s own zone, repeated weekly, all or nothing', { skip }, async () => {
  const t = await trainerOf(A, 'Timetable Coach');
  const yoga = await typeOf(A, { name: 'Yoga timetable', default_capacity: 10 });
  const [one] = await sessionsOf(A, { class_type_id: yoga.class_type_id, date: MON, start: '18:30', trainer_id: t.trainer_id });
  assert.equal(new Date(one.starts_at).toISOString(), '2026-12-14T13:00:00.000Z', '18:30 in Kolkata is 13:00 UTC');
  assert.equal(new Date(one.ends_at).toISOString(), '2026-12-14T14:00:00.000Z');
  assert.equal(one.capacity, 10, 'the usual capacity of that class');
  // a gym in New York: the same clock time is a different instant either side of the clocks changing
  const NY = await makeGym(pool, 'clsNY', { timezone: 'America/New_York' });
  const nyType = await typeOf(NY, { name: 'Spin' });
  const [before] = await tx((db) => classes.createSessions(db, NY.businessId, NY.branchId, { class_type_id: nyType.class_type_id, date: '2026-10-31', start: '18:00' }));
  const [after] = await tx((db) => classes.createSessions(db, NY.businessId, NY.branchId, { class_type_id: nyType.class_type_id, date: '2026-11-02', start: '18:00' }));
  assert.equal(new Date(before.starts_at).toISOString(), '2026-10-31T22:00:00.000Z', 'EDT, UTC-4');
  assert.equal(new Date(after.starts_at).toISOString(), '2026-11-02T23:00:00.000Z', 'EST, UTC-5');

  const weekly = await sessionsOf(A, { class_type_id: yoga.class_type_id, date: '2027-01-04', start: '07:00', weeks: 4 });
  assert.deepEqual(weekly.map((s) => new Date(s.starts_at).toISOString().slice(0, 10)), ['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25'], 'the same weekday and clock time each week');
  // a trainer cannot be in two places
  await assert.rejects(sessionsOf(A, { class_type_id: yoga.class_type_id, date: MON, start: '19:00', trainer_id: t.trainer_id }), (e) => e.status === 409);
  await sessionsOf(A, { class_type_id: yoga.class_type_id, date: MON, start: '19:30', trainer_id: t.trainer_id });
  const before2 = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_class_sessions WHERE business_id = $1`, [A.businessId])).rows[0].n;
  await assert.rejects(sessionsOf(A, { class_type_id: yoga.class_type_id, date: '2027-02-01', start: '19:30', weeks: 3, trainer_id: t.trainer_id }).then(() => sessionsOf(A, { class_type_id: yoga.class_type_id, date: '2027-02-08', start: '19:30', weeks: 2, trainer_id: t.trainer_id })), (e) => e.status === 409);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_class_sessions WHERE business_id = $1`, [A.businessId])).rows[0].n, before2 + 3, 'the repeat that clashed made nothing');
  for (const bad of [{ class_type_id: 999999, date: MON, start: '10:00' }, { class_type_id: yoga.class_type_id, date: 'soon', start: '10:00' }, { class_type_id: yoga.class_type_id, date: MON, start: '25:00' }, { class_type_id: yoga.class_type_id, date: MON, start: '10:00', weeks: 40 }, { class_type_id: yoga.class_type_id, date: MON, start: '10:00', capacity: 0 }, { class_type_id: yoga.class_type_id, date: MON, start: '10:00', trainer_id: 999999 }]) {
    await assert.rejects(sessionsOf(A, bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  const shown = await classes.listSessions(pool, A.businessId, { from: MON, to: MON });
  assert.ok(shown.length >= 2);
  assert.equal(shown[0].seats_left, shown[0].capacity);
});

/* ── booking ──────────────────────────────────────────────────────────────── */

test('who may book follows the door: membership, payment rule, branch and hours at the time of the class', { skip }, async () => {
  const yoga = await typeOf(A, { name: 'Eligibility yoga' });
  const [s18] = await sessionsOf(A, { class_type_id: yoga.class_type_id, date: MON, start: '18:00' });
  const [s11] = await sessionsOf(A, { class_type_id: yoga.class_type_id, date: MON, start: '11:00' });
  const good = await addMember(pool, A, { name: 'Good Standing' }); await running(A, good);
  assert.equal((await book(A, s18.session_id, good)).status, 'BOOKED');

  const none = await addMember(pool, A, { name: 'No Membership' });
  await assert.rejects(book(A, s18.session_id, none), (e) => e.status === 409 && e.code === 'NO_MEMBERSHIP');
  const lapsed = await addMember(pool, A, { name: 'Lapsed' }); await running(A, lapsed, { start: '2026-09-01', end: '2026-10-01' });
  await assert.rejects(book(A, s18.session_id, lapsed), (e) => e.code === 'MEMBERSHIP_EXPIRED');
  // a membership that ends before the class, though it is running today
  const ending = await addMember(pool, A, { name: 'Ends Before' }); await running(A, ending, { start: '2026-11-01', end: '2026-12-10' });
  await assert.rejects(book(A, s18.session_id, ending), (e) => e.code === 'MEMBERSHIP_EXPIRED', 'judged on the day of the class, not today');
  // an off-peak plan (until 16:00) and a class at 18:00
  const offPeak = await addMember(pool, A, { name: 'Off Peak' }); await running(A, offPeak, { window: { days: [1, 2, 3, 4, 5], from: '06:00', to: '16:00' } });
  await assert.rejects(book(A, s18.session_id, offPeak), (e) => e.code === 'ACCESS_OUTSIDE_ALLOWED_HOURS');
  assert.equal((await book(A, s11.session_id, offPeak)).status, 'BOOKED', 'but the 11:00 class is fine');
  // another branch's plan
  const other = await addMember(pool, A, { name: 'Other Branch' }); await running(A, other, { branches: [A.branchIds[1]] });
  await assert.rejects(book(A, s18.session_id, other), (e) => e.code === 'BRANCH_NOT_ALLOWED');
  // suspended
  const held = await addMember(pool, A, { name: 'On Hold', status: 'SUSPENDED' }); await running(A, held);
  await assert.rejects(book(A, s18.session_id, held), (e) => e.status === 409);
  // the gym is shut at that hour
  await pool.query(`INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token, hours) VALUES ($1,$2,'tok-cls-hours', $3::jsonb) ON CONFLICT (branch_id) DO UPDATE SET hours = $3::jsonb`, [A.branchId, A.businessId, JSON.stringify({ 1: { open: '06:00', close: '17:00' } })]);
  const late = await addMember(pool, A, { name: 'Late Class' }); await running(A, late);
  await assert.rejects(book(A, s18.session_id, late), (e) => e.code === 'ACCESS_OUTSIDE_ALLOWED_HOURS');
  await pool.query(`UPDATE gym_branch_settings SET hours = NULL WHERE branch_id = $1`, [A.branchId]);
  // unpaid with a policy that needs payment: the same answer as at the door
  const plan = await addPlan(pool, A, { name: 'Strict', price: 500, tax: 0 });
  const owes = await addMember(pool, A, { name: 'Owes' });
  const invoice = (await pool.query(`INSERT INTO invoices (business_id, branch_id, customer_id, invoice_number, total_paise, balance_due_paise, payment_status) SELECT $1, $2, customer_id, 'T-OWES', 50000, 50000, 'UNPAID' FROM gym_members WHERE member_id = $3 RETURNING invoice_id`, [A.businessId, A.branchId, owes])).rows[0].invoice_id;
  await running(A, owes, { invoiceId: invoice });
  await assert.rejects(book(A, s18.session_id, owes), (e) => e.code === 'PAYMENT_REQUIRES_ATTENTION');
  assert.ok(plan);
});

test('a place is taken once: twice is refused, overlapping classes are refused, the past and cancelled classes cannot be booked', { skip }, async () => {
  const t = await typeOf(A, { name: 'Once yoga' }); const t2 = await typeOf(A, { name: 'Overlap spin' });
  const [s] = await sessionsOf(A, { class_type_id: t.class_type_id, date: MON, start: '08:00' });
  const [overlap] = await sessionsOf(A, { class_type_id: t2.class_type_id, date: MON, start: '08:30' });
  const [past] = await sessionsOf(A, { class_type_id: t.class_type_id, date: '2026-12-01', start: '08:00' });
  const m = await addMember(pool, A, { name: 'Booker' }); await running(A, m);
  await book(A, s.session_id, m);
  await assert.rejects(book(A, s.session_id, m), (e) => e.status === 409 && /already booked/.test(e.message));
  await assert.rejects(book(A, overlap.session_id, m), (e) => e.status === 409 && /already have something/.test(e.message));
  await assert.rejects(book(A, past.session_id, m), (e) => e.status === 409);
  await tx((db) => classes.cancelSession(db, { businessId: A.businessId, sessionId: overlap.session_id, reason: 'Trainer ill' }));
  await assert.rejects(book(A, overlap.session_id, m), (e) => e.status === 409);
  await assert.rejects(book(B, s.session_id, m), (e) => e.status === 404, 'another gym cannot book into it');
  await assert.rejects(book(A, s.session_id, 999999), (e) => e.status === 404);
  // member bookings keep to the booking window; staff do not
  const far = (await sessionsOf(A, { class_type_id: t.class_type_id, date: '2027-02-15', start: '08:00' }))[0];
  const m2 = await addMember(pool, A, { name: 'Early Bird' }); await running(A, m2);
  await assert.rejects(book(A, far.session_id, m2, { source: 'MEMBER' }), (e) => e.status === 409 && /days ahead/.test(e.message));
  assert.equal((await book(A, far.session_id, m2, { source: 'STAFF' })).status, 'BOOKED');
});

test('a full class sends people to the waitlist, in order; a gym can turn the waitlist off', { skip }, async () => {
  const type = await typeOf(A, { name: 'Full class', default_capacity: 2 });
  const [s] = await sessionsOf(A, { class_type_id: type.class_type_id, date: MON, start: '06:00' });
  const people = [];
  for (let i = 0; i < 4; i++) { const m = await addMember(pool, A, { name: `Waiter ${i}` }); await running(A, m); people.push(m); }
  const results = [];
  for (const [i, m] of people.entries()) results.push(await book(A, s.session_id, m, { now: new Date(NOW.getTime() + i * 1000) }));
  assert.deepEqual(results.map((r) => r.status), ['BOOKED', 'BOOKED', 'WAITLISTED', 'WAITLISTED']);
  assert.deepEqual(results.map((r) => r.waitlist_position), [null, null, 1, 2]);
  const shown = (await classes.listSessions(pool, A.businessId, { from: MON, to: MON })).find((x) => x.session_id === s.session_id);
  assert.equal(shown.booked, 2); assert.equal(shown.waitlisted, 2); assert.equal(shown.seats_left, 0);
  await pool.query(`UPDATE gym_settings SET class_waitlist = FALSE WHERE business_id = $1`, [A.businessId]);
  const extra = await addMember(pool, A, { name: 'No List' }); await running(A, extra);
  await assert.rejects(book(A, s.session_id, extra), (e) => e.status === 409 && /full/.test(e.message));
  await pool.query(`UPDATE gym_settings SET class_waitlist = TRUE WHERE business_id = $1`, [A.businessId]);
});

test('ten people booking the last three places at once: exactly three are in, the rest wait, nobody is in twice', { skip }, async () => {
  const type = await typeOf(A, { name: 'Race class', default_capacity: 3 });
  const [s] = await sessionsOf(A, { class_type_id: type.class_type_id, date: MON, start: '05:30' });
  const people = [];
  for (let i = 0; i < 10; i++) { const m = await addMember(pool, A, { name: `Racer ${i}` }); await running(A, m); people.push(m); }
  const out = await Promise.all(people.map((m) => book(A, s.session_id, m)));
  assert.equal(out.filter((r) => r.status === 'BOOKED').length, 3);
  assert.equal(out.filter((r) => r.status === 'WAITLISTED').length, 7);
  const counts = (await pool.query(`SELECT status, COUNT(*)::int AS n FROM gym_class_bookings WHERE session_id = $1 GROUP BY status`, [s.session_id])).rows;
  assert.deepEqual(Object.fromEntries(counts.map((c) => [c.status, c.n])), { BOOKED: 3, WAITLISTED: 7 });
  // one person tapping twice at once
  const tapper = await addMember(pool, A, { name: 'Double Tap' }); await running(A, tapper);
  const [other] = await sessionsOf(A, { class_type_id: type.class_type_id, date: MON, start: '15:00' });
  const taps = await Promise.allSettled([book(A, other.session_id, tapper), book(A, other.session_id, tapper)]);
  assert.equal(taps.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_class_bookings WHERE session_id = $1 AND member_id = $2`, [other.session_id, tapper])).rows[0].n, 1);
});

test('a cancelled seat goes to the first person waiting who can still come; cancelling late is marked; a whole class can be cancelled', { skip }, async () => {
  const type = await typeOf(A, { name: 'Promotion class', default_capacity: 1 });
  const [s] = await sessionsOf(A, { class_type_id: type.class_type_id, date: '2026-12-08', start: '06:00' });
  const mk = async (name, over) => { const m = await addMember(pool, A, { name }); await running(A, m, over); return m; };
  const first = await mk('First'); const expired = await mk('Expires Meanwhile'); const next = await mk('Next In Line');
  const b1 = await book(A, s.session_id, first);
  const b2 = await book(A, s.session_id, expired, { now: new Date(NOW.getTime() + 1000) });
  const b3 = await book(A, s.session_id, next, { now: new Date(NOW.getTime() + 2000) });
  assert.deepEqual([b1.status, b2.status, b3.status], ['BOOKED', 'WAITLISTED', 'WAITLISTED']);
  // the second person's membership ends before the class while they wait
  await pool.query(`UPDATE gym_memberships SET end_date = '2026-12-07' WHERE member_id = $1`, [expired]);
  // class is at 06:00 IST on the 8th = 00:30 UTC; now is 06:00 UTC on the 7th: 18.5 hours ahead, outside the 4 hour window
  const early = await tx((db) => classes.cancelBooking(db, { businessId: A.businessId, bookingId: b1.booking_id, now: NOW }));
  assert.equal(early.late_cancel, false);
  assert.deepEqual(early.promoted.map((p) => p.member_id), [next], 'the second in line could no longer come, so the third took the place');
  assert.equal((await status(b3.booking_id)).status, 'BOOKED');
  assert.equal((await status(b2.booking_id)).status, 'WAITLISTED', 'and stays on the list');
  // a late cancellation
  const late = await tx((db) => classes.cancelBooking(db, { businessId: A.businessId, bookingId: b3.booking_id, now: new Date('2026-12-08T00:00:00Z') }));
  assert.equal(late.late_cancel, true);
  assert.equal((await status(b3.booking_id)).late_cancel, true);
  await assert.rejects(tx((db) => classes.cancelBooking(db, { businessId: A.businessId, bookingId: b3.booking_id, now: NOW })), (e) => e.status === 409, 'twice');
  // cancelling the whole class lets everyone off
  const type2 = await typeOf(A, { name: 'Cancelled class', default_capacity: 5 });
  const [c] = await sessionsOf(A, { class_type_id: type2.class_type_id, date: MON, start: '12:00' });
  const a = await mk('Cancelled A'); const b = await mk('Cancelled B');
  await book(A, c.session_id, a); await book(A, c.session_id, b);
  const gone = await tx((db) => classes.cancelSession(db, { businessId: A.businessId, sessionId: c.session_id, reason: 'The trainer is ill' }));
  assert.equal(gone.cancelled, 2);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_class_bookings WHERE session_id = $1 AND status = 'CANCELLED' AND late_cancel = FALSE`, [c.session_id])).rows[0].n, 2);
  await assert.rejects(tx((db) => classes.cancelSession(db, { businessId: B.businessId, sessionId: c.session_id, reason: 'x' })), (e) => e.status === 404);
});

test('after a class: attended or no-show, only once it has started', { skip }, async () => {
  const type = await typeOf(A, { name: 'Attendance class', default_capacity: 5 });
  const [s] = await sessionsOf(A, { class_type_id: type.class_type_id, date: '2026-12-08', start: '06:00' });
  const m = await addMember(pool, A, { name: 'Came' }); await running(A, m);
  const b = await book(A, s.session_id, m);
  await assert.rejects(tx((db) => classes.markAttendance(db, { businessId: A.businessId, bookingId: b.booking_id, status: 'ATTENDED', now: NOW })), (e) => e.status === 409, 'not started');
  const after = new Date('2026-12-08T01:00:00Z');
  assert.equal((await tx((db) => classes.markAttendance(db, { businessId: A.businessId, bookingId: b.booking_id, status: 'ATTENDED', now: after }))).status, 'ATTENDED');
  assert.equal((await tx((db) => classes.markAttendance(db, { businessId: A.businessId, bookingId: b.booking_id, status: 'NO_SHOW', now: after }))).status, 'NO_SHOW', 'a correction');
  await assert.rejects(tx((db) => classes.markAttendance(db, { businessId: A.businessId, bookingId: b.booking_id, status: 'LATE', now: after })), (e) => e.status === 400);
  await assert.rejects(tx((db) => classes.markAttendance(db, { businessId: B.businessId, bookingId: b.booking_id, status: 'ATTENDED', now: after })), (e) => e.status === 404);
});

/* ── packs ────────────────────────────────────────────────────────────────── */

const packFixture = async (g, { sessions = 3, kind = 'CLASS_PACK', price = 1000, policy = 'FULL_REQUIRED', duration = 90 } = {}) => {
  const planId = (await pool.query(
    `INSERT INTO gym_plans (business_id, name, kind, duration_days, price_paise, tax_rate, sessions, payment_policy) VALUES ($1,$2,$3,$4,$5,0,$6,$7) RETURNING plan_id`,
    [g.businessId, `${kind} ${sessions}`, kind, duration, price * 100, sessions, policy])).rows[0].plan_id;
  return planId;
};
const sellPack = (g, member, planId, over = {}) => tx((db) => classes.sellPack(db, g.tenantFor('OWNER'), g.userId, member, { plan_id: planId, payment: { method: 'CASH', amount: 'FULL' }, start_date: TODAY_DATE, ...over }, { allowDiscount: true, allowComplimentary: true }));

test('a class that is sold separately takes a session from a pack: reserved, returned, kept, and never more than the pack holds', { skip }, async () => {
  const paid = await packFixture(A, { sessions: 3 });
  const type = await typeOf(A, { name: 'Paid masterclass', default_capacity: 10, requires_pack: true });
  const sess = [];
  for (const [i, d] of ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17'].entries()) sess.push((await sessionsOf(A, { class_type_id: type.class_type_id, date: d, start: '10:00' }))[0]);
  const m = await addMember(pool, A, { name: 'Pack Holder' });   // no gym membership at all: a class-only member
  await assert.rejects(book(A, sess[0].session_id, m), (e) => e.status === 409 && /class pack/.test(e.message));
  const sold = await sellPack(A, m, paid);
  assert.equal(sold.sessions, 3);
  assert.equal(sold.invoice.payment_status, 'PAID');
  const b1 = await book(A, sess[0].session_id, m); const b2 = await book(A, sess[1].session_id, m); const b3 = await book(A, sess[2].session_id, m);
  assert.equal((await classes.listPacks(pool, A.businessId, m))[0].sessions_left, 0);
  await assert.rejects(book(A, sess[3].session_id, m), (e) => e.status === 409 && /class pack/.test(e.message), 'the pack is used up');
  // in-time cancellation returns the session; the late one keeps it
  const back = await tx((db) => classes.cancelBooking(db, { businessId: A.businessId, bookingId: b1.booking_id, now: NOW }));
  assert.equal(back.late_cancel, false);
  assert.equal((await classes.listPacks(pool, A.businessId, m))[0].sessions_left, 1, 'returned');
  const lateOne = await tx((db) => classes.cancelBooking(db, { businessId: A.businessId, bookingId: b2.booking_id, now: new Date('2026-12-15T04:00:00Z') }));
  assert.equal(lateOne.late_cancel, true);
  assert.equal((await classes.listPacks(pool, A.businessId, m))[0].sessions_left, 1, 'kept: cancelled too late');
  // a no-show keeps it; attending keeps it
  await tx((db) => classes.markAttendance(db, { businessId: A.businessId, bookingId: b3.booking_id, status: 'NO_SHOW', now: new Date('2026-12-16T06:00:00Z') }));
  const p = (await classes.listPacks(pool, A.businessId, m))[0];
  assert.equal(p.sessions_left, 1);
  assert.equal(p.sessions_used, 2, 'one late cancellation and one no-show');
  assert.equal((await book(A, sess[3].session_id, m)).status, 'BOOKED', 'the one session left');
  const usage = (await pool.query(`SELECT status, COUNT(*)::int AS n FROM gym_pack_usage WHERE pack_id = $1 GROUP BY status`, [p.pack_id])).rows;
  assert.deepEqual(Object.fromEntries(usage.map((u) => [u.status, u.n])), { RELEASED: 1, CONSUMED: 2, RESERVED: 1 });
});

test('a pack is only usable inside its dates and once it is paid for, and a refund ends it with everything booked on it', { skip }, async () => {
  const planId = await packFixture(A, { sessions: 4, duration: 10 });
  const type = await typeOf(A, { name: 'Pack-only class', default_capacity: 10, requires_pack: true });
  const [soon] = await sessionsOf(A, { class_type_id: type.class_type_id, date: '2026-12-10', start: '09:00' });
  const [later] = await sessionsOf(A, { class_type_id: type.class_type_id, date: '2026-12-30', start: '09:00' });
  const m = await addMember(pool, A, { name: 'Dated Pack' });
  const sold = await sellPack(A, m, planId, { payment: undefined });
  await assert.rejects(book(A, soon.session_id, m), (e) => e.status === 409, 'unpaid: not usable');
  const t = A.tenantFor('OWNER');
  ok(await A.call(invoicesApi.addPayment, { params: { id: sold.invoice.invoice_id }, body: { amount: 1000, method: 'CASH' } }, t), 201);
  assert.equal((await book(A, soon.session_id, m)).status, 'BOOKED', 'paid');
  await assert.rejects(book(A, later.session_id, m), (e) => e.status === 409, 'after the pack has run out of days');
  const refund = await A.call(invoicesApi.cancel, { params: { id: sold.invoice.invoice_id }, body: { reason: 'Changed mind' } }, t);
  assert.equal(refund.code, 200, JSON.stringify(refund.body));
  assert.equal((await pool.query(`SELECT status FROM gym_packs WHERE pack_id = $1`, [sold.pack_id])).rows[0].status, 'CANCELLED');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_class_bookings WHERE member_id = $1 AND status = 'BOOKED'`, [m])).rows[0].n, 0, 'its bookings are cancelled');
});

test('two bookings racing for the last session of a pack: one wins', { skip }, async () => {
  const planId = await packFixture(A, { sessions: 1 });
  const type = await typeOf(A, { name: 'Race pack class', default_capacity: 10, requires_pack: true });
  const [x] = await sessionsOf(A, { class_type_id: type.class_type_id, date: '2026-12-21', start: '09:00' });
  const [y] = await sessionsOf(A, { class_type_id: type.class_type_id, date: '2026-12-22', start: '09:00' });
  const m = await addMember(pool, A, { name: 'Last Session' });
  await sellPack(A, m, planId);
  const out = await Promise.allSettled([book(A, x.session_id, m), book(A, y.session_id, m)]);
  assert.equal(out.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal((await classes.listPacks(pool, A.businessId, m))[0].sessions_left, 0);
});

/* ── personal training ────────────────────────────────────────────────────── */

test('personal training: a pack, a free trainer, a free member, the right cancellation rules', { skip }, async () => {
  const planId = await packFixture(A, { sessions: 2, kind: 'PT_PACK', price: 4000, duration: 60 });
  const coach = await trainerOf(A, 'PT Coach');
  const m = await addMember(pool, A, { name: 'PT Client' });
  const pt = (b, now = NOW, member = m) => tx((db) => classes.bookPt(db, { businessId: A.businessId, branchId: A.branchId, memberId: member, b: { trainer_id: coach.trainer_id, minutes: 60, ...b }, now }));
  await assert.rejects(pt({ date: MON, start: '07:00' }), (e) => e.status === 409 && /pack/.test(e.message));
  await sellPack(A, m, planId);
  const one = await pt({ date: MON, start: '07:00' });
  assert.equal(one.sessions_left, 1);
  await assert.rejects(pt({ date: MON, start: '07:30' }), (e) => e.status === 409 && /not free/.test(e.message), 'the trainer is busy');
  const other = await addMember(pool, A, { name: 'Other PT Client' });
  await sellPack(A, other, packFixture ? await packFixture(A, { sessions: 1, kind: 'PT_PACK', price: 2000 }) : 0);
  await assert.rejects(pt({ date: MON, start: '07:30' }, NOW, other), (e) => e.status === 409);
  const second = await pt({ date: MON, start: '09:00' });
  assert.equal(second.sessions_left, 0);
  await assert.rejects(pt({ date: '2026-12-15', start: '09:00' }), (e) => e.status === 409, 'the pack is used up');
  await assert.rejects(pt({ date: '2026-12-01', start: '09:00' }, NOW, other), (e) => e.status === 409 && /passed/.test(e.message));
  await assert.rejects(tx((db) => classes.bookPt(db, { businessId: A.businessId, branchId: A.branchId, memberId: m, b: { trainer_id: 999999, date: MON, start: '12:00' }, now: NOW })), (e) => e.status === 400);

  // cancelling in time gives the session back and frees the trainer; cancelling late keeps it
  const early = await tx((db) => classes.cancelPt(db, { businessId: A.businessId, ptId: one.pt_id, now: NOW }));
  assert.equal(early.late_cancel, false);
  assert.equal((await classes.listPacks(pool, A.businessId, m))[0].sessions_left, 1);
  assert.equal((await pt({ date: MON, start: '07:00' }, NOW, other)).sessions_left, 0, 'the trainer is free again');
  const lateCancel = await tx((db) => classes.cancelPt(db, { businessId: A.businessId, ptId: second.pt_id, now: new Date('2026-12-14T00:00:00Z') }));
  assert.equal(lateCancel.late_cancel, true);
  assert.equal((await classes.listPacks(pool, A.businessId, m))[0].sessions_left, 1, 'cancelled with less than 12 hours notice: kept');
  // closing a session
  const third = await pt({ date: '2026-12-16', start: '10:00' });
  await assert.rejects(tx((db) => classes.finishPt(db, { businessId: A.businessId, ptId: third.pt_id, status: 'COMPLETED', now: NOW })), (e) => e.status === 409, 'not started');
  assert.equal((await tx((db) => classes.finishPt(db, { businessId: A.businessId, ptId: third.pt_id, status: 'NO_SHOW', now: new Date('2026-12-16T06:00:00Z') }))).status, 'NO_SHOW');
  await assert.rejects(tx((db) => classes.finishPt(db, { businessId: A.businessId, ptId: third.pt_id, status: 'COMPLETED', now: new Date('2026-12-16T06:00:00Z') })), (e) => e.status === 409, 'closed');
  await assert.rejects(tx((db) => classes.cancelPt(db, { businessId: B.businessId, ptId: third.pt_id })), (e) => e.status === 404);
  const list = await classes.listPt(pool, A.businessId, { from: MON, to: '2026-12-20', trainerId: coach.trainer_id });
  assert.ok(list.length >= 3);
});

test('the trainer report counts classes, seats, attendance and one-to-one sessions', { skip }, async () => {
  const G = await makeGym(pool, 'rep');
  const coach = await trainerOf(G, 'Reported Coach'); const idle = await trainerOf(G, 'Idle Coach');
  const type = await typeOf(G, { name: 'Report class', default_capacity: 4 });
  const [s1, s2] = [await sessionsOf(G, { class_type_id: type.class_type_id, date: '2026-12-08', start: '06:00', trainer_id: coach.trainer_id }), await sessionsOf(G, { class_type_id: type.class_type_id, date: '2026-12-09', start: '06:00', trainer_id: coach.trainer_id })].map((x) => x[0]);
  const members = [];
  for (let i = 0; i < 3; i++) { const m = await addMember(pool, G, { name: `R${i}` }); await running(G, m); members.push(m); }
  const bks = [];
  for (const m of members) bks.push(await book(G, s1.session_id, m));
  await book(G, s2.session_id, members[0]);
  const after = new Date('2026-12-08T01:00:00Z');
  await tx((db) => classes.markAttendance(db, { businessId: G.businessId, bookingId: bks[0].booking_id, status: 'ATTENDED', now: after }));
  await tx((db) => classes.markAttendance(db, { businessId: G.businessId, bookingId: bks[1].booking_id, status: 'ATTENDED', now: after }));
  await tx((db) => classes.markAttendance(db, { businessId: G.businessId, bookingId: bks[2].booking_id, status: 'NO_SHOW', now: after }));
  await tx((db) => classes.assignTrainer(db, G.businessId, members[0], coach.trainer_id));
  const r = await classes.trainerReport(pool, G.businessId, { from: '2026-12-01', to: '2026-12-31' });
  const c = r.find((x) => x.name === 'Reported Coach');
  assert.deepEqual({ classes: c.classes, seats: c.seats, booked: c.booked, attended: c.attended, clients: c.clients }, { classes: 2, seats: 8, booked: 4, attended: 2, clients: 1 });
  assert.equal(c.fill_rate, 50);
  assert.equal(c.attendance_rate, 50);
  assert.equal(r.find((x) => x.name === 'Idle Coach').classes, 0);
  assert.equal(idle.trainer_id > 0, true);
});

/* ── training records ─────────────────────────────────────────────────────── */

test('exercises, workout plans (made, copied from a template, changed) and their checks', { skip }, async () => {
  const sq = await tx((db) => training.saveExercise(db, A.businessId, null, { name: 'Back squat', muscle_group: 'Legs', equipment: 'Barbell' }));
  await assert.rejects(tx((db) => training.saveExercise(db, A.businessId, null, { name: 'back SQUAT' })), (e) => e.status === 409, 'names are unique, whatever the case');
  await assert.rejects(tx((db) => training.saveExercise(db, A.businessId, null, { name: '' })), (e) => e.status === 400);
  assert.equal((await training.listExercises(pool, A.businessId, { q: 'legs' })).length, 1);
  assert.equal((await training.listExercises(pool, A.businessId, { q: '%' })).length, 0, 'a percent sign is searched for, not "everything"');
  assert.equal((await training.listExercises(pool, B.businessId, {})).length, 0);
  const m = await addMember(pool, A, { name: 'Lifter' });
  const make = (b) => tx((db) => training.createWorkout(db, { businessId: A.businessId, memberId: m, userId: A.userId, b }));
  await assert.rejects(make({ name: 'Empty', items: [] }), (e) => e.status === 400);
  await assert.rejects(make({ name: 'Bad day', items: [{ exercise_name: 'X', day_no: 20 }] }), (e) => e.status === 400);
  await assert.rejects(make({ name: 'Stranger exercise', items: [{ exercise_id: 999999, sets: 3 }] }), (e) => e.status === 400);
  await assert.rejects(make({ name: 'No name', items: [{ sets: 3 }] }), (e) => e.status === 400);
  await assert.rejects(make({ name: '', items: [{ exercise_name: 'X' }] }), (e) => e.status === 400);
  const wid = await make({ name: 'Strength A', goal: 'Get stronger', items: [{ exercise_id: sq.exercise_id, sets: 5, reps: '5', rest_seconds: 180, weight_kg: 60 }, { exercise_name: 'Plank', day_no: 2, sets: 3, reps: '60s' }] });
  const [plan] = await training.listWorkouts(pool, A.businessId, { memberId: m });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].exercise_name, 'Back squat', 'the name comes from the library');
  assert.equal(plan.items[0].weight_kg, 60);
  await tx((db) => training.updateWorkout(db, { businessId: A.businessId, workoutId: wid, b: { name: 'Strength A v2', items: [{ exercise_name: 'Deadlift', sets: 3, reps: '5' }] } }));
  const [v2] = await training.listWorkouts(pool, A.businessId, { memberId: m });
  assert.deepEqual([v2.name, v2.items.length, v2.items[0].exercise_name], ['Strength A v2', 1, 'Deadlift']);
  // a template copies onto a member; changing the member's copy leaves the template alone
  const tmpl = await tx((db) => training.createWorkout(db, { businessId: A.businessId, userId: A.userId, b: { name: 'Beginner full body', items: [{ exercise_name: 'Goblet squat', sets: 3, reps: '10' }, { exercise_name: 'Push-up', sets: 3, reps: '8' }] } }));
  const m2 = await addMember(pool, A, { name: 'Beginner' });
  const copy = await tx((db) => training.assignTemplate(db, { businessId: A.businessId, templateId: tmpl, memberId: m2, userId: A.userId }));
  await tx((db) => training.updateWorkout(db, { businessId: A.businessId, workoutId: copy, b: { items: [{ exercise_name: 'Walk', sets: 1, reps: '30 min' }] } }));
  assert.equal((await training.listWorkouts(pool, A.businessId, { templates: true })).find((t) => t.workout_id === tmpl).items.length, 2);
  await assert.rejects(tx((db) => training.assignTemplate(db, { businessId: B.businessId, templateId: tmpl, memberId: m2, userId: B.userId })), (e) => e.status === 404);
  await assert.rejects(tx((db) => training.updateWorkout(db, { businessId: B.businessId, workoutId: wid, b: { name: 'x' } })), (e) => e.status === 404);
});

test('goals and measurements: validated, and progress is how far the number has moved', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Progress' });
  const add = (b) => tx((db) => training.addMeasurement(db, { businessId: A.businessId, memberId: m, userId: A.userId, b }));
  await assert.rejects(add({ measured_on: '2026-12-01' }), (e) => e.status === 400, 'nothing measured');
  await assert.rejects(add({ measured_on: '2026-12-01', weight_kg: 5 }), (e) => e.status === 400);
  await assert.rejects(add({ measured_on: '2026-12-01', body_fat_pct: 95 }), (e) => e.status === 400);
  await assert.rejects(add({ weight_kg: 80 }), (e) => e.status === 400, 'a date is needed');
  await add({ measured_on: '2026-10-01', weight_kg: 90, waist_cm: 100 });
  await add({ measured_on: '2026-11-01', weight_kg: 86.5 });
  await add({ measured_on: '2026-12-01', weight_kg: 84, waist_cm: 94 });
  const goal = await tx((db) => training.addGoal(db, { businessId: A.businessId, memberId: m, userId: A.userId, b: { description: 'Get to 80 kg', metric: 'WEIGHT_KG', target_value: 80, target_date: '2027-03-01' } }));
  await tx((db) => training.addGoal(db, { businessId: A.businessId, memberId: m, userId: A.userId, b: { description: 'Run a 10k' } }));
  await assert.rejects(tx((db) => training.addGoal(db, { businessId: A.businessId, memberId: m, userId: A.userId, b: { description: '' } })), (e) => e.status === 400);
  await assert.rejects(tx((db) => training.addGoal(db, { businessId: A.businessId, memberId: m, userId: A.userId, b: { description: 'x', metric: 'HAPPINESS' } })), (e) => e.status === 400);
  const p = await training.progress(pool, A.businessId, m);
  const g = p.goals.find((x) => x.goal_id === goal.goal_id);
  assert.deepEqual([g.start_value, g.current_value, g.moved], [90, 84, -6]);
  assert.equal(p.measurements[0].measured_on, '2026-12-01', 'newest first');
  assert.equal((await tx((db) => training.setGoalStatus(db, { businessId: A.businessId, goalId: goal.goal_id, memberId: m, status: 'ACHIEVED' }))).status, 'ACHIEVED');
  await assert.rejects(tx((db) => training.setGoalStatus(db, { businessId: B.businessId, goalId: goal.goal_id, memberId: m, status: 'DROPPED' })), (e) => e.status === 404);
  await assert.rejects(tx((db) => training.setGoalStatus(db, { businessId: A.businessId, goalId: goal.goal_id, memberId: m, status: 'FORGOTTEN' })), (e) => e.status === 400);
});

/* ── privacy ──────────────────────────────────────────────────────────────── */

const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
const gate = async (method, path, t) => {
  const route = routes.find((r) => r.method === method && r.path === path);
  assert.ok(route, `${method} ${path}`);
  for (const mw of route.stack.slice(2, -1)) { const res = fakeRes(); let passed = false; await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined }, res, () => { passed = true; }); if (!passed) return res.code; }
  return 200;
};

test('a trainer sees only the members assigned to them and not their phone; the desk cannot read health records', { skip }, async () => {
  const G = await makeGym(pool, 'priv');
  const mkUser = async (name) => {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name.replace(/\W/g, '')}@priv.test`])).rows[0].user_id;
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'TRAINER','ACTIVE')`, [G.businessId, u]);
    return u;
  };
  const u1 = await mkUser('Trainer One'); const u2 = await mkUser('Trainer Two');
  const t1 = await trainerOf(G, 'Trainer One', { user_id: u1 }); const t2 = await trainerOf(G, 'Trainer Two', { user_id: u2 });
  const mine = await addMember(pool, G, { name: 'My Client', phone: '9111100001' }); const theirs = await addMember(pool, G, { name: 'Their Client', phone: '9111100002' }); const nobody = await addMember(pool, G, { name: 'Unassigned', phone: '9111100003' });
  await pool.query(`UPDATE gym_members SET assigned_trainer_id = $2 WHERE member_id = $1`, [mine, t1.trainer_id]);
  await pool.query(`UPDATE gym_members SET assigned_trainer_id = $2 WHERE member_id = $1`, [theirs, t2.trainer_id]);
  await tx((db) => training.addMeasurement(db, { businessId: G.businessId, memberId: mine, userId: G.userId, b: { measured_on: '2026-12-01', weight_kg: 70 } }));
  const trainer1 = { ...G.tenantFor('TRAINER'), userId: u1 };
  const list = await G.call(membersApi.list, { query: { limit: 50 } }, trainer1);
  assert.deepEqual(list.body.data.map((x) => x.name), ['My Client'], 'only theirs');
  assert.equal(list.body.data[0].phone, null, 'and not their phone');
  const detail = ok(await G.call(membersApi.get, { params: { id: mine } }, trainer1));
  assert.equal(detail.phone, null); assert.equal(detail.email, null);
  fails(await G.call(membersApi.get, { params: { id: theirs } }, trainer1), 404);
  fails(await G.call(membersApi.get, { params: { id: nobody } }, trainer1), 404);
  assert.equal(ok(await G.call(api.progress, { params: { id: mine } }, trainer1)).measurements.length, 1);
  fails(await G.call(api.progress, { params: { id: theirs } }, trainer1), 404);
  fails(await G.call(api.measurementAdd, { params: { id: nobody }, body: { measured_on: '2026-12-02', weight_kg: 60 } }, trainer1), 404);
  fails(await G.call(api.memberWorkouts, { params: { id: theirs } }, trainer1), 404);
  // the desk (and a manager at the desk) see everyone, with phones
  const desk = G.tenantFor('GYM_RECEPTIONIST');
  assert.equal(ok(await G.call(membersApi.list, { query: { limit: 50 } }, desk)).length, 3);
  assert.equal(await gate('GET', '/members/:id/progress', desk), 403);
  assert.equal(await gate('GET', '/members/:id/workouts', desk), 403);
  assert.equal(await gate('POST', '/members/:id/measurements', desk), 403);
  assert.equal(await gate('GET', '/members/:id/progress', G.tenantFor('TRAINER')), 200);
  assert.equal(await gate('GET', '/members/:id/progress', G.tenantFor('OWNER')), 200);
  assert.equal(await gate('POST', '/classes', G.tenantFor('TRAINER')), 403, 'a trainer does not schedule classes');
  assert.equal(await gate('POST', '/classes/:id/book', G.tenantFor('TRAINER')), 403);
  assert.equal(await gate('POST', '/classes/:id/book', desk), 200);
  assert.equal(await gate('POST', '/trainers', desk), 403);
  assert.equal(await gate('GET', '/classes', G.tenantFor('OWNER', { planFeatures: { gym_classes: false } })), 402);
  assert.equal(await gate('POST', '/pt/:id/finish', G.tenantFor('TRAINER')), 200, 'a trainer closes their own session');
  // a trainer sees only their own one-to-one sessions
  const own = ok(await G.call(api.ptList, { query: {} }, trainer1));
  assert.ok(Array.isArray(own));
  // the owner can see another gym's nothing
  fails(await B.call(api.progress, { params: { id: mine } }, B.tenantFor('OWNER')), 404);
  fails(await B.call(api.packs, { params: { id: mine } }, B.tenantFor('OWNER')), 404);
  fails(await B.call(api.book, { params: { id: 1 }, body: { member_id: mine } }, B.tenantFor('OWNER')), 404);
});

test('through the controllers: schedule, book, cancel and mark, with permissions and tenant checks', { skip }, async () => {
  const G = await makeGym(pool, 'ctl');
  const owner = G.tenantFor('OWNER'); const desk = G.tenantFor('GYM_RECEPTIONIST');
  const t = ok(await G.call(api.trainerSave, { body: { name: 'Ctl Coach' } }, owner), 201);
  const type = ok(await G.call(api.classTypeSave, { body: { name: 'Ctl Class', default_capacity: 2 } }, owner), 201);
  const date = new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-CA');
  const made = ok(await G.call(api.sessionCreate, { body: { class_type_id: type.class_type_id, date, start: '10:00', trainer_id: t.trainer_id, weeks: 2 } }, owner), 201);
  assert.equal(made.length, 2);
  const m = await addMember(pool, G, { name: 'Ctl Member' });
  await addMembership(pool, G, m, { start: day(date, -30), end: day(date, 60) });
  const booked = ok(await G.call(api.book, { params: { id: made[0].session_id }, body: { member_id: m } }, desk), 201);
  assert.equal(booked.status, 'BOOKED');
  fails(await G.call(api.book, { params: { id: made[0].session_id }, body: { member_id: m } }, desk), 409);
  assert.equal(ok(await G.call(api.bookings, { params: { id: made[0].session_id } }, desk))[0].member_name, 'Ctl Member');
  const shown = ok(await G.call(api.sessions, { query: { from: date, to: day(date, 8) } }, desk));
  assert.equal(shown.length, 2);
  assert.equal(shown[0].booked, 1);
  const cancelled = ok(await G.call(api.cancelBooking, { params: { id: booked.booking_id } }, desk));
  assert.equal(cancelled.late_cancel, false);
  ok(await G.call(api.sessionCancel, { params: { id: made[1].session_id }, body: { reason: 'Holiday' } }, owner));
  fails(await G.call(api.sessionCancel, { params: { id: made[1].session_id }, body: { reason: 'again' } }, owner), 409);
  fails(await B.call(api.sessionCancel, { params: { id: made[0].session_id }, body: {} }, B.tenantFor('OWNER')), 404);
  fails(await B.call(api.bookings, { params: { id: made[0].session_id } }, B.tenantFor('OWNER')), 404);
  fails(await B.call(api.cancelBooking, { params: { id: booked.booking_id } }, B.tenantFor('OWNER')), 404);
  fails(await G.call(api.attend, { params: { id: booked.booking_id }, body: { status: 'ATTENDED' } }, owner), 409);
  void membersApi;
});
