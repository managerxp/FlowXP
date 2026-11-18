/*
 * Payroll on top of the staff records: settings and professional tax slabs, each employee's pay profile, loans and advances, the monthly run with PF, ESI, professional tax,
 * TDS and loan recovery on every payslip, paying the run, and the files (bank transfer, PF, ESI, professional tax, register).
 * Attendance, leave and the base pay come from modules/hr/staff.js; the arithmetic is in ./statutory.js.
 */
import { HrError } from '../hr/common.js';
import * as hr from '../hr/staff.js';
import { csv } from '../accountantPack.js';
import { ptPresetSlabs, slipAmounts } from './statutory.js';

const SETTINGS_DEFAULTS = {
  pf_enabled: false, pf_cap_on_ceiling: true, pf_ceiling_paise: 1500000, esi_enabled: false, esi_ceiling_paise: 2100000, pt_enabled: false, pt_state: null,
  default_basic_pct: 50, overtime_factor: 1.5, establishment_pf_code: null, establishment_esi_code: null
};
const SLAB_COLS = ['from_paise', 'to_paise', 'tax_paise', 'february_paise'];

/* ── settings and professional tax slabs ───────────────────────────────── */

export const getSettings = async (db, businessId) => {
  const row = (await db.query(`SELECT * FROM payroll_settings WHERE business_id = $1`, [businessId])).rows[0];
  const slabs = (await db.query(`SELECT slab_id, from_paise, to_paise, tax_paise, february_paise FROM payroll_pt_slabs WHERE business_id = $1 ORDER BY from_paise`, [businessId])).rows;
  return { ...SETTINGS_DEFAULTS, ...(row || {}), slabs };
};

/** Save the switches and rates; `slabs` (when given) replaces the professional tax slabs, and `preset` fills them in from the state's usual ones. */
export const saveSettings = async (client, businessId, v) => {
  const cur = await getSettings(client, businessId);
  const m = { ...cur, ...Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && k !== 'slabs')) };
  await client.query(
    `INSERT INTO payroll_settings (business_id, pf_enabled, pf_cap_on_ceiling, pf_ceiling_paise, esi_enabled, esi_ceiling_paise, pt_enabled, pt_state, default_basic_pct, overtime_factor, establishment_pf_code, establishment_esi_code, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP)
     ON CONFLICT (business_id) DO UPDATE SET pf_enabled = EXCLUDED.pf_enabled, pf_cap_on_ceiling = EXCLUDED.pf_cap_on_ceiling, pf_ceiling_paise = EXCLUDED.pf_ceiling_paise, esi_enabled = EXCLUDED.esi_enabled,
       esi_ceiling_paise = EXCLUDED.esi_ceiling_paise, pt_enabled = EXCLUDED.pt_enabled, pt_state = EXCLUDED.pt_state, default_basic_pct = EXCLUDED.default_basic_pct, overtime_factor = EXCLUDED.overtime_factor,
       establishment_pf_code = EXCLUDED.establishment_pf_code, establishment_esi_code = EXCLUDED.establishment_esi_code, updated_at = CURRENT_TIMESTAMP`,
    [businessId, m.pf_enabled, m.pf_cap_on_ceiling, m.pf_ceiling_paise, m.esi_enabled, m.esi_ceiling_paise, m.pt_enabled, m.pt_state, m.default_basic_pct, m.overtime_factor, m.establishment_pf_code, m.establishment_esi_code]
  );
  let slabs = v.slabs;
  if (v.preset) {
    slabs = ptPresetSlabs(m.pt_state);
    if (!slabs) throw new HrError(400, `There are no usual professional tax slabs saved for ${m.pt_state || 'that state'}. Add the slabs by hand.`);
  }
  if (slabs) {
    const ordered = [...slabs].sort((a, b) => a.from_paise - b.from_paise);
    ordered.forEach((s, i) => { if (i && ordered[i - 1].to_paise != null && s.from_paise <= ordered[i - 1].to_paise) throw new HrError(400, 'The tax slabs overlap. Each one must start after the one before ends.'); });
    await client.query(`DELETE FROM payroll_pt_slabs WHERE business_id = $1`, [businessId]);
    for (const s of ordered) await client.query(`INSERT INTO payroll_pt_slabs (business_id, ${SLAB_COLS.join(', ')}) VALUES ($1,$2,$3,$4,$5)`, [businessId, s.from_paise, s.to_paise ?? null, s.tax_paise, s.february_paise ?? null]);
  }
  return getSettings(client, businessId);
};

