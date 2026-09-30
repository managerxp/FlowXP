/*
 * Appointments: booking, moving, cancelling, no-shows, walk-ins, free slots, and above all that one person is
 * never booked twice at once — including when two people book the last slot at the same instant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addClient, addService, addStaff, fakeRes, makeSalon, sell } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const appts = (await import('../src/controllers/salonAppointments.controller.js')).default;
const staffApi = (await import('../src/controllers/salonStaff.controller.js')).default;
const { createSalonInvoice } = await import('../src/modules/salon/pos.js');
const { fromLocal, localParts, freeSlots, workWindow, toClock } = await import('../src/modules/salon/schedule.js');
const invoices = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

const TZ = 'Asia/Kolkata';
let S; let ravi; let meena; let haircut; let facial; let asha; let date; let sunday;

/* the next date (at least a week away) that falls on an ISO weekday, in the salon's own calendar */
const nextDay = (isoDay) => {
  for (let n = 7; n < 21; n++) {
    const d = new Date(Date.now() + n * 86400000);
    const p = localParts(d, TZ);
    if (p.isoDay === isoDay) return p.date;
  }
  throw new Error('no such day');
};
const at = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return fromLocal(day, h * 60 + m, TZ).toISOString(); };
const book = (body, tenant) => S.call(appts.create, { body }, tenant);
const one = (start, staff, service = haircut, extra = {}) => ({ customer_id: asha, start_at: at(date, start), services: [{ service_id: service, staff_id: staff }], ...extra });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeSalon(pool, 'appt', { branches: 2 });
  await pool.query(`UPDATE salon_settings SET open_time = '09:00', close_time = '21:00', working_days = '[1,2,3,4,5,6]' WHERE business_id = $1`, [S.businessId]);
  ravi = await addStaff(pool, S, { name: 'Ravi' });
  meena = await addStaff(pool, S, { name: 'Meena' });
  haircut = await addService(pool, S, { name: 'Haircut', price: 500, duration: 30 });
  facial = await addService(pool, S, { name: 'Facial', price: 1000, duration: 60 });
  asha = await addClient(pool, S, 'Asha', '9876500001');
  date = nextDay(3);      // a Wednesday
  sunday = nextDay(7);    // the salon is closed
});

test('the time helpers read clock time in the salon\'s own zone', { skip }, async () => {
  assert.deepEqual(localParts(new Date('2026-10-05T04:30:00Z'), TZ), { date: '2026-10-05', minutes: 10 * 60, isoDay: 1 });
  assert.equal(fromLocal('2026-10-05', 10 * 60, TZ).toISOString(), '2026-10-05T04:30:00.000Z');
  assert.equal(localParts(new Date('2026-10-05T19:00:00Z'), TZ).date, '2026-10-06', 'late evening UTC is already tomorrow in India');
  assert.equal(toClock(605), '10:05');
  const outlet = { working_days: [1, 2, 3], open_time: '09:00', close_time: '17:00' };
  assert.deepEqual(workWindow(null, outlet, 2), { start: 540, end: 1020 });
  assert.equal(workWindow(null, outlet, 7), null);
  assert.deepEqual(workWindow({ 7: { start: '12:00', end: '14:00' } }, outlet, 7), { start: 720, end: 840 }, 'a person can work a day the salon is otherwise closed');
  assert.equal(workWindow({ 2: null }, outlet, 2), null, 'or have a day off');
  assert.deepEqual(freeSlots({ window: { start: 540, end: 660 }, busy: [[570, 600]], duration: 30, step: 30 }), [540, 600, 630]);
  assert.deepEqual(freeSlots({ window: { start: 540, end: 660 }, busy: [[540, 570]], duration: 30, step: 30, buffer: 15 }), [600, 630], 'a buffer after each booking');
});

test('a booking holds the slot for that person, with the services timed one after the other', { skip }, async () => {
  const res = await book({ customer_id: asha, start_at: at(date, '10:00'), services: [{ service_id: haircut, staff_id: ravi }, { service_id: facial, staff_id: ravi }], notes: 'Prefers quiet' });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const a = res.body.data;
  assert.equal(a.status, 'BOOKED');
  assert.equal(a.services[0].duration_min, 30); assert.equal(a.services[1].duration_min, 60);
  assert.equal(new Date(a.services[1].start_at).getTime(), new Date(a.services[0].end_at).getTime());
  assert.equal(a.total, 1500);
  assert.equal(a.customer_name, 'Asha');
  S.first = a;
});

