import test from 'node:test';
import assert from 'node:assert/strict';
import { ptPresetSlabs, professionalTax, providentFund, slipAmounts, splitSalary, stateInsurance } from '../src/modules/payroll/statutory.js';
import { effectiveFeatureFlags } from '../src/modules/planFeatures.js';
import { setupTestDb } from './helpers/db.js';

const R = (n) => n * 100;

test('the salary split always adds back up to the gross, basic defaulting to half', () => {
  assert.deepEqual(splitSalary({ grossPaise: R(30000) }), { basic: R(15000), hra: 0, other: R(15000) });
  assert.deepEqual(splitSalary({ grossPaise: R(30000), basicPaise: R(20000), hraPaise: R(6000) }), { basic: R(20000), hra: R(6000), other: R(4000) });
  const odd = splitSalary({ grossPaise: 1000001, defaultBasicPct: 33 });
  assert.equal(odd.basic + odd.hra + odd.other, 1000001);
  assert.equal(splitSalary({ grossPaise: R(5000), basicPaise: R(9000) }).basic, R(5000));   // a basic above the pay is cut to the pay
});

test('PF is 12% of basic, capped at the Rs 15,000 ceiling, and the pension share is 8.33% of wages up to it', () => {
  const small = providentFund(R(10000));
  assert.equal(small.employee, R(1200)); assert.equal(small.employer, R(1200)); assert.equal(small.eps, 83300); assert.equal(small.epf, R(1200) - 83300); assert.equal(small.admin, R(100));
  const big = providentFund(R(40000));
  assert.equal(big.employee, R(1800)); assert.equal(big.wages, R(15000));
  assert.equal(providentFund(R(40000), { capOnCeiling: false }).employee, R(4800));
});

test('ESI applies only up to the Rs 21,000 ceiling and rounds up to the rupee', () => {
  assert.deepEqual(stateInsurance(R(20000)), { wages: R(20000), employee: R(150), employer: R(650) });
  assert.equal(stateInsurance(R(21001)).employee, 0);
  assert.equal(stateInsurance(R(10001)).employee, R(76));   // 75.0075 rounds up to 76
});

test('professional tax follows the slab, with a different February amount', () => {
  const ka = ptPresetSlabs('karnataka');
  assert.equal(professionalTax(R(24000), ka, '2026-05'), 0);
  assert.equal(professionalTax(R(25000), ka, '2026-05'), R(200));
  assert.equal(professionalTax(R(25000), ka, '2027-02'), R(300));
  assert.equal(professionalTax(R(9000), ptPresetSlabs('Maharashtra'), '2026-05'), R(175));
  assert.equal(ptPresetSlabs('Atlantis'), null);
});

test('a payslip: the statutory amounts come off the pay, a loan never takes pay below zero', () => {
  const settings = { pf_enabled: true, esi_enabled: true, pt_enabled: true, pf_ceiling_paise: 1500000, esi_ceiling_paise: 2100000, default_basic_pct: 50 };
  const slabs = ptPresetSlabs('Karnataka');
  const a = slipAmounts({ salaryPaise: R(18000), payType: 'MONTHLY', earned: { base: R(18000), overtime: 0, allowances: 0 }, profile: { pf_applicable: true, esi_applicable: true, pt_applicable: true, tds_monthly_paise: 0 }, settings, slabs, month: '2026-05', loanDuePaise: R(2000) });
  assert.equal(a.basic_paise, R(9000)); assert.equal(a.pf_employee_paise, R(1080)); assert.equal(a.esi_employee_paise, R(135)); assert.equal(a.pt_paise, 0);
  assert.equal(a.loan_recovery_paise, R(2000)); assert.equal(a.net_pay_paise, R(18000) - R(1080) - R(135) - R(2000));
  const tiny = slipAmounts({ salaryPaise: R(3000), payType: 'MONTHLY', earned: { base: R(3000), overtime: 0, allowances: 0 }, profile: { tds_monthly_paise: 0 }, settings: { ...settings, pf_enabled: false, esi_enabled: false }, slabs, month: '2026-05', loanDuePaise: R(5000) });
  assert.equal(tiny.loan_recovery_paise, R(3000)); assert.equal(tiny.net_pay_paise, 0);
  // half the month worked: the basic, and so the PF, is for half
  const half = slipAmounts({ salaryPaise: R(30000), payType: 'MONTHLY', earned: { base: R(15000), overtime: 0, allowances: 0 }, profile: { pf_applicable: true }, settings, slabs, month: '2026-05' });
  assert.equal(half.pf_wages_paise, R(7500)); assert.equal(half.pf_employee_paise, R(900));
  // nothing is taken from someone not ticked for PF, ESI or tax
  const none = slipAmounts({ salaryPaise: R(15000), payType: 'MONTHLY', earned: { base: R(15000), overtime: 0, allowances: 0 }, profile: { pf_applicable: false, esi_applicable: false, pt_applicable: false }, settings, slabs, month: '2026-05' });
  assert.equal(none.net_pay_paise, R(15000));
});

