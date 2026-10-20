/*
 * Hotel staff: departments, shifts, employees, the weekly roster, daily attendance, leave, the monthly payroll sheet, and who cleans which room.
 *
 * Attendance is what happened. A day with no attendance row is "not marked": on a weekly off it counts as the weekly off, anywhere else it is flagged in payroll so it is
 * settled before the sheet is finalised, and meanwhile it is paid as present (the cautious mistake: a person is never short-paid because someone forgot to tap).
 *
 * Payroll pay, for a MONTHLY employee: salary x paid days / days in the month, where paid days are present days, half days as half, paid leave, weekly offs and holidays.
 * For a DAILY one: the daily rate x days worked plus paid leave. Overtime is paid at the hourly rate (a day's pay / 8) x the run's overtime factor. Allowances and
 * deductions are typed by hand while the run is a draft. This is a payroll SHEET: PF, ESI, professional tax and TDS are not worked out.
 */
import { HotelError, addDaysISO, daysBetween, getProperty } from './common.js';
import { businessToday } from '../../utils/dates.js';

/** The date the staff screens start on: a hotel's own business date (it moves with the night audit), any other business's calendar day. The same staff engine serves both. */
export const staffToday = async (db, tenant) => (tenant.businessType === 'HOTEL' ? (await getProperty(db, tenant)).business_date : businessToday(tenant.businessId, db));

export const ATT_STATUS = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'UNPAID_LEAVE', 'WEEKLY_OFF', 'HOLIDAY'];
export const LEAVE_KINDS = ['CASUAL', 'SICK', 'PAID', 'UNPAID'];
const DEFAULT_DEPARTMENTS = ['Front office', 'Housekeeping', 'Food and beverage', 'Kitchen', 'Banquet', 'Maintenance', 'Security', 'Accounts', 'Management'];
const DEFAULT_SHIFTS = [['Morning', '07:00', '15:00'], ['Evening', '15:00', '23:00'], ['Night', '23:00', '07:00']];
/* what a new spare parts workshop starts with instead (the lists can be changed freely) */
const PARTS_DEPARTMENTS = ['Workshop', 'Parts counter', 'Stores', 'Accounts', 'Management'];
const PARTS_SHIFTS = [['Day', '09:00', '18:00'], ['Late', '12:00', '21:00']];
const departmentsFor = (tenant) => (tenant.businessType === 'AUTO_PARTS' ? PARTS_DEPARTMENTS : DEFAULT_DEPARTMENTS);
const shiftsFor = (tenant) => (tenant.businessType === 'AUTO_PARTS' ? PARTS_SHIFTS : DEFAULT_SHIFTS);

/* ── departments and shifts ────────────────────────────────────────────── */

export const listDepartments = async (db, tenant) => {
  const has = (await db.query(`SELECT 1 FROM hr_departments WHERE branch_id = $1 LIMIT 1`, [tenant.branchId])).rowCount;
  if (!has) for (const n of departmentsFor(tenant)) await db.query(`INSERT INTO hr_departments (business_id, branch_id, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenant.businessId, tenant.branchId, n]);
  return (await db.query(
    `SELECT d.*, (SELECT COUNT(*) FROM hr_employees e WHERE e.dept_id = d.dept_id AND e.status = 'ACTIVE')::int AS people FROM hr_departments d WHERE d.branch_id = $1 AND d.is_active ORDER BY d.name`, [tenant.branchId])).rows;
};

export const saveDepartment = async (db, tenant, id, name) => {
  if (id) {
    const r = (await db.query(`UPDATE hr_departments SET name = $3 WHERE dept_id = $1 AND branch_id = $2 RETURNING *`, [id, tenant.branchId, name])).rows[0];
    if (!r) throw new HotelError(404, 'Department not found');
    return r;
  }
  return (await db.query(`INSERT INTO hr_departments (business_id, branch_id, name) VALUES ($1,$2,$3) RETURNING *`, [tenant.businessId, tenant.branchId, name])).rows[0];
};

export const archiveDepartment = async (db, tenant, id) => {
  const used = (await db.query(`SELECT 1 FROM hr_employees WHERE dept_id = $1 AND status = 'ACTIVE' LIMIT 1`, [id])).rowCount;
  if (used) throw new HotelError(409, 'People still work in this department');
  const { rowCount } = await db.query(`UPDATE hr_departments SET is_active = FALSE WHERE dept_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Department not found');
};

export const listShifts = async (db, tenant) => {
  const has = (await db.query(`SELECT 1 FROM hr_shifts WHERE branch_id = $1 LIMIT 1`, [tenant.branchId])).rowCount;
  if (!has) for (const [n, s, e] of shiftsFor(tenant)) await db.query(`INSERT INTO hr_shifts (business_id, branch_id, name, start_time, end_time) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [tenant.businessId, tenant.branchId, n, s, e]);
  return (await db.query(`SELECT shift_id, name, start_time::text AS start_time, end_time::text AS end_time FROM hr_shifts WHERE branch_id = $1 AND is_active ORDER BY start_time`, [tenant.branchId])).rows;
};

export const saveShift = async (db, tenant, id, v) => {
  if (id) {
    const r = (await db.query(`UPDATE hr_shifts SET name=$3, start_time=$4, end_time=$5 WHERE shift_id=$1 AND branch_id=$2 RETURNING *`, [id, tenant.branchId, v.name, v.start_time, v.end_time])).rows[0];
    if (!r) throw new HotelError(404, 'Shift not found');
    return r;
  }
  return (await db.query(`INSERT INTO hr_shifts (business_id, branch_id, name, start_time, end_time) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tenant.businessId, tenant.branchId, v.name, v.start_time, v.end_time])).rows[0];
};

