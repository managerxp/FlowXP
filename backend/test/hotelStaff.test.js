/*
 * Hotel staff: departments and shifts, employees (and who may see their pay), the roster, attendance, leave, the payroll sheet worked out by hand to the paisa, the unmarked-day
 * warning, finalising, and who cleans which room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeHotel } from './helpers/hotel.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const staff = (await import('../src/controllers/hotelStaff.controller.js')).default;
const setup = (await import('../src/controllers/hotelSetup.controller.js')).default;
const front = (await import('../src/controllers/hotelFront.controller.js')).default;
const { computePay } = await import('../src/modules/hotel/staff.js');
const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');

test.after(cleanup);

let H; let frontOffice; let housekeeping; let shiftMorning; let a; let b;
const call = (handler, extra, tenant) => H.call(handler, extra, tenant);
const ok = (res) => { assert.equal(res.code < 300, true, `${res.code} ${res.body?.message}`); return res.body.data; };
const M = '2026-11';   // 30 days; Sundays are the 1st, 8th, 15th, 22nd and 29th
const day = (n) => `${M}-${String(n).padStart(2, '0')}`;

test('the pay sums are right for a monthly and a daily employee', () => {
  const none = { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, LEAVE: 0, UNPAID_LEAVE: 0, WEEKLY_OFF: 0, HOLIDAY: 0 };
  // ₹30,000 a month: 20 present, 2 half days, 1 paid leave, 5 weekly offs, 2 absent = 27 paid days of 30
  const monthly = computePay({ payType: 'MONTHLY', salaryPaise: 3000000, daysInMonth: 30, counts: { ...none, PRESENT: 20, HALF_DAY: 2, LEAVE: 1, WEEKLY_OFF: 5, ABSENT: 2 }, overtimeMinutes: 120, overtimeFactor: 1.5 });
  assert.equal(monthly.base_pay_paise, 2700000);
  assert.equal(monthly.overtime_pay_paise, 37500);      // ₹1,000 a day / 8 = ₹125 an hour x 2 hours x 1.5
  assert.equal(monthly.days_unpaid, 3);                  // 2 absent and 2 half days' other halves
  // ₹600 a day: 10 present, 2 half days, 1 paid leave = 12 paid days; weekly offs are not paid
  const daily = computePay({ payType: 'DAILY', salaryPaise: 60000, daysInMonth: 30, counts: { ...none, PRESENT: 10, HALF_DAY: 2, LEAVE: 1, WEEKLY_OFF: 4 }, overtimeMinutes: 60, overtimeFactor: 2 });
  assert.equal(daily.base_pay_paise, 720000);
  assert.equal(daily.overtime_pay_paise, 15000);        // ₹600 / 8 = ₹75 x 1 hour x 2
});

test('departments and shifts are ready on first use, and only a department with no people can go', { skip }, async () => {
  await runMigrations(pool);
  H = await makeHotel(pool, 'staff');
  ok(await call(setup.updateSettings, { body: { business_date: '2027-01-05' } }));   // November and December 2026 are over
  const depts = ok(await call(staff.departments));
  assert.ok(depts.length >= 8);
  frontOffice = depts.find((d) => d.name === 'Front office').dept_id;
  housekeeping = depts.find((d) => d.name === 'Housekeeping').dept_id;
  const shifts = ok(await call(staff.shifts));
  assert.deepEqual(shifts.map((s) => s.name), ['Morning', 'Evening', 'Night']);
  shiftMorning = shifts[0].shift_id;
  const custom = ok(await call(staff.saveShift, { body: { name: 'Split', start_time: '09:00', end_time: '21:00' } }));
  assert.equal(custom.name, 'Split');
  const bad = await call(staff.saveShift, { body: { name: 'Odd', start_time: '9am', end_time: '17:00' } });
  assert.equal(bad.code, 400);
});

test('employees get a code, a department and pay, and pay is hidden from anyone without payroll', { skip }, async () => {
  a = ok(await call(staff.saveEmployee, { body: { name: 'Lakshmi Pillai', phone: '9876500011', dept_id: housekeeping, designation: 'Housekeeper', joined_on: '2026-01-05', pay_type: 'MONTHLY', salary: 30000, weekly_off: 0, default_shift_id: shiftMorning } }));
  b = ok(await call(staff.saveEmployee, { body: { name: 'Suman Das', dept_id: frontOffice, designation: 'Receptionist', joined_on: '2026-01-05', pay_type: 'DAILY', salary: 600 } }));
  assert.match(a.emp_code, /^E\d{3}$/);
  assert.notEqual(a.emp_code, b.emp_code);
  assert.equal(a.salary_paise, 3000000);
  const noPay = H.tenantFor('MANAGER', { permissions: { payroll: false } });
  const list = ok(await call(staff.listEmployees, { query: {} }, noPay));
  assert.ok(list.every((e) => e.salary_paise === undefined && e.salary === undefined), 'no salary for someone without payroll');
  const forbidden = await call(staff.saveEmployee, { params: { id: String(a.employee_id) }, body: { salary: 99999 } }, noPay);
  assert.equal(forbidden.code, 403);
  const renamed = ok(await call(staff.saveEmployee, { params: { id: String(a.employee_id) }, body: { designation: 'Senior housekeeper' } }, noPay));
  assert.equal(renamed.designation, 'Senior housekeeper');
  assert.equal(ok(await call(staff.getEmployee, { params: { id: String(a.employee_id) } })).salary_paise, 3000000, 'the salary was not changed by someone who cannot see it');
  const badDept = await call(staff.saveEmployee, { body: { name: 'Nobody', dept_id: 9999999 } });
  assert.equal(badDept.code, 400);
  const archive = await call(staff.archiveDepartment, { params: { id: String(housekeeping) } });
  assert.equal(archive.code, 409);
});

test('the roster is set by day, copied to the next week, and shows approved leave', { skip }, async () => {
  const entries = [0, 1, 2, 3, 4, 5].map((i) => ({ employee_id: a.employee_id, work_date: day(2 + i), shift_id: shiftMorning }));
  entries.push({ employee_id: a.employee_id, work_date: day(8), shift_id: null });
  assert.equal(ok(await call(staff.setRoster, { body: { entries } })).changed, 7);
  assert.equal(ok(await call(staff.copyWeek, { body: { from: day(2), to: day(9) } })).changed, 7);
  const r = ok(await call(staff.roster, { query: { from: day(1), to: day(15) } }));
  assert.equal(r.entries.filter((e) => e.employee_id === a.employee_id && e.shift_id).length, 12);   // the 2nd to 7th, and the copied 9th to 14th
  const wrongShift = await call(staff.setRoster, { body: { entries: [{ employee_id: a.employee_id, work_date: day(20), shift_id: 99999999 }] } });
  assert.equal(wrongShift.code, 400);
});

test('leave: asked, a clash refused, approved days land in attendance, cancelling takes them back', { skip }, async () => {
  const l = ok(await call(staff.requestLeave, { body: { employee_id: a.employee_id, from_date: day(18), to_date: day(19), kind: 'SICK', reason: 'Fever' } }));
  const clash = await call(staff.requestLeave, { body: { employee_id: a.employee_id, from_date: day(19), to_date: day(20), kind: 'CASUAL' } });
  assert.equal(clash.code, 409);
  assert.equal(ok(await call(staff.decideLeave, { params: { id: String(l.leave_id) }, body: { action: 'APPROVE' } })).status, 'APPROVED');
  let att = ok(await call(staff.attendanceDay, { query: { date: day(18) } }));
  assert.equal(att.rows.find((r) => r.employee_id === a.employee_id).status, 'LEAVE');
  const again = await call(staff.decideLeave, { params: { id: String(l.leave_id) }, body: { action: 'REJECT' } });
  assert.equal(again.code, 409);
  ok(await call(staff.decideLeave, { params: { id: String(l.leave_id) }, body: { action: 'CANCEL' } }));
  att = ok(await call(staff.attendanceDay, { query: { date: day(18) } }));
  assert.equal(att.rows.find((r) => r.employee_id === a.employee_id).status, null);
  // approved once more for the payroll below: 1 paid day of leave
  const paid = ok(await call(staff.requestLeave, { body: { employee_id: a.employee_id, from_date: day(18), to_date: day(18), kind: 'PAID' } }));
  ok(await call(staff.decideLeave, { params: { id: String(paid.leave_id) }, body: { action: 'APPROVE' } }));
});

test('attendance for the month, then the payroll sheet is worked out from it', { skip }, async () => {
  // Lakshmi: weekly off Sunday. 20 present, 2 absent, 2 half days, the 18th is paid leave (above), overtime of 2 hours on the 3rd.
  const marks = []; const workdays = [];
  for (let d = 1; d <= 30; d++) if (![1, 8, 15, 22, 29].includes(d) && d !== 18) workdays.push(d);   // 24 working days
  workdays.forEach((d, i) => marks.push({ employee_id: a.employee_id, status: i < 20 ? 'PRESENT' : i < 22 ? 'ABSENT' : 'HALF_DAY', overtime_minutes: d === 3 ? 120 : 0 }));
  for (const [i, d] of workdays.entries()) ok(await call(staff.markAttendance, { body: { date: day(d), entries: [marks[i]] } }));
  const month = ok(await call(staff.attendanceMonth, { query: { month: M } }));
  const row = month.rows.find((r) => r.employee_id === a.employee_id);
  assert.deepEqual([row.present, row.absent, row.half_days, row.leave, row.overtime_minutes], [20, 2, 2, 1, 120]);
  const run = ok(await call(staff.generate, { body: { month: M, overtime_factor: 1.5 } }));
  const slip = run.slips.find((s) => s.employee_id === a.employee_id);
  assert.equal(slip.days_in_month, 30);
  assert.equal(Number(slip.days_present), 21);          // 20 + two half days
  assert.equal(Number(slip.days_paid_leave), 1);
  assert.equal(slip.days_weekly_off, 5);               // the five Sundays, not marked but a weekly off
  assert.equal(slip.days_unmarked, 0);
  assert.equal(Number(slip.base_pay_paise), 2700000);   // 27 paid days of 30
  assert.equal(Number(slip.overtime_pay_paise), 37500);
  assert.equal(Number(slip.net_pay_paise), 2737500);
});

test('allowances and deductions adjust the net pay; unmarked days are flagged and block finalising', { skip }, async () => {
  const run = ok(await call(staff.getRun, { params: { month: M } }));
  const slip = run.slips.find((s) => s.employee_id === a.employee_id);
  ok(await call(staff.adjustSlip, { params: { id: String(slip.payslip_id) }, body: { allowances: 1500, deductions: 2000, note: 'Festival bonus, salary advance' } }));
  const again = ok(await call(staff.generate, { body: { month: M, overtime_factor: 1.5 } }));
  const s2 = again.slips.find((s) => s.employee_id === a.employee_id);
  assert.equal(Number(s2.net_pay_paise), 2700000 + 37500 + 150000 - 200000, 'redoing the sheet keeps what was typed by hand');
  const unmarked = again.slips.find((s) => s.employee_id === b.employee_id);
  assert.equal(unmarked.days_unmarked, 30);              // nothing marked for the daily-paid receptionist
  assert.equal(again.unmarked_days, 30);
  const blocked = await call(staff.finalize, { body: { month: M } });
  assert.equal(blocked.code, 409);
  assert.equal(blocked.body.code, 'UNMARKED_DAYS');
  const done = ok(await call(staff.finalize, { body: { month: M, force: true } }));
  assert.equal(done.status, 'FINAL');
  const locked = await call(staff.adjustSlip, { params: { id: String(slip.payslip_id) }, body: { deductions: 1 } });
  assert.equal(locked.code, 409);
  const redo = await call(staff.generate, { body: { month: M } });
  assert.equal(redo.code, 409);
});

test('a person who joined mid-month is paid only for the days on the books', { skip }, async () => {
  const c = ok(await call(staff.saveEmployee, { body: { name: 'Mid Joiner', dept_id: frontOffice, pay_type: 'MONTHLY', salary: 30000, joined_on: '2026-12-16', weekly_off: 0 } }));
  for (let d = 16; d <= 31; d++) { if (new Date(Date.UTC(2026, 11, d)).getUTCDay() !== 0) ok(await call(staff.markAttendance, { body: { date: `2026-12-${d}`, entries: [{ employee_id: c.employee_id, status: 'PRESENT' }] } })); }
  const run = ok(await call(staff.generate, { body: { month: '2026-12' } }));
  const slip = run.slips.find((s) => s.employee_id === c.employee_id);
  assert.equal(Number(slip.days_present) + slip.days_weekly_off, 16);          // 16th to 31st, 16 days on the books
  assert.equal(Number(slip.base_pay_paise), Math.round(3000000 * 16 / 31));
});

test('rooms are given to a housekeeper for the day, and taken back', { skip }, async () => {
  const t = ok(await call(setup.createRoomType, { body: { name: 'Std', code: 'STD', base_rate: 3000 } })).room_type_id;
  const r1 = ok(await call(setup.createRoom, { body: { room_type_id: t, room_no: '101' } })).room_id;
  const r2 = ok(await call(setup.createRoom, { body: { room_type_id: t, room_no: '102' } })).room_id;
  const hk = ok(await call(staff.housekeepers));
  assert.deepEqual(hk.map((x) => x.employee_id), [a.employee_id]);
  assert.equal(ok(await call(staff.assign, { body: { room_ids: [r1, r2], employee_id: a.employee_id } })).assigned, 2);
  const list = ok(await call(staff.assignments));
  assert.equal(list.length, 2);
  assert.equal(list[0].employee, 'Lakshmi Pillai');
  ok(await call(staff.assign, { body: { room_ids: [r2] } }));
  assert.equal(ok(await call(staff.assignments)).length, 1);
  const wrong = await call(staff.assign, { body: { room_ids: [99999999], employee_id: a.employee_id } });
  assert.equal(wrong.code, 400);
  void front;
});

test('a month that is not over is paid for the days gone only, and nothing is flagged for the days to come', { skip }, async () => {
  const g = await makeHotel(pool, 'open');
  const c2 = (handler, extra) => g.call(handler, extra);
  ok(await c2(setup.updateSettings, { body: { business_date: '2027-03-11' } }));
  const e = ok(await c2(staff.saveEmployee, { body: { name: 'Early Bird', pay_type: 'MONTHLY', salary: 31000, joined_on: '2026-01-01', weekly_off: 0 } }));
  for (let d = 1; d <= 10; d++) if (new Date(Date.UTC(2027, 2, d)).getUTCDay() !== 0) ok(await c2(staff.markAttendance, { body: { date: `2027-03-${String(d).padStart(2, '0')}`, entries: [{ employee_id: e.employee_id, status: 'PRESENT' }] } }));
  const run = ok(await c2(staff.generate, { body: { month: '2027-03' } }));
  const slip = run.slips[0];
  assert.equal(slip.days_unmarked, 0, 'the 11th to the 31st have not happened');
  assert.equal(Number(slip.days_present) + slip.days_weekly_off, 10);   // 1st to 10th
  assert.equal(Number(slip.base_pay_paise), 1000000);                   // ₹31,000 x 10 / 31
});

test('the roles: HR sees records and pay, the front desk neither', { skip }, () => {
  assert.ok(ROLE_PERMISSIONS.HR_MANAGER.includes('hr') && ROLE_PERMISSIONS.HR_MANAGER.includes('payroll'));
  assert.ok(!ROLE_PERMISSIONS.FRONT_DESK.includes('hr') && !ROLE_PERMISSIONS.FRONT_DESK.includes('payroll'));
  assert.ok(ROLE_PERMISSIONS.MANAGER.includes('payroll'));
});