test('the same person cannot be booked twice at once; another person or a neighbouring slot is fine', { skip }, async () => {
  const clash = await book(one('10:30', ravi));
  assert.equal(clash.code, 409); assert.match(clash.body.message, /Ravi is already booked 10:30–11:30/);
  assert.equal((await book(one('10:30', ravi, facial))).code, 409, 'overlap with the facial that runs to 11:30');
  assert.equal((await book(one('11:30', ravi))).code, 201, 'straight after is fine');
  assert.equal((await book(one('10:00', meena))).code, 201, 'someone else at the same time is fine');
});

test('two people booking the last slot at the same moment: exactly one gets it', { skip }, async () => {
  const results = await Promise.all([book(one('14:00', ravi)), book(one('14:00', ravi)), book(one('14:15', ravi))]);
  const made = results.filter((r) => r.code === 201).length;
  assert.equal(made, 1);
  assert.equal(results.filter((r) => r.code === 409).length, 2);
});

test('only inside the person\'s working hours, on a day they are in', { skip }, async () => {
  assert.equal((await book(one('08:30', ravi))).code, 409, 'before opening');
  assert.match((await book(one('20:45', ravi))).body.message, /works 09:00–21:00/, 'it would run past closing');
  const closed = await book({ customer_id: asha, start_at: at(sunday, '11:00'), services: [{ service_id: haircut, staff_id: ravi }] });
  assert.equal(closed.code, 409); assert.match(closed.body.message, /not working that day/);
  await pool.query(`UPDATE salon_staff SET working_hours = '{"3":{"start":"12:00","end":"15:00"}}' WHERE staff_id = $1`, [meena]);
  assert.equal((await book(one('09:30', meena))).code, 409, 'her own hours are narrower than the salon\'s');
  assert.equal((await book(one('12:30', meena))).code, 201);
  await pool.query(`UPDATE salon_staff SET working_hours = NULL WHERE staff_id = $1`, [meena]);
});

test('someone marked absent or on leave cannot be booked that day', { skip }, async () => {
  const mark = await S.call(staffApi.markAttendance, { body: { staff_id: meena, work_date: date, status: 'LEAVE' } });
  assert.equal(mark.code, 200);
  const res = await book(one('17:00', meena));
  assert.equal(res.code, 409); assert.match(res.body.message, /on leave/);
  await S.call(staffApi.markAttendance, { body: { staff_id: meena, work_date: date, status: 'PRESENT' } });
  assert.equal((await book(one('17:00', meena))).code, 201);
});

test('bad bookings are refused with a reason', { skip }, async () => {
  assert.equal((await book({ customer_id: asha, services: [{ service_id: haircut, staff_id: ravi }] })).code, 400, 'no time');
  assert.equal((await book({ customer_id: asha, start_at: at(date, '10:00'), services: [] })).code, 400, 'no service');
  assert.equal((await book({ start_at: at(date, '18:00'), services: [{ service_id: haircut, staff_id: ravi }] })).code, 400, 'no client or guest name');
  assert.equal((await book({ customer_id: asha, start_at: new Date(Date.now() - 3600000).toISOString(), services: [{ service_id: haircut, staff_id: ravi }] })).code, 400, 'in the past');
  assert.equal((await book({ customer_id: asha, start_at: at(nextDay(3).replace(/-\d\d$/, '-01'), '10:00'), services: [{ service_id: 999999, staff_id: ravi }] })).code, 400, 'unknown service');
  assert.equal((await book(one('18:00', 999999))).code, 400, 'staff who do not exist');
  const far = new Date(Date.now() + 200 * 86400000);
  assert.equal((await book({ customer_id: asha, start_at: far.toISOString(), services: [{ service_id: haircut, staff_id: ravi }] })).code, 400, 'beyond the booking window');
  const other = await makeSalon(pool, 'theirs');
  const theirs = await addStaff(pool, other, { name: 'Elsewhere' });
  assert.equal((await book(one('18:00', theirs))).code, 400, 'another salon\'s staff');
});

