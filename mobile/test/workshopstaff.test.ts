/* Staff of a spare parts shop on the phone: a person's form, today's attendance, the payroll sheet, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSHOP_STAFF_TEXTS, adjustBody, adjustProblem, canStaff, dayCounts, emptyPerson, madeRun, markBody, markLabel, monthOf, personBody, personForm, personProblem, personSub, runLine, shiftMonth, slipForm, slipSub, unmarkedWarning, type MadeRun, type Person, type Slip
} from '../src/lib/workshopStaff.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const p: Person = { employee_id: 1, emp_code: 'E1', name: 'Raju', phone: '9000000011', designation: 'Mechanic', department: 'Workshop', dept_id: 3, status: 'ACTIVE', pay_type: 'MONTHLY', salary_paise: 1800000, joined_on: '2026-01-01', weekly_off: 0 };

test('only HR or payroll people', () => { assert.equal(canStaff((x) => x === 'payroll'), true); assert.equal(canStaff((x) => x === 'hr'), true); assert.equal(canStaff(() => false), false); });

test('a person: round trip, checks, and pay only goes when allowed', () => {
  const f = personForm(p);
  assert.equal(f.salary, '18000'); assert.equal(f.weekly_off, '0'); assert.equal(personProblem(f, true), '');
  assert.deepEqual(personBody(f, true, true), { name: 'Raju', phone: '9000000011', designation: 'Mechanic', dept_id: 3, pay_type: 'MONTHLY', joined_on: '2026-01-01', weekly_off: 0, status: 'ACTIVE', salary: 18000 });
  assert.equal('salary' in personBody(f, false, true), false); assert.equal('status' in personBody(f, true, false), false);
  assert.equal(personBody({ ...f, weekly_off: '', dept_id: '' }, false, false).weekly_off, null);
  assert.notEqual(personProblem({ ...f, name: 'R' }, true), ''); assert.notEqual(personProblem({ ...f, phone: 'x' }, true), ''); assert.notEqual(personProblem({ ...f, joined_on: '2026-13-01' }, true), ''); assert.notEqual(personProblem({ ...f, salary: '-1' }, true), ''); assert.equal(personProblem({ ...f, salary: 'x' }, false), '');
  assert.equal(emptyPerson().pay_type, 'MONTHLY');
  assert.equal(personSub(p), 'Mechanic · Workshop · 9000000011 · ₹18,000.00 a month'); assert.equal(personSub({ ...p, salary_paise: undefined, status: 'INACTIVE', designation: null, department: null, phone: null }), 'Inactive');
  assert.match(personSub({ ...p, pay_type: 'DAILY', salary_paise: 70000 }), /₹700.00 a day/);
});

test('attendance for the day', () => {
  assert.equal(markLabel('HALF_DAY'), 'Half day'); assert.equal(markLabel(null), 'Not marked'); assert.deepEqual(markBody('2026-10-20', 4, 'PRESENT'), { date: '2026-10-20', entries: [{ employee_id: 4, status: 'PRESENT' }] });
  const rows = [{ status: 'PRESENT' }, { status: 'HALF_DAY' }, { status: 'ABSENT' }, { status: null }] as never[];
  assert.equal(dayCounts(rows), '2 present, 1 absent, 1 not marked');
});

test('payroll', () => {
  assert.equal(monthOf('2026-10-20'), '2026-10'); assert.equal(shiftMonth('2026-01', -1), '2025-12'); assert.equal(shiftMonth('2026-12', 1), '2027-01');
  const s: Slip = { payslip_id: 9, employee_id: 1, name: 'Raju', designation: null, net_pay_paise: 1650000, base_pay_paise: 1500000, allowances_paise: 200000, deductions_paise: 50000, days_present: 25, days_unmarked: 2, note: 'Festival bonus' };
  assert.equal(slipSub(s), '25 days present · +₹2,000.00 extra · -₹500.00 taken off · 2 days not marked');
  assert.deepEqual(slipForm(s), { allowances: '2000', deductions: '500', note: 'Festival bonus' }); assert.deepEqual(slipForm({ ...s, allowances_paise: 0, deductions_paise: 0, note: null }), { allowances: '', deductions: '', note: '' });
  assert.deepEqual(adjustBody('2000', '', ' bonus '), { allowances: 2000, deductions: 0, note: 'bonus' }); assert.equal(adjustProblem('x', ''), 'Extra and taken-off amounts are amounts in rupees'); assert.equal(adjustProblem('', '10'), '');
  const run = { month: '2026-10', status: 'DRAFT', slips: [s], total_paise: 1650000, unmarked_days: 2 } as MadeRun;
  assert.equal(madeRun({ month: '2026-10', status: null, slips: [], total_paise: 0, unmarked_days: 0 }), null, 'a month with no sheet is not a sheet'); assert.equal(madeRun(null), null); assert.equal(madeRun(run), run);
  assert.equal(runLine(run), 'Draft · Total ₹16,500.00'); assert.match(unmarkedWarning(run), /2 days are not marked/); assert.equal(unmarkedWarning({ ...run, unmarked_days: 0 }), ''); assert.equal(runLine({ ...run, status: 'FINAL' }), 'Final · Total ₹16,500.00');
});

test('every text of the staff screen is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(WORKSHOP_STAFF_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