export const archiveShift = async (db, tenant, id) => {
  const { rowCount } = await db.query(`UPDATE hr_shifts SET is_active = FALSE WHERE shift_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Shift not found');
};

/* ── employees ─────────────────────────────────────────────────────────── */

const EMP_SQL = `SELECT e.*, e.joined_on::text AS joined_on, e.left_on::text AS left_on, d.name AS department, s.name AS shift_name FROM hr_employees e LEFT JOIN hr_departments d ON d.dept_id = e.dept_id LEFT JOIN hr_shifts s ON s.shift_id = e.default_shift_id`;

export const listEmployees = async (db, tenant, { status = 'ACTIVE', deptId = null, q = null, like, withPay = false }) => {
  const args = [tenant.branchId]; const where = ['e.branch_id = $1'];
  if (status && status !== 'ALL') { args.push(status); where.push(`e.status = $${args.length}`); }
  if (deptId) { args.push(deptId); where.push(`e.dept_id = $${args.length}`); }
  if (q) { args.push(like(q)); where.push(`(lower(e.name) LIKE lower($${args.length}) OR lower(e.emp_code) LIKE lower($${args.length}) OR e.phone LIKE $${args.length})`); }
  const rows = (await db.query(`${EMP_SQL} WHERE ${where.join(' AND ')} ORDER BY d.name NULLS LAST, e.name`, args)).rows;
  return rows.map((r) => (withPay ? r : { ...r, salary_paise: undefined, bank_account: undefined }));
};

export const getEmployee = async (db, tenant, id, { withPay = false } = {}) => {
  const r = (await db.query(`${EMP_SQL} WHERE e.employee_id = $1 AND e.branch_id = $2`, [id, tenant.branchId])).rows[0];
  if (!r) throw new HotelError(404, 'Employee not found');
  return withPay ? r : { ...r, salary_paise: undefined, bank_account: undefined };
};

const nextCode = async (db, tenant) => {
  const n = (await db.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(emp_code, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM hr_employees WHERE branch_id = $1`, [tenant.branchId])).rows[0].n;
  return `E${String(n).padStart(3, '0')}`;
};

const checkRefs = async (db, tenant, v) => {
  if (v.dept_id) { const ok = (await db.query(`SELECT 1 FROM hr_departments WHERE dept_id = $1 AND branch_id = $2`, [v.dept_id, tenant.branchId])).rowCount; if (!ok) throw new HotelError(400, 'Department not found'); }
  if (v.default_shift_id) { const ok = (await db.query(`SELECT 1 FROM hr_shifts WHERE shift_id = $1 AND branch_id = $2`, [v.default_shift_id, tenant.branchId])).rowCount; if (!ok) throw new HotelError(400, 'Shift not found'); }
  if (v.user_id) { const ok = (await db.query(`SELECT 1 FROM business_users WHERE user_id = $1 AND business_id = $2`, [v.user_id, tenant.businessId])).rowCount; if (!ok) throw new HotelError(400, 'That login is not part of this business'); }
};

const COLS = ['name', 'phone', 'email', 'dept_id', 'designation', 'joined_on', 'status', 'pay_type', 'salary_paise', 'weekly_off', 'default_shift_id', 'user_id', 'id_type', 'id_number', 'address', 'emergency_contact', 'bank_account', 'notes'];

