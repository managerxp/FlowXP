/* Payroll on the phone: what is to be deposited, the slip line, the {{n}} fill fix, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAYROLL_TEXTS, duesOf, madePayRun, slipLine } from '../src/lib/payroll.ts';
import { HI, fill } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const totals = { net_pay_paise: 100, employer_cost_paise: 200, pf_employee_paise: 10, pf_employer_paise: 20, pf_admin_paise: 1, esi_employee_paise: 2, esi_employer_paise: 3, pt_paise: 4, tds_paise: 5 };

test('what to deposit is PF, ESI, professional tax and TDS together', () => assert.equal(duesOf(totals), 45));
test('a month with nothing made is not a run', () => { assert.equal(madePayRun(null), null); assert.equal(madePayRun({ month: '2026-11', status: null, slips: [], unmarked_days: 0 }), null); });
test('a slip line says gross, what was taken off and unmarked days', () => assert.match(slipLine({ payslip_id: 1, employee_id: 1, name: 'A', designation: null, department: null, gross_paise: 3000000, net_pay_paise: 2800000, days_unmarked: 2 }), /taken off.*2 days not marked|2 days not marked/));
test('fill accepts {n} and {{n}}', () => { assert.equal(fill('{{n}} things', { n: 3 }), '3 things'); assert.equal(fill('{n} things', { n: 3 }), '3 things'); });
test('every text of the payroll screen is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(PAYROLL_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual([...new Set(missing.map((m) => m.split(': ').slice(1).join(': ')))], []);
});
