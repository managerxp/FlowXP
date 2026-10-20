/* Staff of a spare parts shop and workshop on the phone: the people (mechanics, counter staff), who turned up today, and the monthly payroll sheet. The same engine a hotel uses
   (/api/autoparts/staff); the server works out the pay. Pay is only sent or shown to someone with the payroll right. */
import { t } from './i18n.ts';
import { rupees } from './money.ts';

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const canStaff = (can: (p: string) => boolean): boolean => can('hr') || can('payroll');

export type Person = { employee_id: number; emp_code: string; name: string; phone: string | null; designation: string | null; department: string | null; dept_id: number | null; status: string; pay_type: string; salary_paise?: number; joined_on: string | null; weekly_off: number | null };
export type PersonForm = { name: string; phone: string; designation: string; dept_id: string; pay_type: string; salary: string; joined_on: string; weekly_off: string; status: string };
export const emptyPerson = (): PersonForm => ({ name: '', phone: '', designation: '', dept_id: '', pay_type: 'MONTHLY', salary: '', joined_on: '', weekly_off: '', status: 'ACTIVE' });
export const personForm = (p: Person): PersonForm => ({
  name: p.name, phone: p.phone ?? '', designation: p.designation ?? '', dept_id: p.dept_id ? String(p.dept_id) : '', pay_type: p.pay_type, salary: p.salary_paise == null ? '' : String(p.salary_paise / 100), joined_on: p.joined_on ?? '',
  weekly_off: p.weekly_off == null ? '' : String(p.weekly_off), status: p.status
});
export const personProblem = (f: PersonForm, withPay: boolean): string => {
  if (f.name.trim().length < 2) return 'Give the person a name';
  if (f.phone.trim() && !/^[\d +-]{7,15}$/.test(f.phone.trim())) return 'That phone number does not look right';
  if (f.joined_on.trim() && !isDate(f.joined_on.trim())) return 'Dates are written like 2026-11-01';
  if (withPay && f.salary.trim() && !(Number.isFinite(Number(f.salary)) && Number(f.salary) >= 0)) return 'The pay is an amount in rupees';
  return '';
};
/** The salary goes only when the person may set pay (the server refuses it otherwise). */
export const personBody = (f: PersonForm, withPay: boolean, editing: boolean) => ({
  name: f.name.trim(), phone: f.phone.trim() || null, designation: f.designation.trim() || null, dept_id: f.dept_id ? Number(f.dept_id) : null, pay_type: f.pay_type, joined_on: f.joined_on.trim() || null,
  weekly_off: f.weekly_off === '' ? null : Number(f.weekly_off), ...(editing ? { status: f.status } : {}), ...(withPay && f.salary.trim() ? { salary: Number(f.salary) } : {})
});
export const WEEKLY_OFF_CHOICES: { id: string; label: string }[] = [{ id: '', label: 'None' }, { id: '0', label: 'Sunday' }, { id: '1', label: 'Monday' }, { id: '2', label: 'Tuesday' }, { id: '3', label: 'Wednesday' }, { id: '4', label: 'Thursday' }, { id: '5', label: 'Friday' }, { id: '6', label: 'Saturday' }];
export const PAY_TYPE_CHOICES: { id: string; label: string }[] = [{ id: 'MONTHLY', label: 'Monthly salary' }, { id: 'DAILY', label: 'Daily wage' }];
export const personSub = (p: Person): string => [p.designation || '', p.department || '', p.phone || '', p.salary_paise != null && p.salary_paise > 0 ? t(p.pay_type === 'DAILY' ? '{value} a day' : '{value} a month', { value: rupees(p.salary_paise) }) : '', p.status === 'INACTIVE' ? t('Inactive') : ''].filter(Boolean).join(' · ');

/* ── attendance ──────────────────────────────────────────────────────────── */
export const MARKS: { id: string; label: string }[] = [{ id: 'PRESENT', label: 'Present' }, { id: 'ABSENT', label: 'Absent' }, { id: 'HALF_DAY', label: 'Half day' }, { id: 'LEAVE', label: 'On leave' }];
export type DayRow = { employee_id: number; name: string; designation: string | null; status: string | null; weekly_off_today: boolean; leave_kind: string | null };
export const markLabel = (status: string | null): string => (status ? t(MARKS.find((m) => m.id === status)?.label ?? status.toLowerCase().replace(/_/g, ' ')) : t('Not marked'));
export const markBody = (date: string, employeeId: number, status: string) => ({ date, entries: [{ employee_id: employeeId, status }] });
export const dayCounts = (rows: DayRow[]): string => t('{present} present, {absent} absent, {open} not marked', { present: rows.filter((r) => r.status === 'PRESENT' || r.status === 'HALF_DAY').length, absent: rows.filter((r) => r.status === 'ABSENT').length, open: rows.filter((r) => !r.status).length });