export const saveEmployee = async (db, tenant, id, v) => {
  await checkRefs(db, tenant, v);
  if (id) {
    const before = (await db.query(`SELECT * FROM hr_employees WHERE employee_id = $1 AND branch_id = $2 FOR UPDATE`, [id, tenant.branchId])).rows[0];
    if (!before) throw new HotelError(404, 'Employee not found');
    const m = { ...before, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
    const left = m.status === 'INACTIVE' ? (v.left_on || before.left_on || null) : null;
    const { rows } = await db.query(`UPDATE hr_employees SET ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, left_on = $${COLS.length + 3} WHERE employee_id = $1 AND branch_id = $2 RETURNING *`, [id, tenant.branchId, ...COLS.map((c) => m[c] ?? null), left]);
    return rows[0];
  }
  const code = v.emp_code || await nextCode(db, tenant);
  const m = { status: 'ACTIVE', pay_type: 'MONTHLY', salary_paise: 0, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  const { rows } = await db.query(`INSERT INTO hr_employees (business_id, branch_id, emp_code, ${COLS.join(', ')}) VALUES ($1,$2,$3,${COLS.map((_, i) => `$${i + 4}`).join(', ')}) RETURNING *`, [tenant.businessId, tenant.branchId, code, ...COLS.map((c) => m[c] ?? null)]);
  return rows[0];
};

/* ── roster ────────────────────────────────────────────────────────────── */

export const getRoster = async (db, tenant, { from, to, deptId = null }) => {
  if (daysBetween(from, to) > 62) throw new HotelError(400, 'Look at up to 62 days at a time');
  const employees = (await db.query(`SELECT e.employee_id, e.emp_code, e.name, e.designation, e.weekly_off, e.default_shift_id, d.name AS department FROM hr_employees e LEFT JOIN hr_departments d ON d.dept_id = e.dept_id WHERE e.branch_id = $1 AND e.status = 'ACTIVE' ${deptId ? 'AND e.dept_id = $2' : ''} ORDER BY d.name NULLS LAST, e.name`, deptId ? [tenant.branchId, deptId] : [tenant.branchId])).rows;
  const entries = (await db.query(`SELECT employee_id, work_date::text AS work_date, shift_id FROM hr_roster WHERE branch_id = $1 AND work_date >= $2 AND work_date <= $3`, [tenant.branchId, from, to])).rows;
  const leaves = (await db.query(`SELECT employee_id, from_date::text AS from_date, to_date::text AS to_date, kind FROM hr_leaves WHERE branch_id = $1 AND status = 'APPROVED' AND from_date <= $3 AND to_date >= $2`, [tenant.branchId, from, to])).rows;
  return { from, to, shifts: await listShifts(db, tenant), employees, entries, leaves };
};

/** Set shifts: [{ employee_id, work_date, shift_id | null }]. A null shift is a day off. */
export const setRoster = async (client, tenant, entries) => {
  if (!entries.length) return 0;
  if (entries.length > 1000) throw new HotelError(400, 'Send up to 1,000 changes at a time');
  const ids = [...new Set(entries.map((e) => e.employee_id))];
  const ok = (await client.query(`SELECT employee_id FROM hr_employees WHERE branch_id = $1 AND employee_id = ANY($2::int[])`, [tenant.branchId, ids])).rows.length;
  if (ok !== ids.length) throw new HotelError(400, 'One of the employees was not found');
  const shifts = new Set((await client.query(`SELECT shift_id FROM hr_shifts WHERE branch_id = $1`, [tenant.branchId])).rows.map((r) => r.shift_id));
  for (const e of entries) {
    if (e.shift_id != null && !shifts.has(e.shift_id)) throw new HotelError(400, 'Shift not found');
    await client.query(`INSERT INTO hr_roster (business_id, branch_id, employee_id, work_date, shift_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (employee_id, work_date) DO UPDATE SET shift_id = EXCLUDED.shift_id`, [tenant.businessId, tenant.branchId, e.employee_id, e.work_date, e.shift_id ?? null]);
  }
  return entries.length;
};

/** Copy one week's roster onto another (seven days from `from` onto seven days from `to`). */
export const copyWeek = async (client, tenant, { from, to }) => {
  const rows = (await client.query(`SELECT employee_id, work_date::text AS work_date, shift_id FROM hr_roster WHERE branch_id = $1 AND work_date >= $2 AND work_date < $3`, [tenant.branchId, from, addDaysISO(from, 7)])).rows;
  const offset = daysBetween(from, to);
  return setRoster(client, tenant, rows.map((r) => ({ employee_id: r.employee_id, work_date: addDaysISO(r.work_date, offset), shift_id: r.shift_id })));
};

/* ── attendance ────────────────────────────────────────────────────────── */

/** Everyone for one day: what is marked, what the roster says, any approved leave. */
export const attendanceDay = async (db, tenant, date) => {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const rows = (await db.query(
    `SELECT e.employee_id, e.emp_code, e.name, e.designation, e.weekly_off, d.name AS department,
            a.status, a.in_time::text AS in_time, a.out_time::text AS out_time, a.overtime_minutes, a.note,
            s.name AS rostered_shift, s.start_time::text AS shift_start, s.end_time::text AS shift_end, (r.employee_id IS NOT NULL AND r.shift_id IS NULL) AS rostered_off,
            (SELECT l.kind FROM hr_leaves l WHERE l.employee_id = e.employee_id AND l.status = 'APPROVED' AND l.from_date <= $2 AND l.to_date >= $2 LIMIT 1) AS leave_kind
     FROM hr_employees e LEFT JOIN hr_departments d ON d.dept_id = e.dept_id
     LEFT JOIN hr_attendance a ON a.employee_id = e.employee_id AND a.work_date = $2
     LEFT JOIN hr_roster r ON r.employee_id = e.employee_id AND r.work_date = $2 LEFT JOIN hr_shifts s ON s.shift_id = r.shift_id
     WHERE e.branch_id = $1 AND e.status = 'ACTIVE' AND (e.joined_on IS NULL OR e.joined_on <= $2) ORDER BY d.name NULLS LAST, e.name`, [tenant.branchId, date])).rows;
  return { date, rows: rows.map((r) => ({ ...r, weekly_off_today: r.weekly_off === wd })) };
};

/** Mark a day: [{ employee_id, status, in_time?, out_time?, overtime_minutes?, note? }]. An empty status clears the mark. */
export const markAttendance = async (client, tenant, userId, date, entries) => {
  if (!entries.length) return 0;
  const ids = [...new Set(entries.map((e) => e.employee_id))];
  const ok = (await client.query(`SELECT employee_id FROM hr_employees WHERE branch_id = $1 AND employee_id = ANY($2::int[])`, [tenant.branchId, ids])).rows.length;
  if (ok !== ids.length) throw new HotelError(400, 'One of the employees was not found');
  for (const e of entries) {
    if (!e.status) { await client.query(`DELETE FROM hr_attendance WHERE employee_id = $1 AND work_date = $2`, [e.employee_id, date]); continue; }
    if (!ATT_STATUS.includes(e.status)) throw new HotelError(400, 'Choose present, absent, half day, leave or a day off');
    await client.query(
      `INSERT INTO hr_attendance (business_id, branch_id, employee_id, work_date, status, in_time, out_time, overtime_minutes, note, marked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, in_time = EXCLUDED.in_time, out_time = EXCLUDED.out_time, overtime_minutes = EXCLUDED.overtime_minutes, note = EXCLUDED.note, marked_by = EXCLUDED.marked_by, marked_at = CURRENT_TIMESTAMP`,
      [tenant.businessId, tenant.branchId, e.employee_id, date, e.status, e.in_time || null, e.out_time || null, e.overtime_minutes || 0, e.note || null, userId]);
  }
  return entries.length;
};

/** A month: per employee, days of each kind. */
export const attendanceMonth = async (db, tenant, month) => {
  const from = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const end = `${month}-${String(last).padStart(2, '0')}`;
  const rows = (await db.query(
    `SELECT e.employee_id, e.emp_code, e.name, d.name AS department,
            COUNT(*) FILTER (WHERE a.status = 'PRESENT')::int AS present, COUNT(*) FILTER (WHERE a.status = 'HALF_DAY')::int AS half_days, COUNT(*) FILTER (WHERE a.status = 'ABSENT')::int AS absent,
            COUNT(*) FILTER (WHERE a.status = 'LEAVE')::int AS leave, COUNT(*) FILTER (WHERE a.status = 'UNPAID_LEAVE')::int AS unpaid_leave,
            COUNT(*) FILTER (WHERE a.status IN ('WEEKLY_OFF','HOLIDAY'))::int AS off, COALESCE(SUM(a.overtime_minutes), 0)::int AS overtime_minutes
     FROM hr_employees e LEFT JOIN hr_departments d ON d.dept_id = e.dept_id LEFT JOIN hr_attendance a ON a.employee_id = e.employee_id AND a.work_date >= $2 AND a.work_date <= $3
     WHERE e.branch_id = $1 AND e.status = 'ACTIVE' GROUP BY e.employee_id, e.emp_code, e.name, d.name ORDER BY d.name NULLS LAST, e.name`, [tenant.branchId, from, end])).rows;
  return { month, from, to: end, days_in_month: last, rows };
};

/* ── leave ─────────────────────────────────────────────────────────────── */

export const listLeaves = async (db, tenant, { status = null }) =>
  (await db.query(
    `SELECT l.*, l.from_date::text AS from_date, l.to_date::text AS to_date, e.name AS employee, e.emp_code, d.name AS department, u.name AS decided_by_name
     FROM hr_leaves l JOIN hr_employees e ON e.employee_id = l.employee_id LEFT JOIN hr_departments d ON d.dept_id = e.dept_id LEFT JOIN users u ON u.user_id = l.decided_by
     WHERE l.branch_id = $1 ${status ? 'AND l.status = $2' : ''} ORDER BY l.from_date DESC, l.leave_id DESC LIMIT 300`, status ? [tenant.branchId, status] : [tenant.branchId])).rows;

export const requestLeave = async (db, tenant, userId, v) => {
  const e = (await db.query(`SELECT 1 FROM hr_employees WHERE employee_id = $1 AND branch_id = $2 AND status = 'ACTIVE'`, [v.employee_id, tenant.branchId])).rowCount;
  if (!e) throw new HotelError(400, 'Employee not found');
  if (!LEAVE_KINDS.includes(v.kind)) throw new HotelError(400, 'Choose a kind of leave');
  if (daysBetween(v.from_date, v.to_date) > 60) throw new HotelError(400, 'Leave can be up to 60 days at a time');
  const clash = (await db.query(`SELECT 1 FROM hr_leaves WHERE employee_id = $1 AND status IN ('PENDING','APPROVED') AND from_date <= $3 AND to_date >= $2 LIMIT 1`, [v.employee_id, v.from_date, v.to_date])).rowCount;
  if (clash) throw new HotelError(409, 'This person already has leave on some of those days');
  return (await db.query(`INSERT INTO hr_leaves (business_id, branch_id, employee_id, from_date, to_date, kind, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.employee_id, v.from_date, v.to_date, v.kind, v.reason || null, userId])).rows[0];
};

/** Approve or reject. Approving marks every day of the leave in attendance (paid or unpaid), leaving a day already marked present alone. */
export const decideLeave = async (client, tenant, userId, id, { approve, cancel = false }) => {
  const l = (await client.query(`SELECT *, from_date::text AS from_date, to_date::text AS to_date FROM hr_leaves WHERE leave_id = $1 AND branch_id = $2 FOR UPDATE`, [id, tenant.branchId])).rows[0];
  if (!l) throw new HotelError(404, 'Leave not found');
  const status = cancel ? 'CANCELLED' : approve ? 'APPROVED' : 'REJECTED';
  if (cancel ? !['PENDING', 'APPROVED'].includes(l.status) : l.status !== 'PENDING') throw new HotelError(409, cancel ? 'This leave cannot be cancelled' : 'This leave has already been decided');
  await client.query(`UPDATE hr_leaves SET status = $2, decided_by = $3, decided_at = CURRENT_TIMESTAMP WHERE leave_id = $1`, [id, status, userId]);
  const mark = l.kind === 'UNPAID' ? 'UNPAID_LEAVE' : 'LEAVE';
  for (let d = l.from_date; d <= l.to_date; d = addDaysISO(d, 1)) {
    if (status === 'APPROVED') {
      await client.query(`INSERT INTO hr_attendance (business_id, branch_id, employee_id, work_date, status, note, marked_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, marked_by = EXCLUDED.marked_by, marked_at = CURRENT_TIMESTAMP WHERE hr_attendance.status NOT IN ('PRESENT','HALF_DAY')`, [tenant.businessId, tenant.branchId, l.employee_id, d, mark, `${l.kind.toLowerCase()} leave`, userId]);
    } else if (cancel) {
      await client.query(`DELETE FROM hr_attendance WHERE employee_id = $1 AND work_date = $2 AND status IN ('LEAVE','UNPAID_LEAVE')`, [l.employee_id, d]);
    }
  }
  return status;
};

/* ── payroll ───────────────────────────────────────────────────────────── */

const monthEnd = (month) => `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

/** One employee's pay for a month, from their attendance. Pure: the numbers go in, the numbers come out. */
export const computePay = ({ payType, salaryPaise, daysInMonth, counts, overtimeMinutes, overtimeFactor }) => {
  const present = counts.PRESENT + counts.HALF_DAY * 0.5;
  const paidLeave = counts.LEAVE;
  const off = counts.WEEKLY_OFF + counts.HOLIDAY;
  const unpaid = counts.ABSENT + counts.UNPAID_LEAVE + counts.HALF_DAY * 0.5;
  let base; let dayRate;
  if (payType === 'DAILY') { dayRate = salaryPaise; base = Math.round(salaryPaise * (present + paidLeave)); } else { dayRate = salaryPaise / daysInMonth; base = Math.round(salaryPaise * ((present + paidLeave + off) / daysInMonth)); }
  const overtime = Math.round((dayRate / 8) * (overtimeMinutes / 60) * overtimeFactor);
  return { days_present: present, days_paid_leave: paidLeave, days_weekly_off: off, days_unpaid: unpaid, base_pay_paise: base, overtime_pay_paise: overtime };
};

const buildSlip = async (db, tenant, run, e, today) => {
  const month = run.month; const end = monthEnd(month); const days = Number(end.slice(8, 10));
  const from = e.joined_on && e.joined_on > `${month}-01` ? e.joined_on : `${month}-01`;
  let until = e.left_on && e.left_on < end ? e.left_on : end;
  // a month that is not over yet is paid for the days gone: up to yesterday, so a draft shows what has been earned so far
  const yesterday = addDaysISO(today, -1);
  if (until > yesterday) until = yesterday;
  const marks = (await db.query(`SELECT work_date::text AS d, status, overtime_minutes FROM hr_attendance WHERE employee_id = $1 AND work_date >= $2 AND work_date <= $3`, [e.employee_id, from, until])).rows;
  const byDay = new Map(marks.map((m) => [m.d, m]));
  const counts = { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, LEAVE: 0, UNPAID_LEAVE: 0, WEEKLY_OFF: 0, HOLIDAY: 0 };
  let unmarked = 0; let overtime = 0;
  for (let d = from; d <= until; d = addDaysISO(d, 1)) {
    const m = byDay.get(d);
    if (m) { counts[m.status] += 1; overtime += Number(m.overtime_minutes); continue; }
    if (e.weekly_off != null && new Date(`${d}T00:00:00Z`).getUTCDay() === e.weekly_off) counts.WEEKLY_OFF += 1;
    else { unmarked += 1; counts.PRESENT += 1; }   // paid as present until someone settles it
  }
  // the days of the month outside their time here are neither paid nor missed: pay is for the days they were on the books
  const pay = computePay({ payType: e.pay_type, salaryPaise: Number(e.salary_paise), daysInMonth: days, counts, overtimeMinutes: overtime, overtimeFactor: Number(run.overtime_factor) });
  return { ...pay, days_in_month: days, days_unmarked: unmarked, overtime_minutes: overtime };
};

/** Make (or redo, while it is a draft) the month's payroll sheet from attendance. Hand-typed allowances, deductions and notes are kept. */
export const generatePayroll = async (client, tenant, userId, month, { overtimeFactor = 1.5 } = {}) => {
  let run = (await client.query(`SELECT * FROM hr_payroll_runs WHERE branch_id = $1 AND month = $2 FOR UPDATE`, [tenant.branchId, month])).rows[0];
  if (run?.status === 'FINAL') throw new HotelError(409, `Payroll for ${month} has been finalised`);
  if (!run) run = (await client.query(`INSERT INTO hr_payroll_runs (business_id, branch_id, month, overtime_factor, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tenant.businessId, tenant.branchId, month, overtimeFactor, userId])).rows[0];
  else await client.query(`UPDATE hr_payroll_runs SET overtime_factor = $2 WHERE run_id = $1`, [run.run_id, overtimeFactor]);
  run = { ...run, overtime_factor: overtimeFactor };
  const end = monthEnd(month);
  const today = await staffToday(client, tenant);
  const people = (await client.query(
    `SELECT e.*, e.joined_on::text AS joined_on, e.left_on::text AS left_on FROM hr_employees e WHERE e.branch_id = $1 AND (e.joined_on IS NULL OR e.joined_on <= $3) AND (e.left_on IS NULL OR e.left_on >= $2) AND (e.status = 'ACTIVE' OR e.left_on IS NOT NULL) ORDER BY e.name`, [tenant.branchId, `${month}-01`, end])).rows;
  for (const e of people) {
    const s = await buildSlip(client, tenant, run, e, today);
    const old = (await client.query(`SELECT allowances_paise, deductions_paise, note FROM hr_payslips WHERE run_id = $1 AND employee_id = $2`, [run.run_id, e.employee_id])).rows[0];
    const allowances = Number(old?.allowances_paise || 0); const deductions = Number(old?.deductions_paise || 0);
    await client.query(
      `INSERT INTO hr_payslips (run_id, employee_id, pay_type, salary_paise, days_in_month, days_present, days_paid_leave, days_weekly_off, days_unpaid, days_unmarked, overtime_minutes, base_pay_paise, overtime_pay_paise, allowances_paise, deductions_paise, net_pay_paise, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (run_id, employee_id) DO UPDATE SET pay_type = EXCLUDED.pay_type, salary_paise = EXCLUDED.salary_paise, days_in_month = EXCLUDED.days_in_month, days_present = EXCLUDED.days_present, days_paid_leave = EXCLUDED.days_paid_leave,
         days_weekly_off = EXCLUDED.days_weekly_off, days_unpaid = EXCLUDED.days_unpaid, days_unmarked = EXCLUDED.days_unmarked, overtime_minutes = EXCLUDED.overtime_minutes, base_pay_paise = EXCLUDED.base_pay_paise,
         overtime_pay_paise = EXCLUDED.overtime_pay_paise, net_pay_paise = EXCLUDED.net_pay_paise`,
      [run.run_id, e.employee_id, e.pay_type, e.salary_paise, s.days_in_month, s.days_present, s.days_paid_leave, s.days_weekly_off, s.days_unpaid, s.days_unmarked, s.overtime_minutes, s.base_pay_paise, s.overtime_pay_paise, allowances, deductions, s.base_pay_paise + s.overtime_pay_paise + allowances - deductions, old?.note || null]);
  }
  // anyone no longer on the books that month has no slip
  await client.query(`DELETE FROM hr_payslips WHERE run_id = $1 AND employee_id <> ALL($2::int[])`, [run.run_id, people.map((p) => p.employee_id)]);
  return run.run_id;
};

export const listRuns = async (db, tenant) =>
  (await db.query(
    `SELECT r.*, COALESCE((SELECT SUM(net_pay_paise) FROM hr_payslips p WHERE p.run_id = r.run_id), 0)::bigint AS total_paise, (SELECT COUNT(*) FROM hr_payslips p WHERE p.run_id = r.run_id)::int AS people
     FROM hr_payroll_runs r WHERE r.branch_id = $1 ORDER BY r.month DESC`, [tenant.branchId])).rows;

export const getRun = async (db, tenant, month) => {
  const run = (await db.query(`SELECT * FROM hr_payroll_runs WHERE branch_id = $1 AND month = $2`, [tenant.branchId, month])).rows[0];
  if (!run) return null;
  const slips = (await db.query(
    `SELECT p.*, e.name, e.emp_code, e.designation, e.bank_account, d.name AS department FROM hr_payslips p JOIN hr_employees e ON e.employee_id = p.employee_id LEFT JOIN hr_departments d ON d.dept_id = e.dept_id WHERE p.run_id = $1 ORDER BY d.name NULLS LAST, e.name`, [run.run_id])).rows;
  return { ...run, slips, total_paise: slips.reduce((s, p) => s + Number(p.net_pay_paise), 0), unmarked_days: slips.reduce((s, p) => s + Number(p.days_unmarked), 0) };
};

export const adjustSlip = async (client, tenant, slipId, { allowances_paise, deductions_paise, note }) => {
  const s = (await client.query(`SELECT p.*, r.status FROM hr_payslips p JOIN hr_payroll_runs r ON r.run_id = p.run_id WHERE p.payslip_id = $1 AND r.branch_id = $2 FOR UPDATE OF p`, [slipId, tenant.branchId])).rows[0];
  if (!s) throw new HotelError(404, 'Payslip not found');
  if (s.status === 'FINAL') throw new HotelError(409, 'This payroll has been finalised');
  const a = allowances_paise ?? Number(s.allowances_paise); const d = deductions_paise ?? Number(s.deductions_paise);
  await client.query(`UPDATE hr_payslips SET allowances_paise = $2, deductions_paise = $3, net_pay_paise = base_pay_paise + overtime_pay_paise + $2 - $3, note = $4 WHERE payslip_id = $1`, [slipId, a, d, note === undefined ? s.note : note]);
};

export const finalizeRun = async (client, tenant, userId, month, { force = false } = {}) => {
  const run = (await client.query(`SELECT * FROM hr_payroll_runs WHERE branch_id = $1 AND month = $2 FOR UPDATE`, [tenant.branchId, month])).rows[0];
  if (!run) throw new HotelError(404, 'Make the payroll sheet first');
  if (run.status === 'FINAL') throw new HotelError(409, 'This payroll has already been finalised');
  const unmarked = Number((await client.query(`SELECT COALESCE(SUM(days_unmarked), 0) AS n FROM hr_payslips WHERE run_id = $1`, [run.run_id])).rows[0].n);
  if (unmarked > 0 && !force) throw new HotelError(409, `${unmarked} day${unmarked === 1 ? '' : 's'} have no attendance marked. They are paid as present. Mark them first, or finalise anyway.`, { code: 'UNMARKED_DAYS', data: { unmarked_days: unmarked } });
  await client.query(`UPDATE hr_payroll_runs SET status = 'FINAL', finalized_by = $2, finalized_at = CURRENT_TIMESTAMP WHERE run_id = $1`, [run.run_id, userId]);
};

/* ── who cleans which room ─────────────────────────────────────────────── */

export const assignRooms = async (client, tenant, { date, employeeId, roomIds }) => {
  if (employeeId != null) {
    const e = (await client.query(`SELECT 1 FROM hr_employees WHERE employee_id = $1 AND branch_id = $2 AND status = 'ACTIVE'`, [employeeId, tenant.branchId])).rowCount;
    if (!e) throw new HotelError(400, 'Employee not found');
  }
  const rooms = (await client.query(`SELECT room_id FROM rooms WHERE branch_id = $1 AND room_id = ANY($2::int[])`, [tenant.branchId, roomIds])).rows.length;
  if (rooms !== roomIds.length) throw new HotelError(400, 'One of the rooms was not found');
  for (const roomId of roomIds) {
    if (employeeId == null) await client.query(`DELETE FROM hk_assignments WHERE room_id = $1 AND work_date = $2`, [roomId, date]);
    else await client.query(`INSERT INTO hk_assignments (business_id, branch_id, room_id, employee_id, work_date) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (room_id, work_date) DO UPDATE SET employee_id = EXCLUDED.employee_id`, [tenant.businessId, tenant.branchId, roomId, employeeId, date]);
  }
  return roomIds.length;
};

export const listAssignments = async (db, tenant, date) =>
  (await db.query(`SELECT a.room_id, a.employee_id, e.name AS employee FROM hk_assignments a JOIN hr_employees e ON e.employee_id = a.employee_id WHERE a.branch_id = $1 AND a.work_date = $2`, [tenant.branchId, date])).rows;

/** People in housekeeping who could be given rooms. */
export const housekeepers = async (db, tenant) =>
  (await db.query(`SELECT e.employee_id, e.name FROM hr_employees e JOIN hr_departments d ON d.dept_id = e.dept_id WHERE e.branch_id = $1 AND e.status = 'ACTIVE' AND lower(d.name) = 'housekeeping' ORDER BY e.name`, [tenant.branchId])).rows;

/* ── a few numbers for the staff screen ────────────────────────────────── */

export const headcount = async (db, tenant, date) => {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  const byDept = (await db.query(`SELECT COALESCE(d.name, 'No department') AS department, COUNT(*)::int AS people FROM hr_employees e LEFT JOIN hr_departments d ON d.dept_id = e.dept_id WHERE e.branch_id = $1 AND e.status = 'ACTIVE' GROUP BY 1 ORDER BY 1`, [tenant.branchId])).rows;
  const today = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE a.status IN ('PRESENT','HALF_DAY'))::int AS present, COUNT(*) FILTER (WHERE a.status = 'ABSENT')::int AS absent, COUNT(*) FILTER (WHERE a.status IN ('LEAVE','UNPAID_LEAVE'))::int AS on_leave,
            COUNT(*) FILTER (WHERE a.status IS NULL AND NOT (e.weekly_off = $3))::int AS unmarked
     FROM hr_employees e LEFT JOIN hr_attendance a ON a.employee_id = e.employee_id AND a.work_date = $2 WHERE e.branch_id = $1 AND e.status = 'ACTIVE'`, [tenant.branchId, date, wd])).rows[0];
  const pending = (await db.query(`SELECT COUNT(*)::int AS n FROM hr_leaves WHERE branch_id = $1 AND status = 'PENDING'`, [tenant.branchId])).rows[0].n;
  return { date, total: byDept.reduce((s, d) => s + d.people, 0), by_department: byDept, ...today, pending_leaves: pending };
};