/* ── each employee's pay profile ───────────────────────────────────────── */

export const listProfiles = async (db, tenant) =>
  (await db.query(
    `SELECT e.employee_id, e.emp_code, e.name, e.designation, e.status, e.pay_type, e.salary_paise, e.bank_account,
            p.basic_paise, COALESCE(p.hra_paise, 0) AS hra_paise, COALESCE(p.pf_applicable, FALSE) AS pf_applicable, COALESCE(p.esi_applicable, FALSE) AS esi_applicable,
            COALESCE(p.pt_applicable, TRUE) AS pt_applicable, p.pan, p.uan, p.esi_number, p.ifsc, p.gender, COALESCE(p.tds_monthly_paise, 0) AS tds_monthly_paise,
            COALESCE((SELECT SUM(principal_paise - recovered_paise) FROM payroll_loans l WHERE l.employee_id = e.employee_id AND l.status = 'ACTIVE'), 0)::bigint AS loan_outstanding_paise
     FROM hr_employees e LEFT JOIN payroll_profiles p ON p.employee_id = e.employee_id WHERE e.branch_id = $1 AND e.status = 'ACTIVE' ORDER BY e.name`, [tenant.branchId])).rows;

export const saveProfile = async (client, tenant, employeeId, v) => {
  const e = (await client.query(`SELECT employee_id FROM hr_employees WHERE employee_id = $1 AND branch_id = $2`, [employeeId, tenant.branchId])).rows[0];
  if (!e) throw new HrError(404, 'Employee not found');
  const cur = (await client.query(`SELECT * FROM payroll_profiles WHERE employee_id = $1`, [employeeId])).rows[0] || {};
  const m = { basic_paise: null, hra_paise: 0, pf_applicable: false, esi_applicable: false, pt_applicable: true, tds_monthly_paise: 0, ...cur, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  await client.query(
    `INSERT INTO payroll_profiles (employee_id, business_id, basic_paise, hra_paise, pf_applicable, esi_applicable, pt_applicable, pan, uan, esi_number, ifsc, gender, tds_monthly_paise, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)
     ON CONFLICT (employee_id) DO UPDATE SET basic_paise = EXCLUDED.basic_paise, hra_paise = EXCLUDED.hra_paise, pf_applicable = EXCLUDED.pf_applicable, esi_applicable = EXCLUDED.esi_applicable,
       pt_applicable = EXCLUDED.pt_applicable, pan = EXCLUDED.pan, uan = EXCLUDED.uan, esi_number = EXCLUDED.esi_number, ifsc = EXCLUDED.ifsc, gender = EXCLUDED.gender,
       tds_monthly_paise = EXCLUDED.tds_monthly_paise, updated_at = CURRENT_TIMESTAMP`,
    [employeeId, tenant.businessId, m.basic_paise ?? null, m.hra_paise, m.pf_applicable, m.esi_applicable, m.pt_applicable, m.pan ?? null, m.uan ?? null, m.esi_number ?? null, m.ifsc ?? null, m.gender ?? null, m.tds_monthly_paise]
  );
  return (await listProfiles(client, tenant)).find((p) => p.employee_id === employeeId);
};

/* ── the books: what payroll puts into expenses ────────────────────────── */

const EXPENSE_METHOD = { BANK: 'BANK_TRANSFER', CASH: 'CASH', UPI: 'UPI' };
const expense = async (client, tenant, userId, { category, amountPaise, method, date, description }) =>
  (await client.query(
    `INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, expense_date, description, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING expense_id`,
    [tenant.businessId, tenant.branchId, category, amountPaise, EXPENSE_METHOD[method] || method || 'CASH', date, description, userId])).rows[0].expense_id;

/* ── loans and advances ────────────────────────────────────────────────── */

export const listLoans = async (db, tenant, { employeeId = null } = {}) =>
  (await db.query(
    `SELECT l.*, l.taken_on::text AS taken_on, e.name, e.emp_code, (l.principal_paise - l.recovered_paise) AS outstanding_paise
     FROM payroll_loans l JOIN hr_employees e ON e.employee_id = l.employee_id WHERE e.branch_id = $1 AND ($2::int IS NULL OR l.employee_id = $2) ORDER BY l.status, l.taken_on DESC, l.loan_id DESC`, [tenant.branchId, employeeId])).rows;

export const addLoan = async (client, tenant, v, userId = null) => {
  const e = (await client.query(`SELECT employee_id FROM hr_employees WHERE employee_id = $1 AND branch_id = $2`, [v.employee_id, tenant.branchId])).rows[0];
  if (!e) throw new HrError(404, 'Employee not found');
  if (v.emi_paise > v.principal_paise) throw new HrError(400, 'The instalment cannot be more than the amount given');
  // the money leaves the business now, so it is recorded now; the instalments later come off the pay, so less salary is paid out then
  const expenseId = v.record_expense === false ? null : await expense(client, tenant, userId, {
    category: 'Staff advances', amountPaise: v.principal_paise, method: v.method || 'CASH', date: v.taken_on, description: `${v.kind === 'LOAN' ? 'Loan' : 'Advance'} to an employee${v.note ? `: ${v.note}` : ''}`
  });
  return (await client.query(
    `INSERT INTO payroll_loans (business_id, employee_id, kind, principal_paise, emi_paise, taken_on, note, expense_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenant.businessId, v.employee_id, v.kind || 'ADVANCE', v.principal_paise, v.emi_paise, v.taken_on, v.note || null, expenseId])).rows[0];
};

export const closeLoan = async (client, tenant, loanId) => {
  const r = (await client.query(`UPDATE payroll_loans l SET status = 'CLOSED' FROM hr_employees e WHERE l.loan_id = $1 AND e.employee_id = l.employee_id AND e.branch_id = $2 RETURNING l.loan_id`, [loanId, tenant.branchId])).rows[0];
  if (!r) throw new HrError(404, 'Loan not found');
};

/* ── the run ───────────────────────────────────────────────────────────── */

const loanDue = async (db, employeeId) =>
  Number((await db.query(`SELECT COALESCE(SUM(LEAST(emi_paise, principal_paise - recovered_paise)), 0) AS due FROM payroll_loans WHERE employee_id = $1 AND status = 'ACTIVE'`, [employeeId])).rows[0].due);

/** Work out one payslip's statutory amounts, loan recovery and net pay from its earnings, and save them. Only while the run is a draft. */
export const recomputeSlip = async (client, tenant, slipId, ctx = null) => {
  const s = (await client.query(
    `SELECT p.*, r.month, r.status AS run_status, e.pay_type AS emp_pay_type FROM hr_payslips p JOIN hr_payroll_runs r ON r.run_id = p.run_id JOIN hr_employees e ON e.employee_id = p.employee_id
     WHERE p.payslip_id = $1 AND r.branch_id = $2 FOR UPDATE OF p`, [slipId, tenant.branchId])).rows[0];
  if (!s) throw new HrError(404, 'Payslip not found');
  if (s.run_status === 'FINAL') throw new HrError(409, 'This payroll has been finalised');
  const settings = ctx?.settings || await getSettings(client, tenant.businessId);
  const profile = (await client.query(`SELECT * FROM payroll_profiles WHERE employee_id = $1`, [s.employee_id])).rows[0] || null;
  const a = slipAmounts({
    salaryPaise: s.salary_paise, payType: s.pay_type, earned: { base: s.base_pay_paise, overtime: s.overtime_pay_paise, allowances: s.allowances_paise },
    profile, settings, slabs: settings.slabs, month: s.month, deductionsPaise: s.deductions_paise, loanDuePaise: await loanDue(client, s.employee_id)
  });
  await client.query(
    `UPDATE hr_payslips SET basic_paise = $2, hra_paise = $3, gross_paise = $4, pf_employee_paise = $5, pf_employer_paise = $6, pf_admin_paise = $7, esi_employee_paise = $8, esi_employer_paise = $9,
       pt_paise = $10, tds_paise = $11, loan_recovery_paise = $12, net_pay_paise = $13, pf_wages_paise = $14 WHERE payslip_id = $1`,
    [slipId, a.basic_paise, a.hra_paise, a.gross_paise, a.pf_employee_paise, a.pf_employer_paise, a.pf_admin_paise, a.esi_employee_paise, a.esi_employer_paise, a.pt_paise, a.tds_paise, a.loan_recovery_paise, a.net_pay_paise, a.pf_wages_paise]
  );
};

/** Make (or redo, while it is a draft) the month's payroll: the attendance sheet first, then every slip's deductions. Typed allowances and deductions are kept. */
export const generateRun = async (client, tenant, userId, month) => {
  const settings = await getSettings(client, tenant.businessId);
  const runId = await hr.generatePayroll(client, tenant, userId, month, { overtimeFactor: Number(settings.overtime_factor) });
  const slips = (await client.query(`SELECT payslip_id FROM hr_payslips WHERE run_id = $1`, [runId])).rows;
  for (const s of slips) await recomputeSlip(client, tenant, s.payslip_id, { settings });
  return runId;
};

export const adjustSlip = async (client, tenant, slipId, v) => {
  await hr.adjustSlip(client, tenant, slipId, v);
  await recomputeSlip(client, tenant, slipId);
};

/** Finalise: lock the run, and take each slip's loan recovery off the loans (oldest first), closing a loan that is fully paid. */
export const finalizeRun = async (client, tenant, userId, month, opts) => {
  await hr.finalizeRun(client, tenant, userId, month, opts);
  const slips = (await client.query(
    `SELECT p.employee_id, p.loan_recovery_paise FROM hr_payslips p JOIN hr_payroll_runs r ON r.run_id = p.run_id WHERE r.branch_id = $1 AND r.month = $2 AND p.loan_recovery_paise > 0`, [tenant.branchId, month])).rows;
  for (const s of slips) {
    let left = Number(s.loan_recovery_paise);
    const loans = (await client.query(`SELECT loan_id, principal_paise, recovered_paise FROM payroll_loans WHERE employee_id = $1 AND status = 'ACTIVE' ORDER BY taken_on, loan_id FOR UPDATE`, [s.employee_id])).rows;
    for (const l of loans) {
      if (left <= 0) break;
      const take = Math.min(left, Number(l.principal_paise) - Number(l.recovered_paise));
      left -= take;
      const done = Number(l.recovered_paise) + take >= Number(l.principal_paise);
      await client.query(`UPDATE payroll_loans SET recovered_paise = recovered_paise + $2, status = $3 WHERE loan_id = $1`, [l.loan_id, take, done ? 'CLOSED' : 'ACTIVE']);
    }
  }
};

/** Pay the staff: what the run owes them (net pay) goes into expenses as "Salaries", once, on the day paid, by the method used. */
export const markPaid = async (client, tenant, month, { paidOn, via }, userId = null) => {
  const run = (await client.query(`SELECT * FROM hr_payroll_runs WHERE branch_id = $1 AND month = $2 FOR UPDATE`, [tenant.branchId, month])).rows[0];
  if (!run) throw new HrError(404, 'There is no payroll for that month');
  if (run.status !== 'FINAL') throw new HrError(409, 'Finalise the payroll before marking it paid');
  if (run.paid_on) throw new HrError(409, 'This payroll is already marked as paid');
  const net = Number((await client.query(`SELECT COALESCE(SUM(net_pay_paise), 0) AS n FROM hr_payslips WHERE run_id = $1`, [run.run_id])).rows[0].n);
  const expenseId = net > 0 ? await expense(client, tenant, userId, { category: 'Salaries', amountPaise: net, method: via, date: paidOn, description: `Salaries for ${month}` }) : null;
  await client.query(`UPDATE hr_payroll_runs SET paid_on = $2, paid_via = $3, salary_expense_id = $4 WHERE run_id = $1`, [run.run_id, paidOn, via, expenseId]);
};

/** Deposit what was held back and what the employer owes: PF, ESI, professional tax and TDS go into expenses as one "Payroll taxes and contributions", once. */
export const payDues = async (client, tenant, month, { paidOn, via }, userId = null) => {
  const run = (await client.query(`SELECT * FROM hr_payroll_runs WHERE branch_id = $1 AND month = $2 FOR UPDATE`, [tenant.branchId, month])).rows[0];
  if (!run) throw new HrError(404, 'There is no payroll for that month');
  if (run.status !== 'FINAL') throw new HrError(409, 'Finalise the payroll first');
  if (run.dues_paid_on) throw new HrError(409, 'The PF, ESI and tax for this month are already recorded as deposited');
  const due = Number((await client.query(
    `SELECT COALESCE(SUM(pf_employee_paise + pf_employer_paise + pf_admin_paise + esi_employee_paise + esi_employer_paise + pt_paise + tds_paise), 0) AS n FROM hr_payslips WHERE run_id = $1`, [run.run_id])).rows[0].n);
  if (due <= 0) throw new HrError(409, 'There is no PF, ESI, professional tax or TDS to deposit for this month');
  const expenseId = await expense(client, tenant, userId, { category: 'Payroll taxes and contributions', amountPaise: due, method: via, date: paidOn, description: `PF, ESI, professional tax and TDS for ${month}` });
  await client.query(`UPDATE hr_payroll_runs SET dues_paid_on = $2, dues_expense_id = $3 WHERE run_id = $1`, [run.run_id, paidOn, expenseId]);
};

/** The run with each slip's person details, and the totals the screen shows. */
export const getRun = async (db, tenant, month) => {
  const run = (await db.query(`SELECT *, paid_on::text AS paid_on, dues_paid_on::text AS dues_paid_on FROM hr_payroll_runs WHERE branch_id = $1 AND month = $2`, [tenant.branchId, month])).rows[0];
  if (!run) return null;
  const slips = (await db.query(
    `SELECT p.*, e.name, e.emp_code, e.designation, e.bank_account, pr.pan, pr.uan, pr.esi_number, pr.ifsc, d.name AS department
     FROM hr_payslips p JOIN hr_employees e ON e.employee_id = p.employee_id LEFT JOIN payroll_profiles pr ON pr.employee_id = p.employee_id LEFT JOIN hr_departments d ON d.dept_id = e.dept_id
     WHERE p.run_id = $1 ORDER BY e.name`, [run.run_id])).rows;
  const sum = (k) => slips.reduce((n, s) => n + Number(s[k]), 0);
  return {
    ...run, slips,
    totals: {
      gross_paise: sum('gross_paise'), net_pay_paise: sum('net_pay_paise'), pf_employee_paise: sum('pf_employee_paise'), pf_employer_paise: sum('pf_employer_paise'), pf_admin_paise: sum('pf_admin_paise'),
      esi_employee_paise: sum('esi_employee_paise'), esi_employer_paise: sum('esi_employer_paise'), pt_paise: sum('pt_paise'), tds_paise: sum('tds_paise'), loan_recovery_paise: sum('loan_recovery_paise'),
      employer_cost_paise: sum('gross_paise') + sum('pf_employer_paise') + sum('pf_admin_paise') + sum('esi_employer_paise')
    },
    unmarked_days: sum('days_unmarked')
  };
};

/* ── the files ─────────────────────────────────────────────────────────── */

const rupees = (p) => (Number(p) / 100).toFixed(2);

/** kind: BANK (the transfer sheet), PF, ESI, PT, REGISTER. Returns { filename, csv }. */
export const exportFile = async (db, tenant, month, kind) => {
  const run = await getRun(db, tenant, month);
  if (!run) throw new HrError(404, 'There is no payroll for that month');
  const slips = run.slips;
  const file = (name, head, rows) => ({ filename: `${name}-${month}.csv`, csv: csv(head, rows) });
  switch (kind) {
    case 'BANK':
      return file('bank-transfer', ['Employee', 'Code', 'Account number', 'IFSC', 'Amount (Rs)', 'Narration'],
        slips.filter((s) => Number(s.net_pay_paise) > 0).map((s) => [s.name, s.emp_code, s.bank_account || '', s.ifsc || '', rupees(s.net_pay_paise), `Salary ${month}`]));
    case 'PF':
      return file('pf-contribution', ['UAN', 'Member name', 'Gross wages', 'PF wages', 'Employee share (12%)', 'Employer pension (8.33%)', 'Employer PF difference', 'Admin and EDLI', 'Days not paid'],
        slips.filter((s) => Number(s.pf_employee_paise) > 0).map((s) => {
          const eps = Math.round((Math.min(Number(s.pf_wages_paise), 1500000) * 8.33) / 100);
          return [s.uan || '', s.name, rupees(s.gross_paise), rupees(s.pf_wages_paise), rupees(s.pf_employee_paise), rupees(eps), rupees(Number(s.pf_employer_paise) - eps), rupees(s.pf_admin_paise), s.days_unpaid];
        }));
    case 'ESI':
      return file('esi-contribution', ['ESI number', 'Employee', 'Days worked', 'Wages', 'Employee share (0.75%)', 'Employer share (3.25%)'],
        slips.filter((s) => Number(s.esi_employee_paise) + Number(s.esi_employer_paise) > 0).map((s) => [s.esi_number || '', s.name, Number(s.days_present) + Number(s.days_paid_leave) + Number(s.days_weekly_off), rupees(s.gross_paise), rupees(s.esi_employee_paise), rupees(s.esi_employer_paise)]));
    case 'PT':
      return file('professional-tax', ['Employee', 'Code', 'Gross pay', 'Professional tax'], slips.filter((s) => Number(s.pt_paise) > 0).map((s) => [s.name, s.emp_code, rupees(s.gross_paise), rupees(s.pt_paise)]));
    case 'REGISTER':
      return file('payroll-register', ['Employee', 'Code', 'Department', 'Paid days', 'Basic', 'HRA', 'Overtime', 'Allowances', 'Gross', 'PF', 'ESI', 'Professional tax', 'TDS', 'Loan recovery', 'Other deductions', 'Net pay'],
        slips.map((s) => [s.name, s.emp_code, s.department || '', Number(s.days_present) + Number(s.days_paid_leave) + Number(s.days_weekly_off), rupees(s.basic_paise), rupees(s.hra_paise), rupees(s.overtime_pay_paise), rupees(s.allowances_paise), rupees(s.gross_paise),
          rupees(s.pf_employee_paise), rupees(s.esi_employee_paise), rupees(s.pt_paise), rupees(s.tds_paise), rupees(s.loan_recovery_paise), rupees(s.deductions_paise), rupees(s.net_pay_paise)]));
    default:
      throw new HrError(400, 'Choose which file to make');
  }
};