test('Payroll is off for everyone until it is bought; a per-business override or an Enterprise type flag turns it on', () => {
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'RETAIL').payroll, false);
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'SALON').payroll, false);
  assert.equal(effectiveFeatureFlags([{}, {}], { payroll: true }, 'RETAIL').payroll, undefined);
  assert.equal(effectiveFeatureFlags([{}, { payroll: true }], {}, 'RETAIL').payroll, undefined);
  // on the free trial every industry has it; an admin's explicit off still wins
  for (const type of ['RETAIL', 'SALON', 'RESTAURANT', 'GYM', 'MECHANIC']) assert.equal(effectiveFeatureFlags([{}, {}], {}, type, undefined, true).payroll, undefined, type);
  assert.equal(effectiveFeatureFlags([{}, {}], { payroll: false }, 'RETAIL', undefined, true).payroll, false);
});

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

test('a payroll run: attendance pay, PF and professional tax on the slip, a loan taken back when finalised, the files', { skip }, async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const pay = await import('../src/modules/payroll/payroll.js');
  const hr = await import('../src/modules/hr/staff.js');
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Owner','o@pay.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const tenant = { businessId: biz, branchId: branch, businessType: 'RETAIL' };
  const e = await hr.saveEmployee(pool, tenant, null, { name: 'Asha', pay_type: 'MONTHLY', salary_paise: R(30000), weekly_off: 0, joined_on: '2020-01-01' });
  await pay.saveSettings(pool, biz, { pf_enabled: true, pt_enabled: true, pt_state: 'Karnataka', preset: true });
  await pay.saveProfile(pool, tenant, e.employee_id, { pf_applicable: true, pt_applicable: true, tds_monthly_paise: R(500), basic_paise: R(15000), ifsc: 'HDFC0001234' });
  await pay.addLoan(pool, tenant, { employee_id: e.employee_id, kind: 'ADVANCE', principal_paise: R(3000), emi_paise: R(2000), taken_on: '2026-01-01' }, owner);
  const spent = async (category) => Number((await pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS n FROM expenses WHERE business_id = $1 AND category = $2`, [biz, category])).rows[0].n);
  assert.equal(await spent('Staff advances'), R(3000), 'an advance given is money out');

  const month = '2026-01';
  await pay.generateRun(pool, tenant, owner, month);
  let run = await pay.getRun(pool, tenant, month);
  const s = run.slips[0];
  assert.equal(Number(s.basic_paise), R(15000)); assert.equal(Number(s.pf_employee_paise), R(1800)); assert.equal(Number(s.pt_paise), R(200));
  assert.equal(Number(s.tds_paise), R(500)); assert.equal(Number(s.loan_recovery_paise), R(2000));
  assert.equal(Number(s.net_pay_paise), Number(s.gross_paise) - R(1800) - R(200) - R(500) - R(2000));

  await pay.adjustSlip(pool, tenant, s.payslip_id, { deductions_paise: R(100) });
  run = await pay.getRun(pool, tenant, month);
  assert.equal(Number(run.slips[0].net_pay_paise), Number(s.net_pay_paise) - R(100));

  await pay.finalizeRun(pool, tenant, owner, month, { force: true });
  assert.equal(Number((await pool.query(`SELECT recovered_paise FROM payroll_loans WHERE employee_id = $1`, [e.employee_id])).rows[0].recovered_paise), R(2000));
  await assert.rejects(() => pay.adjustSlip(pool, tenant, s.payslip_id, { deductions_paise: 0 }), /finalised/);
  await assert.rejects(() => pay.markPaid(pool, tenant, '2026-02', { paidOn: '2026-02-01', via: 'BANK' }), /no payroll/);
  await pay.markPaid(pool, tenant, month, { paidOn: '2026-02-01', via: 'BANK' }, owner);
  const netPaid = Number((await pool.query(`SELECT SUM(net_pay_paise) AS n FROM hr_payslips p JOIN hr_payroll_runs r ON r.run_id = p.run_id WHERE r.branch_id = $1`, [branch])).rows[0].n);
  assert.equal(await spent('Salaries'), netPaid, 'paying the run puts the net pay into expenses');
  await assert.rejects(() => pay.markPaid(pool, tenant, month, { paidOn: '2026-02-02', via: 'BANK' }, owner), /already/);
  assert.equal(await spent('Salaries'), netPaid, 'paying twice records nothing more');
  await pay.payDues(pool, tenant, month, { paidOn: '2026-02-10', via: 'BANK' }, owner);
  assert.equal(await spent('Payroll taxes and contributions'), R(1800) + R(1800) + R(150) + R(200) + R(500), 'PF both shares and charges, professional tax and TDS');
  await assert.rejects(() => pay.payDues(pool, tenant, month, { paidOn: '2026-02-11', via: 'BANK' }, owner), /already/);
  const bank = await pay.exportFile(pool, tenant, month, 'BANK');
  assert.match(bank.csv, /HDFC0001234/); assert.match(bank.filename, /bank-transfer-2026-01/);
  assert.match((await pay.exportFile(pool, tenant, month, 'PF')).csv, /Asha/);
  assert.match((await pay.exportFile(pool, tenant, month, 'REGISTER')).csv, /Asha/);
  await assert.rejects(() => pay.generateRun(pool, tenant, owner, month), /finalised/);
  assert.equal(Number((await pay.listLoans(pool, tenant))[0].outstanding_paise), R(1000));
});