test('a guest with a known mobile number is the client already on file', { skip }, async () => {
  const res = await book({ guest_name: 'Someone', guest_phone: '+91 98765 00001', start_at: at(date, '18:30'), services: [{ service_id: haircut, staff_id: meena }] });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.customer_id, asha);
  const fresh = await book({ guest_name: 'Walk Guest', guest_phone: '9000000077', start_at: at(date, '19:00'), services: [{ service_id: haircut, staff_id: meena }] });
  assert.equal(fresh.body.data.is_guest, true);
  assert.equal(fresh.body.data.customer_name, 'Walk Guest');
});

test('moving an appointment is checked like a new booking, and a failed move changes nothing', { skip }, async () => {
  const made = (await book(one('12:00', ravi))).body.data;
  const into = await S.call(appts.reschedule, { params: { id: made.appointment_id }, body: { start_at: at(date, '10:15') } });
  assert.equal(into.code, 409);
  const same = await S.call(appts.get, { params: { id: made.appointment_id } });
  assert.equal(new Date(same.body.data.start_at).getTime(), new Date(made.start_at).getTime(), 'the original time is untouched');
  const ok = await S.call(appts.reschedule, { params: { id: made.appointment_id }, body: { start_at: at(date, '16:00') } });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(new Date(ok.body.data.start_at).toISOString(), at(date, '16:00'));
  const self = await S.call(appts.reschedule, { params: { id: made.appointment_id }, body: { start_at: at(date, '16:15') } });
  assert.equal(self.code, 200, 'an appointment can overlap its own old time');
  const swap = await S.call(appts.reschedule, { params: { id: made.appointment_id }, body: { services: [{ line_id: made.services[0].line_id, staff_id: meena }] } });
  assert.equal(swap.code, 200);
  assert.equal(swap.body.data.services[0].staff_id, meena, 'and the person can be changed');
  assert.equal((await S.call(appts.reschedule, { params: { id: made.appointment_id }, body: { start_at: new Date(Date.now() - 3600000).toISOString() } })).code, 400);
});

test('cancelling frees the slot, and the salon\'s cancellation policy is reported', { skip }, async () => {
  await pool.query(`UPDATE salon_settings SET cancellation_policy = '{"min_notice_hours": 100000, "fee_pct": 50, "text": "Half the fee"}' WHERE business_id = $1`, [S.businessId]);
  const made = (await book(one('19:30', ravi))).body.data;
  const res = await S.call(appts.setStatus, { params: { id: made.appointment_id }, body: { status: 'CANCELLED', reason: 'Client called' } });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.status, 'CANCELLED');
  assert.equal(res.body.data.policy.late_cancellation, true);
  assert.equal(res.body.data.policy.fee_pct, 50);
  assert.equal((await book(one('19:30', ravi))).code, 201, 'the slot is free again');
  await pool.query(`UPDATE salon_settings SET cancellation_policy = '{}' WHERE business_id = $1`, [S.businessId]);
  assert.equal((await S.call(appts.setStatus, { params: { id: made.appointment_id }, body: { status: 'CONFIRMED' } })).code, 409, 'a cancelled appointment stays cancelled');
});

test('a no-show can only be marked once the time has come', { skip }, async () => {
  const future = (await book(one('20:00', meena))).body.data;
  assert.equal((await S.call(appts.setStatus, { params: { id: future.appointment_id }, body: { status: 'NO_SHOW' } })).code, 409);
  const past = (await pool.query(`INSERT INTO salon_appointments (business_id, branch_id, customer_id, start_at, end_at, status) VALUES ($1,$2,$3, now() - interval '3 hours', now() - interval '2 hours 30 minutes', 'BOOKED') RETURNING appointment_id`, [S.businessId, S.branchId, asha])).rows[0];
  const res = await S.call(appts.setStatus, { params: { id: past.appointment_id }, body: { status: 'NO_SHOW' } });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.status, 'NO_SHOW');
});

test('an appointment moves along booked, confirmed, checked in, in service; completing is the bill\'s job', { skip }, async () => {
  const a = (await book(one('11:45', meena))).body.data;
  const step = async (status, code = 200) => { const r = await S.call(appts.setStatus, { params: { id: a.appointment_id }, body: { status } }); assert.equal(r.code, code, `${status}: ${JSON.stringify(r.body)}`); return r; };
  await step('IN_SERVICE', 409);
  await step('CONFIRMED'); await step('CHECKED_IN'); await step('IN_SERVICE');
  await step('COMPLETED', 409);
  await step('BOGUS', 400);
});

