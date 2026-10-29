import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { gstr3b } from '../src/gstr.ts';
import { listExpenses, recordExpense, voidExpense } from '../src/expenses.ts';
import { importItems, importParties } from '../src/import.ts';
import { seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };

const shop = async () => {
  const org = await newOrg(pool);
  const rent = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2 WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return (await c.query(`SELECT id FROM accounts WHERE organization_id = $1 AND name = 'Rent'`, [org])).rows[0].id as bigint;
  });
  return { org, rent };
};

test('an expense debits the cost and the claimable GST and credits what paid it; voiding undoes it; a retry posts once', { skip }, async () => {
  const { org, rent } = await shop();
  const e = { date: '2026-06-05', accountId: rent, amount: '10000', taxCode: 'GST18', paidWith: 'BANK' as const, description: 'June shop rent', paidTo: 'Mehta Estates', idempotencyKey: 'exp-rent-june-1' };
  const first = await run(org, (c) => recordExpense(c, org, e, 't'));
  assert.equal((await run(org, (c) => recordExpense(c, org, e, 't'))).entryId, first.entryId, 'the same key posts once');
  const tb = await run(org, (c) => trialBalance(c, org, { from: '2026-06-01', to: '2026-06-30' }));
  const bal = Object.fromEntries(tb.rows.map((r) => [r.name, [r.debitBalance, r.creditBalance]]));
  assert.deepEqual([bal['Rent'], bal['Input CGST'], bal['Input SGST'], bal['Bank']], [[1000000n, 0n], [90000n, 0n], [90000n, 0n], [0n, 1180000n]]);

  const list = await run(org, (c) => listExpenses(c, { from: '2026-06-01', to: '2026-06-30', limit: 10 }));
  assert.deepEqual([list.length, list[0].account, list[0].paid_with, list[0].total_minor, list[0].tax_minor, list[0].reversed], [1, 'Rent', 'Bank', 1180000n, 180000n, false]);
  assert.match(list[0].memo, /June shop rent · to Mehta Estates/);

  const itc = async () => (await run(org, (c) => gstr3b(c, org, '2026-06'))).file.itc_elg.itc_avl.find((x) => x.ty === 'OTH');
  assert.deepEqual(await itc(), { ty: 'OTH', iamt: 0, camt: 900, samt: 900, csamt: 0 }, 'the GST is claimable credit in GSTR-3B');
  await run(org, (c) => voidExpense(c, org, first.entryId, { date: '2026-06-06', reason: 'booked twice' }, 't'));
  assert.equal((await run(org, (c) => listExpenses(c, { from: '2026-06-01', to: '2026-06-30', limit: 10 })))[0].reversed, true);
  assert.deepEqual(await itc(), { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 }, 'and the credit goes with it');
});

test('an inter-state expense uses IGST, and only expense accounts are accepted', { skip }, async () => {
  const { org, rent } = await shop();
  await run(org, (c) => recordExpense(c, org, { date: '2026-06-05', accountId: rent, amount: '1000', taxCode: 'GST5', interState: true, paidWith: 'UPI', description: 'Courier', idempotencyKey: 'exp-courier-0001' }, 't'));
  const tb = await run(org, (c) => trialBalance(c, org, { from: '2026-06-01', to: '2026-06-30' }));
  assert.deepEqual(tb.rows.find((r) => r.name === 'Input IGST')?.debitBalance, 5000n);
  const bank = await run(org, async (c) => (await c.query(`SELECT id FROM accounts WHERE organization_id = $1 AND system_key = 'BANK'`, [org])).rows[0].id as bigint);
  await assert.rejects(run(org, (c) => recordExpense(c, org, { date: '2026-06-05', accountId: bank, amount: '10', paidWith: 'CASH', description: 'x', idempotencyKey: 'exp-bad-acct-01' }, 't')), /expense account/);
});

test('CSV import reports each bad row, imports the good ones, and a dry run changes nothing', { skip }, async () => {
  const { org } = await shop();
  const rows = [
    { kind: 'CUSTOMER' as const, name: 'Ravi Stores', gstin: gstin('27', 'BBBBB1111B'), phone: '9876543210', creditDays: 15 },
    { kind: 'CUSTOMER' as const, name: 'Bad GST', gstin: gstin('27', 'CCCCC2222C').slice(0, 14) + (gstin('27', 'CCCCC2222C').endsWith('0') ? '1' : '0') },
    { kind: 'CUSTOMER' as const, name: 'Walk-in', stateCode: '29' },
    { kind: 'CUSTOMER' as const, name: 'Ravi Again', gstin: gstin('27', 'BBBBB1111B') },
    { kind: 'CUSTOMER' as const, name: '  ' }
  ];
  const dry = await run(org, (c) => importParties(c, org, rows, true, 't'));
  assert.deepEqual([dry.created, dry.errors.map((x) => x.row), dry.dryRun], [2, [2, 4, 5], true]);
  assert.equal((await run(org, async (c) => (await c.query(`SELECT count(*)::int AS n FROM parties`)).rows[0].n)), 0, 'the dry run left nothing behind');
  const real = await run(org, (c) => importParties(c, org, rows, false, 't'));
  assert.equal(real.created, 2);
  assert.match(real.errors[0]?.message ?? '', /not a valid GSTIN/);
  assert.match(real.errors[1]?.message ?? '', /already exists/);
  assert.equal((await run(org, async (c) => (await c.query(`SELECT count(*)::int AS n FROM parties`)).rows[0].n)), 2);

  const items = await run(org, (c) => importItems(c, org, [
    { sku: 'TEA', name: 'Tea', hsnSac: '0902', unit: 'KGS', taxCode: 'GST5', salePrice: '400' },
    { sku: 'TEA', name: 'Tea again' },
    { sku: 'X1', name: 'Odd', taxCode: 'GST99' },
    { sku: '', name: 'No code' }
  ], false, 't'));
  assert.deepEqual([items.created, items.errors.map((x) => x.row)], [1, [2, 3, 4]]);
});
