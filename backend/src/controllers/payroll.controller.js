/*
 * Payroll endpoints, mounted at /api/payroll (the Payroll add-on). Set-up, people, attendance and leave reuse the staff controller; this adds settings and professional
 * tax slabs, pay profiles, loans, the run with its statutory amounts, paying it, and the files. Money comes in as rupees and goes out as paise and rupees.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import { HrError, audit, bool, int, isoDate, money, num, ok, oneOf, text, withRupees, wrapAll } from '../modules/hr/common.js';
import * as pay from '../modules/payroll/payroll.js';

const out = (res, data, status = 200) => ok(res, withRupees(data), status);
const month = (v) => { const m = String(v ?? '').slice(0, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HrError(400, 'Choose a month'); return m; };
const when = (v) => isoDate(v, 'Date') || new Date().toISOString().slice(0, 10);
const upper = (v, label, max) => { const t = text(v, label, { max }); return t ? t.toUpperCase().replace(/\s+/g, '') : t; };

export default wrapAll({
  settings: async (req, res) => out(res, await pay.getSettings(pool, req.tenant.businessId)),
  saveSettings: async (req, res) => {
    const b = req.body || {};
    const v = {
      pf_enabled: b.pf_enabled === undefined ? undefined : bool(b.pf_enabled), pf_cap_on_ceiling: b.pf_cap_on_ceiling === undefined ? undefined : bool(b.pf_cap_on_ceiling),
      pf_ceiling_paise: b.pf_ceiling === undefined ? undefined : money(b.pf_ceiling, 'The PF ceiling'), esi_enabled: b.esi_enabled === undefined ? undefined : bool(b.esi_enabled),
      esi_ceiling_paise: b.esi_ceiling === undefined ? undefined : money(b.esi_ceiling, 'The ESI ceiling'), pt_enabled: b.pt_enabled === undefined ? undefined : bool(b.pt_enabled),
      pt_state: b.pt_state === undefined ? undefined : text(b.pt_state, 'State', { max: 60 }) || null,
      default_basic_pct: b.default_basic_pct === undefined ? undefined : num(b.default_basic_pct, 'Basic as a share of pay', { min: 0, max: 100 }),
      overtime_factor: b.overtime_factor === undefined ? undefined : num(b.overtime_factor, 'Overtime rate', { min: 1, max: 4 }),
      establishment_pf_code: b.establishment_pf_code === undefined ? undefined : text(b.establishment_pf_code, 'PF code', { max: 30 }) || null,
      establishment_esi_code: b.establishment_esi_code === undefined ? undefined : text(b.establishment_esi_code, 'ESI code', { max: 30 }) || null,
      preset: b.preset === true,
      slabs: Array.isArray(b.slabs) ? b.slabs.map((s) => ({ from_paise: money(s.from, 'From') ?? 0, to_paise: s.to === null || s.to === '' || s.to === undefined ? null : money(s.to, 'To'), tax_paise: money(s.tax, 'Tax') ?? 0, february_paise: s.february === null || s.february === '' || s.february === undefined ? null : money(s.february, 'February tax') })) : undefined
    };
    const r = await withTransaction((c) => pay.saveSettings(c, req.tenant.businessId, v));
    audit(req, 'payroll.settings_saved', 'payroll_settings', req.tenant.businessId, null, { pf: r.pf_enabled, esi: r.esi_enabled, pt: r.pt_enabled });
    out(res, r);
  },

  profiles: async (req, res) => out(res, await pay.listProfiles(pool, req.tenant)),
  saveProfile: async (req, res) => {
    const b = req.body || {};
    const v = {
      basic_paise: b.basic === undefined ? undefined : (b.basic === null || b.basic === '' ? null : money(b.basic, 'Basic')), hra_paise: b.hra === undefined ? undefined : money(b.hra, 'HRA') ?? 0,
      pf_applicable: b.pf_applicable === undefined ? undefined : bool(b.pf_applicable), esi_applicable: b.esi_applicable === undefined ? undefined : bool(b.esi_applicable),
      pt_applicable: b.pt_applicable === undefined ? undefined : bool(b.pt_applicable),
      pan: b.pan === undefined ? undefined : upper(b.pan, 'PAN', 10) || null, uan: b.uan === undefined ? undefined : text(b.uan, 'UAN', { max: 12 }) || null,
      esi_number: b.esi_number === undefined ? undefined : text(b.esi_number, 'ESI number', { max: 17 }) || null, ifsc: b.ifsc === undefined ? undefined : upper(b.ifsc, 'IFSC', 11) || null,
      gender: b.gender === undefined ? undefined : (b.gender ? oneOf(b.gender, 'Gender', ['M', 'F']) : null), tds_monthly_paise: b.tds === undefined ? undefined : money(b.tds, 'TDS') ?? 0
    };
    if (v.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(v.pan)) throw new HrError(400, 'The PAN should look like ABCDE1234F');
    if (v.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc)) throw new HrError(400, 'The IFSC should look like HDFC0001234');
    out(res, await withTransaction((c) => pay.saveProfile(c, req.tenant, Number(req.params.id), v)));
  },

  loans: async (req, res) => out(res, await pay.listLoans(pool, req.tenant, { employeeId: int(req.query.employee_id, 'Employee') })),
  addLoan: async (req, res) => {
    const b = req.body || {};
    const v = {
      employee_id: int(b.employee_id, 'Employee', { min: 1, required: true }), kind: b.kind ? oneOf(b.kind, 'Kind', ['ADVANCE', 'LOAN']) : 'ADVANCE',
      principal_paise: money(b.amount, 'The amount', { required: true }), emi_paise: money(b.emi, 'The monthly instalment', { required: true }), taken_on: when(b.taken_on), method: oneOf(b.method || 'CASH', 'Paid by', ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER']), record_expense: b.record_expense !== false, note: text(b.note, 'Note', { max: 200 }) || null
    };
    if (!(v.principal_paise > 0) || !(v.emi_paise > 0)) throw new HrError(400, 'Give the amount and the monthly instalment');
    const l = await withTransaction((c) => pay.addLoan(c, req.tenant, v, req.auth.userId));
    audit(req, 'payroll.loan_added', 'payroll_loan', l.loan_id, null, { employee_id: v.employee_id, amount_paise: v.principal_paise });
    out(res, l, 201);
  },
  closeLoan: async (req, res) => { await withTransaction((c) => pay.closeLoan(c, req.tenant, Number(req.params.id))); ok(res, { closed: true }); },

  generate: async (req, res) => {
    const m = month(req.body?.month);
    await withTransaction((c) => pay.generateRun(c, req.tenant, req.auth.userId, m));
    out(res, await pay.getRun(pool, req.tenant, m));
  },
  getRun: async (req, res) => out(res, await pay.getRun(pool, req.tenant, month(req.params.month))),
  adjustSlip: async (req, res) => {
    const b = req.body || {};
    await withTransaction((c) => pay.adjustSlip(c, req.tenant, Number(req.params.id), {
      allowances_paise: b.allowances === undefined ? undefined : money(b.allowances, 'Allowances') ?? 0, deductions_paise: b.deductions === undefined ? undefined : money(b.deductions, 'Deductions') ?? 0,
      note: b.note === undefined ? undefined : text(b.note, 'Note', { max: 200 }) || null
    }));
    ok(res, { saved: true });
  },
  finalize: async (req, res) => {
    const m = month(req.body?.month);
    await withTransaction((c) => pay.finalizeRun(c, req.tenant, req.auth.userId, m, { force: req.body?.force === true }));
    audit(req, 'payroll.finalized', 'hr_payroll_run', null, null, { month: m });
    out(res, await pay.getRun(pool, req.tenant, m));
  },
  markPaid: async (req, res) => {
    const m = month(req.body?.month);
    await withTransaction((c) => pay.markPaid(c, req.tenant, m, { paidOn: when(req.body?.paid_on), via: oneOf(req.body?.via || 'BANK', 'Paid by', ['BANK', 'CASH', 'UPI']) }, req.auth.userId));
    audit(req, 'payroll.paid', 'hr_payroll_run', null, null, { month: m });
    out(res, await pay.getRun(pool, req.tenant, m));
  },
  payDues: async (req, res) => {
    const m = month(req.body?.month);
    await withTransaction((c) => pay.payDues(c, req.tenant, m, { paidOn: when(req.body?.paid_on), via: oneOf(req.body?.via || 'BANK', 'Paid by', ['BANK', 'CASH', 'UPI']) }, req.auth.userId));
    audit(req, 'payroll.dues_paid', 'hr_payroll_run', null, null, { month: m });
    out(res, await pay.getRun(pool, req.tenant, m));
  },
  file: async (req, res) => ok(res, await pay.exportFile(pool, req.tenant, month(req.params.month), String(req.params.kind).toUpperCase()))
});
