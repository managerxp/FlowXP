import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { openFinancialYear } from '../src/periods.ts';
import { computePay, getRun, makeRun, payDues, payStaff, postRun, saveEmployee, voidRun } from '../src/payroll.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const R = (n: number) => n * 100;

test('pay is cut for days away; PF is 12% of basic up to Rs 15,000, ESI stops above Rs 21,000', () => {
  const full = computePay({ monthlyPay: R(30000), basic: R(20000), pf: true, esi: true, pt: R(200), tds: R(500) }, 30, 0, 0);
  assert.equal(full.gross, R(30000)); assert.equal(full.pfEmployee, R(1800)); assert.equal(full.esiEmployee, 0);   // over the ESI ceiling
  assert.equal(full.net, R(30000) - R(1800) - R(200) - R(500));
  const half = computePay({ monthlyPay: R(18000), basic: null, pf: true, esi: true, pt: 0, tds: 0 }, 30, 15, 0);
  assert.equal(half.gross, R(9000)); assert.equal(half.pfEmployee, R(540)); assert.equal(half.esiEmployee, R(68));    // 67.5 up to the rupee
  assert.equal(computePay({ monthlyPay: R(10000), basic: null, pf: false, esi: false, pt: R(200), tds: 0 }, 30, 30, 0).net, 0);   // a month away: no pay, no tax
});

test('a month: post the salary, pay the staff, deposit the dues, then void takes it all back', { skip }, async () => {
  const org = await newOrg(pool);
  await run(org, (c) => openFinancialYear(c, org, 2027, 4, 't'));
  const bal = async (key: string) => run(org, async (c) => BigInt((await c.query(
    `SELECT COALESCE(SUM(CASE WHEN l.side = 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::text AS n FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.organization_id = $1 AND a.system_key = $2`, [org, key])).rows[0].n));
  const a = await run(org, (c) => saveEmployee(c, org, null, { name: 'Asha', monthlyPay: '30000', basic: '15000', pf: true, pt: '200', tds: '500' }));
  await run(org, (c) => saveEmployee(c, org, null, { name: 'Ravi', monthlyPay: '18000', esi: true }));
  const month = '2026-06';
  let r = await run(org, (c) => makeRun(c, org, month, [{ employeeId: a.id, bonus: '1000' }]));
  assert.equal(r!.lines.length, 2);
  await run(org, (c) => postRun(c, org, month, 't'));
  await assert.rejects(() => run(org, (c) => makeRun(c, org, month)), /already posted/);
  await assert.rejects(() => run(org, (c) => postRun(c, org, month, 't')), /already posted/);
  // Asha: gross 31000, PF 1800 each side, +admin 150; Ravi: gross 18000, ESI 135 / 585
  assert.equal(await bal('SALARY_PAYABLE'), -BigInt(R(31000 - 1800 - 200 - 500) + R(18000 - 135)));
  await assert.rejects(() => run(org, (c) => payDues(c, org, '2026-07', { date: '2026-07-10', paidWith: 'BANK' }, 't')), /no payroll/);
  await run(org, (c) => payStaff(c, org, month, { date: '2026-07-01', paidWith: 'BANK' }, 't'));
  assert.equal(await bal('SALARY_PAYABLE'), 0n);
  await assert.rejects(() => run(org, (c) => payStaff(c, org, month, { date: '2026-07-02', paidWith: 'BANK' }, 't')), /already/);
  await run(org, (c) => payDues(c, org, month, { date: '2026-07-10', paidWith: 'BANK' }, 't'));
  for (const k of ['PF_PAYABLE', 'ESI_PAYABLE', 'PT_PAYABLE', 'SALARY_TDS_PAYABLE']) assert.equal(await bal(k), 0n, k);
  await run(org, (c) => voidRun(c, org, month, { date: '2026-07-15', reason: 'wrong month' }, 't'));
  assert.equal(await run(org, (c) => getRun(c, month)), null);
  assert.equal(await bal('SALARIES'), 0n);
  await run(org, (c) => makeRun(c, org, month));   // can be made and posted again
  await run(org, (c) => postRun(c, org, month, 't'));
});