test('billing an appointment completes it, and cancelling the bill reopens it', { skip }, async () => {
  const a = (await book(one('13:15', meena))).body.data;
  const cart = await S.call(appts.cart, { params: { id: a.appointment_id } });
  assert.equal(cart.body.data.items[0].staff_id, meena);
  assert.equal(cart.body.data.customer_id, asha);
  const out = await sell(pool, createSalonInvoice, S, { customer_id: asha, appointment_id: a.appointment_id, items: [{ type: 'SERVICE', service_id: haircut, staff_id: meena }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const done = await S.call(appts.get, { params: { id: a.appointment_id } });
  assert.equal(done.body.data.status, 'COMPLETED'); assert.equal(done.body.data.invoice_id, out.invoice.invoice_id);
  assert.equal((await S.call(appts.cart, { params: { id: a.appointment_id } })).code, 409, 'a completed appointment is not billed twice');
  await assert.rejects(() => sell(pool, createSalonInvoice, S, { appointment_id: a.appointment_id, items: [{ type: 'SERVICE', service_id: haircut, staff_id: meena }] }), /not open/);
  const cancel = fakeRes();
  await invoices.cancel(S.req({ params: { id: out.invoice.invoice_id } }), cancel);
  assert.equal(cancel.code, 200);
  assert.equal((await S.call(appts.get, { params: { id: a.appointment_id } })).body.data.status, 'IN_SERVICE');
});

test('a walk-in is checked in now with whoever is free; with nobody free it says so', { skip }, async () => {
  if (localParts(new Date(), TZ).minutes >= 22 * 60 + 30) return;   // too close to midnight to book a walk-in today
  const today = localParts(new Date(), TZ);
  await pool.query(`UPDATE salon_settings SET open_time = '00:00', close_time = '23:59', working_days = '[1,2,3,4,5,6,7]' WHERE business_id = $1`, [S.businessId]);
  try {
    const first = await book({ guest_name: 'Walk In', source: 'WALK_IN', services: [{ service_id: haircut }] });
    assert.equal(first.code, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.status, 'CHECKED_IN'); assert.equal(first.body.data.source, 'WALK_IN');
    const second = await book({ guest_name: 'Walk In 2', source: 'WALK_IN', services: [{ service_id: haircut }] });
    assert.equal(second.code, 201);
    assert.notEqual(second.body.data.services[0].staff_id, first.body.data.services[0].staff_id, 'the second walk-in goes to the other person');
    const third = await book({ guest_name: 'Walk In 3', source: 'WALK_IN', services: [{ service_id: haircut }] });
    assert.equal(third.code, 409); assert.match(third.body.message, /Nobody is free/);
    void today;
  } finally {
    await pool.query(`UPDATE salon_settings SET open_time = '09:00', close_time = '21:00', working_days = '[1,2,3,4,5,6]' WHERE business_id = $1`, [S.businessId]);
  }
});

test('availability lists free start times and who is free for each', { skip }, async () => {
  const day = nextDay(4);   // a Thursday with no bookings yet
  const all = await S.call(appts.availability, { query: { date: day, service_ids: String(haircut) } });
  assert.equal(all.code, 200);
  const times = all.body.data.slots.map((s) => s.time);
  assert.equal(times[0], '09:00'); assert.equal(times.at(-1), '20:30', 'the last 30-minute slot that still ends by 21:00');
  assert.equal(all.body.data.slots[0].staff.length, 2);

  await book({ customer_id: asha, start_at: at(day, '10:00'), services: [{ service_id: haircut, staff_id: ravi }] });
  const after = await S.call(appts.availability, { query: { date: day, service_ids: String(haircut) } });
  const at10 = after.body.data.slots.find((s) => s.time === '10:00');
  assert.deepEqual(at10.staff.map((s) => s.name), ['Meena'], 'Ravi is taken at 10:00');
  const only = await S.call(appts.availability, { query: { date: day, service_ids: String(haircut), staff_id: String(ravi) } });
  assert.ok(!only.body.data.slots.some((s) => s.time === '10:00'));

  const long = await S.call(appts.availability, { query: { date: day, service_ids: `${haircut},${facial}` } });
  assert.equal(long.body.data.duration_min, 90);
  assert.equal(long.body.data.slots.at(-1).time, '19:30');
  assert.equal((await S.call(appts.availability, { query: { date: day } })).code, 400, 'a service is needed');

  // someone who lists the services they do is only offered for those
  await pool.query(`INSERT INTO salon_staff_services (staff_id, product_id) VALUES ($1,$2)`, [ravi, haircut]);
  const facialOnly = await S.call(appts.availability, { query: { date: day, service_ids: String(facial) } });
  assert.ok(facialOnly.body.data.slots.every((s) => s.staff.every((p) => p.name !== 'Ravi')), 'Ravi does not list facials');
  await pool.query(`DELETE FROM salon_staff_services WHERE staff_id = $1`, [ravi]);
});

test('the day\'s schedule has a column per person with their hours and bookings', { skip }, async () => {
  const res = await S.call(appts.schedule, { query: { date } });
  assert.equal(res.code, 200);
  const d = res.body.data;
  assert.equal(d.outlet.open, '09:00'); assert.equal(d.outlet.open_today, true);
  const r = d.staff.find((s) => s.name === 'Ravi');
  assert.deepEqual(r.window, { start: '09:00', end: '21:00' });
  assert.ok(r.bookings.length >= 2);
  const sun = await S.call(appts.schedule, { query: { date: sunday } });
  assert.equal(sun.body.data.outlet.open_today, false);
  assert.ok(sun.body.data.staff.every((s) => s.off));
});

test('the list is filtered by day, person and status, in the salon\'s own calendar', { skip }, async () => {
  const day = await S.call(appts.list, { query: { date } });
  assert.ok(day.body.data.length >= 4);
  assert.ok(day.body.data.every((a) => localParts(new Date(a.start_at), TZ).date === date));
  const mine = await S.call(appts.list, { query: { date, staff_id: String(ravi) } });
  assert.ok(mine.body.data.every((a) => a.services.some((s) => s.staff_id === ravi)));
  const cancelled = await S.call(appts.list, { query: { date, status: 'CANCELLED' } });
  assert.ok(cancelled.body.data.every((a) => a.status === 'CANCELLED'));
  assert.equal((await S.call(appts.list, { query: { from: date, to: '2020-01-01' } })).code, 400);
  assert.equal((await S.call(appts.list, { query: { from: '2026-01-01', to: '2027-12-31' } })).code, 400, 'a range is capped');
});

test('a stylist sees and moves only their own clients', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Stylist Sam', 'sam-stylist@salon.test', 'x') RETURNING user_id`)).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'STYLIST','ACTIVE')`, [S.businessId, u.user_id]);
  await pool.query(`UPDATE salon_staff SET user_id = $2 WHERE staff_id = $1`, [ravi, u.user_id]);
  const stylist = S.tenantFor('STYLIST', { userId: u.user_id });
  const list = await S.call(appts.list, { query: { date } }, stylist);
  assert.ok(list.body.data.length > 0);
  assert.ok(list.body.data.every((a) => a.services.some((s) => s.staff_id === ravi)), 'only Ravi\'s appointments');
  const others = (await S.call(appts.list, { query: { date } })).body.data.find((a) => a.services.every((s) => s.staff_id !== ravi));
  assert.equal((await S.call(appts.get, { params: { id: others.appointment_id } }, stylist)).code, 404, 'someone else\'s appointment does not exist for them');
  assert.equal((await S.call(appts.setStatus, { params: { id: list.body.data[0].appointment_id }, body: { status: 'CANCELLED' } }, stylist)).code, 403);
  assert.equal((await S.call(appts.schedule, { query: { date } }, stylist)).body.data.staff.length, 1);
});

test('appointments belong to an outlet: another outlet cannot see or move them', { skip }, async () => {
  const second = S.tenantFor('MANAGER', { branchId: S.branchIds[1], pinned: true });
  const made = (await book(one('15:00', ravi))).body.data;
  assert.equal((await S.call(appts.get, { params: { id: made.appointment_id } }, second)).code, 404);
  assert.equal((await S.call(appts.list, { query: { date } }, second)).body.data.length, 0);
  assert.equal((await S.call(appts.setStatus, { params: { id: made.appointment_id }, body: { status: 'CONFIRMED' } }, second)).code, 404);
  // and Ravi is not at the second outlet
  assert.equal((await book(one('10:00', ravi), second)).code, 400);
});