/* ── payroll ─────────────────────────────────────────────────────────────── */
export type Slip = { payslip_id: number; employee_id: number; name: string; designation: string | null; net_pay_paise: number; base_pay_paise: number; allowances_paise: number; deductions_paise: number; days_present: number; days_unmarked: number; note: string | null };
/** The server answers a month with no sheet yet as { status: null, slips: [] }, not as nothing. */
export type Run = { month: string; status: 'DRAFT' | 'FINAL' | null; slips: Slip[]; total_paise: number; unmarked_days: number } | null;
export type MadeRun = NonNullable<Run> & { status: 'DRAFT' | 'FINAL' };
export const madeRun = (r: Run): MadeRun | null => (r && r.status ? (r as MadeRun) : null);
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);
export const shiftMonth = (month: string, by: number): string => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const slipSub = (s: Slip): string => [t('{n} days present', { n: s.days_present }), s.allowances_paise ? t('+{value} extra', { value: rupees(s.allowances_paise) }) : '', s.deductions_paise ? t('-{value} taken off', { value: rupees(s.deductions_paise) }) : '', s.days_unmarked ? t('{n} days not marked', { n: s.days_unmarked }) : ''].filter(Boolean).join(' · ');
export const runLine = (r: MadeRun): string => `${t(r.status === 'FINAL' ? 'Final' : 'Draft')} · ${t('Total {value}', { value: rupees(r.total_paise) })}`;
export const adjustProblem = (allowances: string, deductions: string): string => ([allowances, deductions].every((v) => v.trim() === '' || (Number.isFinite(Number(v)) && Number(v) >= 0)) ? '' : 'Extra and taken-off amounts are amounts in rupees');
export const adjustBody = (allowances: string, deductions: string, note: string) => ({ allowances: allowances.trim() === '' ? 0 : Number(allowances), deductions: deductions.trim() === '' ? 0 : Number(deductions), note: note.trim() || undefined });
export const slipForm = (s: Slip) => ({ allowances: s.allowances_paise ? String(s.allowances_paise / 100) : '', deductions: s.deductions_paise ? String(s.deductions_paise / 100) : '', note: s.note ?? '' });
export const unmarkedWarning = (r: MadeRun): string => (r.unmarked_days > 0 ? t('{n} days are not marked yet. Unmarked days are not paid until they are.', { n: r.unmarked_days }) : '');

export const WORKSHOP_STAFF_TEXTS: string[] = [
  'Give the person a name', 'That phone number does not look right', 'Dates are written like 2026-11-01', 'The pay is an amount in rupees', 'None', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  'Monthly salary', 'Daily wage', '{value} a day', '{value} a month', 'Inactive', 'Present', 'Absent', 'Half day', 'On leave', 'Not marked', '{present} present, {absent} absent, {open} not marked',
  '{n} days present', '+{value} extra', '-{value} taken off', '{n} days not marked', 'Final', 'Draft', 'Total {value}', 'Extra and taken-off amounts are amounts in rupees', '{n} days are not marked yet. Unmarked days are not paid until they are.',
  'Staff', 'People, attendance and payroll for your workshop and counter', 'You do not have access to staff.', 'People', 'Attendance', 'Payroll', 'Add a person', 'Add your mechanics and counter staff.', 'Name', 'Phone', 'Job title', 'Mechanic, counter, storekeeper',
  'Department', 'Pay', 'Pay in rupees', 'Joined on', 'Like 2026-11-01', 'Weekly day off', 'Active', 'Save', 'Cancel', 'Saved', 'Today', 'Mark each person who turned up.', 'Nobody to mark.', 'Earlier month', 'Later month', 'Make the payroll sheet',
  'Nothing has been made for this month yet.', 'Make it from the attendance marked so far. You can change a payslip until the month is final.', 'Make it again', 'Make it final', 'Make the payroll final?', 'A final sheet cannot be changed.', 'Payroll is final', 'Extra', 'Taken off', 'Note', 'Save the payslip'
];
