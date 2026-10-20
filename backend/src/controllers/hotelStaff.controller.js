/*
 * Hotel staff endpoints, mounted at /api/hotel/staff (see hotel.routes.js). Records, roster, attendance and leave need 'hr'; salary and payroll need 'payroll', so a
 * department head can run the roster without seeing what anyone is paid. Money comes in as rupees and goes out as paise and rupees.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import { HotelError, audit, int, isoDate, like, money, num, ok, oneOf, phone, text, withRupees, wrapAll } from '../modules/hotel/common.js';
import { hasPermission } from '../middleware/auth.js';
import * as hr from '../modules/hotel/staff.js';
import { addDaysISO } from '../utils/dates.js';

const out = (res, data, status = 200) => ok(res, withRupees(data), status);
const time = (v, field) => { if (v == null || v === '') return null; const s = String(v).slice(0, 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HotelError(400, `${field} must be a time like 09:30`); return s; };
const month = (v) => { const m = String(v ?? '').slice(0, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HotelError(400, 'Choose a month'); return m; };
const canSeePay = (req) => hasPermission(req.tenant, 'payroll');

const employeeInput = (b) => {
  const v = {
    emp_code: b.emp_code === undefined ? undefined : text(b.emp_code, 'Employee code', { max: 20 }) ?? undefined, name: b.name === undefined ? undefined : text(b.name, 'Name', { required: true, max: 120 }),
    phone: b.phone === undefined ? undefined : phone(b.phone, 'Phone'), email: b.email === undefined ? undefined : text(b.email, 'Email', { max: 255 }),
    dept_id: b.dept_id === undefined ? undefined : (b.dept_id ? int(b.dept_id, 'Department', { min: 1 }) : null), designation: b.designation === undefined ? undefined : text(b.designation, 'Designation', { max: 80 }),
    joined_on: b.joined_on === undefined ? undefined : isoDate(b.joined_on, 'Joining date') || null, left_on: b.left_on === undefined ? undefined : isoDate(b.left_on, 'Leaving date') || undefined,
    status: b.status === undefined ? undefined : oneOf(b.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true }), pay_type: b.pay_type === undefined ? undefined : oneOf(b.pay_type, 'Pay type', ['MONTHLY', 'DAILY'], { required: true }),
    weekly_off: b.weekly_off === undefined ? undefined : (b.weekly_off === null || b.weekly_off === '' ? null : int(b.weekly_off, 'Weekly off', { min: 0, max: 6 })),
    default_shift_id: b.default_shift_id === undefined ? undefined : (b.default_shift_id ? int(b.default_shift_id, 'Shift', { min: 1 }) : null), user_id: b.user_id === undefined ? undefined : (b.user_id ? int(b.user_id, 'Login', { min: 1 }) : null),
    id_type: b.id_type === undefined ? undefined : text(b.id_type, 'ID type', { max: 24 }), id_number: b.id_number === undefined ? undefined : text(b.id_number, 'ID number', { max: 40 }),
    address: b.address === undefined ? undefined : text(b.address, 'Address', { max: 400 }), emergency_contact: b.emergency_contact === undefined ? undefined : text(b.emergency_contact, 'Emergency contact', { max: 160 }),
    notes: b.notes === undefined ? undefined : text(b.notes, 'Notes', { max: 500 })
  };
  return v;
};

export default wrapAll({
  /* ── set-up ─────────────────────────────────────────────────── */
  departments: async (req, res) => out(res, await hr.listDepartments(pool, req.tenant)),
  saveDepartment: async (req, res) => {
    const d = await withTransaction((c) => hr.saveDepartment(c, req.tenant, req.params.id ? Number(req.params.id) : null, text(req.body?.name, 'Name', { required: true, max: 60 })));
    audit(req, 'hr.department_saved', 'hr_department', d.dept_id, null, { name: d.name });
    out(res, d, req.params.id ? 200 : 201);
  },
  archiveDepartment: async (req, res) => { await withTransaction((c) => hr.archiveDepartment(c, req.tenant, Number(req.params.id))); ok(res, { archived: true }); },
  shifts: async (req, res) => out(res, await hr.listShifts(pool, req.tenant)),
  saveShift: async (req, res) => {
    const b = req.body || {};
    const start = time(b.start_time, 'Start time'); const end = time(b.end_time, 'End time');
    if (!start || !end) throw new HotelError(400, 'Give the shift a start and an end time');
    const s = await withTransaction((c) => hr.saveShift(c, req.tenant, req.params.id ? Number(req.params.id) : null, { name: text(b.name, 'Name', { required: true, max: 40 }), start_time: start, end_time: end }));
    out(res, s, req.params.id ? 200 : 201);
  },
  archiveShift: async (req, res) => { await withTransaction((c) => hr.archiveShift(c, req.tenant, Number(req.params.id))); ok(res, { archived: true }); },

  /* ── people ─────────────────────────────────────────────────── */
  listEmployees: async (req, res) => {
    const rows = await hr.listEmployees(pool, req.tenant, { status: req.query.status ? String(req.query.status).toUpperCase() : 'ACTIVE', deptId: int(req.query.dept_id, 'Department'), q: text(req.query.q, 'Search', { max: 80 }), like, withPay: canSeePay(req) });
    out(res, rows);
  },
  getEmployee: async (req, res) => out(res, await hr.getEmployee(pool, req.tenant, Number(req.params.id), { withPay: canSeePay(req) })),
  saveEmployee: async (req, res) => {
    const b = req.body || {};
    const v = employeeInput(b);
    // pay is set only by someone allowed to see it
    if (b.salary !== undefined || b.bank_account !== undefined) {
      if (!canSeePay(req)) throw new HotelError(403, 'You do not have access to salaries');
      if (b.salary !== undefined) v.salary_paise = money(b.salary, 'The salary') ?? 0;
      if (b.bank_account !== undefined) v.bank_account = text(b.bank_account, 'Bank account', { max: 40 });
    }
    const id = req.params.id ? Number(req.params.id) : null;
    if (!id && !v.name) throw new HotelError(400, 'Name is required');
    const e = await withTransaction((c) => hr.saveEmployee(c, req.tenant, id, v));
    audit(req, id ? 'hr.employee_updated' : 'hr.employee_created', 'hr_employee', e.employee_id, null, { name: e.name });
    out(res, await hr.getEmployee(pool, req.tenant, e.employee_id, { withPay: canSeePay(req) }), id ? 200 : 201);
  },

  /* ── roster and attendance ──────────────────────────────────── */
  roster: async (req, res) => {
    const property = { business_date: await hr.staffToday(pool, req.tenant) };
    const from = isoDate(req.query.from, 'From') || property.business_date; const to = isoDate(req.query.to, 'To') || addDaysISO(from, 6);
    out(res, await hr.getRoster(pool, req.tenant, { from, to, deptId: int(req.query.dept_id, 'Department') }));
  },
  setRoster: async (req, res) => {
    const entries = (Array.isArray(req.body?.entries) ? req.body.entries : []).map((e) => ({ employee_id: int(e.employee_id, 'Employee', { required: true, min: 1 }), work_date: isoDate(e.work_date, 'Date', { required: true }), shift_id: e.shift_id ? int(e.shift_id, 'Shift', { min: 1 }) : null }));
    const n = await withTransaction((c) => hr.setRoster(c, req.tenant, entries));
    audit(req, 'hr.roster_changed', 'hr_roster', null, null, { changes: n });
    ok(res, { changed: n });
  },
  copyWeek: async (req, res) => {
    const n = await withTransaction((c) => hr.copyWeek(c, req.tenant, { from: isoDate(req.body?.from, 'From', { required: true }), to: isoDate(req.body?.to, 'To', { required: true }) }));
    audit(req, 'hr.roster_copied', 'hr_roster', null, null, { changes: n });
    ok(res, { changed: n });
  },
  attendanceDay: async (req, res) => {
    const property = { business_date: await hr.staffToday(pool, req.tenant) };
    out(res, await hr.attendanceDay(pool, req.tenant, isoDate(req.query.date, 'Date') || property.business_date));
  },
  markAttendance: async (req, res) => {
    const date = isoDate(req.body?.date, 'Date', { required: true });
    const entries = (Array.isArray(req.body?.entries) ? req.body.entries : []).map((e) => ({
      employee_id: int(e.employee_id, 'Employee', { required: true, min: 1 }), status: e.status ? oneOf(e.status, 'Status', hr.ATT_STATUS, { required: true }) : null,
      in_time: time(e.in_time, 'In time'), out_time: time(e.out_time, 'Out time'), overtime_minutes: int(e.overtime_minutes, 'Overtime', { min: 0, max: 1440 }) ?? 0, note: text(e.note, 'Note', { max: 200 }) ?? undefined
    }));
    const n = await withTransaction((c) => hr.markAttendance(c, req.tenant, req.auth.userId, date, entries));
    audit(req, 'hr.attendance_marked', 'hr_attendance', null, null, { date, people: n });
    ok(res, { marked: n });
  },
  attendanceMonth: async (req, res) => {
    const property = { business_date: await hr.staffToday(pool, req.tenant) };
    out(res, await hr.attendanceMonth(pool, req.tenant, month(req.query.month || property.business_date.slice(0, 7))));
  },
  headcount: async (req, res) => {
    const property = { business_date: await hr.staffToday(pool, req.tenant) };
    out(res, await hr.headcount(pool, req.tenant, isoDate(req.query.date, 'Date') || property.business_date));
  },

  /* ── leave ──────────────────────────────────────────────────── */
  leaves: async (req, res) => out(res, await hr.listLeaves(pool, req.tenant, { status: req.query.status ? String(req.query.status).toUpperCase() : null })),
  requestLeave: async (req, res) => {
    const b = req.body || {};
    const from_date = isoDate(b.from_date, 'From', { required: true }); const to_date = isoDate(b.to_date, 'To', { required: true });
    if (to_date < from_date) throw new HotelError(400, 'The last day cannot be before the first');
    const l = await hr.requestLeave(pool, req.tenant, req.auth.userId, { employee_id: int(b.employee_id, 'Employee', { required: true, min: 1 }), from_date, to_date, kind: oneOf(b.kind, 'Kind of leave', hr.LEAVE_KINDS, { required: true }), reason: text(b.reason, 'Reason', { max: 300 }) ?? undefined });
    audit(req, 'hr.leave_requested', 'hr_leave', l.leave_id, null, { from_date, to_date });
    out(res, l, 201);
  },
  decideLeave: async (req, res) => {
    const action = oneOf(req.body?.action, 'Action', ['APPROVE', 'REJECT', 'CANCEL'], { required: true });
    const status = await withTransaction((c) => hr.decideLeave(c, req.tenant, req.auth.userId, Number(req.params.id), { approve: action === 'APPROVE', cancel: action === 'CANCEL' }));
    audit(req, 'hr.leave_decided', 'hr_leave', Number(req.params.id), null, { status });
    ok(res, { status });
  },

  /* ── payroll ────────────────────────────────────────────────── */
  runs: async (req, res) => out(res, await hr.listRuns(pool, req.tenant)),
  getRun: async (req, res) => out(res, (await hr.getRun(pool, req.tenant, month(req.params.month))) || { month: month(req.params.month), status: null, slips: [] }),
  generate: async (req, res) => {
    const m = month(req.body?.month);
    const factor = num(req.body?.overtime_factor, 'The overtime rate', { min: 1, max: 5 }) ?? 1.5;
    await withTransaction((c) => hr.generatePayroll(c, req.tenant, req.auth.userId, m, { overtimeFactor: factor }));
    audit(req, 'hr.payroll_generated', 'hr_payroll_run', null, null, { month: m });
    out(res, await hr.getRun(pool, req.tenant, m));
  },
  adjustSlip: async (req, res) => {
    const b = req.body || {};
    await withTransaction((c) => hr.adjustSlip(c, req.tenant, Number(req.params.id), { allowances_paise: b.allowances === undefined ? undefined : money(b.allowances, 'Allowances') ?? 0, deductions_paise: b.deductions === undefined ? undefined : money(b.deductions, 'Deductions') ?? 0, note: b.note === undefined ? undefined : text(b.note, 'Note', { max: 200 }) }));
    audit(req, 'hr.payslip_adjusted', 'hr_payslip', Number(req.params.id));
    ok(res, { adjusted: true });
  },
  finalize: async (req, res) => {
    const m = month(req.body?.month);
    await withTransaction((c) => hr.finalizeRun(c, req.tenant, req.auth.userId, m, { force: req.body?.force === true }));
    audit(req, 'hr.payroll_finalized', 'hr_payroll_run', null, null, { month: m });
    out(res, await hr.getRun(pool, req.tenant, m));
  },

  /* ── who cleans which room ──────────────────────────────────── */
  housekeepers: async (req, res) => out(res, await hr.housekeepers(pool, req.tenant)),
  assignments: async (req, res) => {
    const property = { business_date: await hr.staffToday(pool, req.tenant) };
    out(res, await hr.listAssignments(pool, req.tenant, isoDate(req.query.date, 'Date') || property.business_date));
  },
  assign: async (req, res) => {
    const b = req.body || {};
    const property = { business_date: await hr.staffToday(pool, req.tenant) };
    const roomIds = [...new Set((Array.isArray(b.room_ids) ? b.room_ids : []).map((x) => int(x, 'Room', { required: true, min: 1 })))];
    if (!roomIds.length) throw new HotelError(400, 'Choose the rooms');
    const n = await withTransaction((c) => hr.assignRooms(c, req.tenant, { date: isoDate(b.date, 'Date') || property.business_date, employeeId: b.employee_id ? int(b.employee_id, 'Employee', { min: 1 }) : null, roomIds }));
    audit(req, 'hotel.rooms_assigned', 'hk_assignment', null, null, { rooms: n, employee_id: b.employee_id || null });
    ok(res, { assigned: n });
  }
});
