import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { recordExpense } from '../src/expenses.ts';
import { post, reverse } from '../src/ledger.ts';
import { openFinancialYear } from '../src/periods.ts';
import { addEntry, bankAccounts, importStatement, matchLine, setIgnored, unmatchLine, workbench } from '../src/reconcile.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const books = async () => {
  const org = await newOrg(pool);
  const ids = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't');
    const id = async (name: string) => (await c.query(`SELECT id FROM accounts WHERE organization_id = $1 AND name = $2`, [org, name])).rows[0].id as bigint;
    return { bank: await id('Bank'), rent: await id('Rent'), capital: await id("Owner's capital") };
  });
  return { org, ...ids };
};
const journalLine = async (org: bigint, entryId: bigint, account: bigint) => (await pool.query(`SELECT id FROM journal_lines WHERE organization_id = $1 AND entry_id = $2 AND account_id = $3`, [org, entryId, account])).rows[0].id as bigint;

test('import skips what was imported before, keeps identical lines in one file, and rejects bad rows', { skip }, async () => {
  const { org, bank } = await books();
  const rows = [{ date: '2026-06-02', description: 'UPI/ravi', amount: '1000.00' }, { date: '2026-06-02', description: 'UPI/ravi', amount: '1000.00' }, { date: '2026-06-03', description: 'Rent', amount: '-500' }];
  assert.deepEqual(await run(org, (c) => importStatement(c, org, bank, rows, 't')), { imported: 3, skipped: 0 });
  assert.deepEqual(await run(org, (c) => importStatement(c, org, bank, rows, 't')), { imported: 0, skipped: 3 }, 'the same file again adds nothing');
  await assert.rejects(run(org, (c) => importStatement(c, org, bank, [{ date: '2026-06-02', amount: 'abc' }], 't')), /not an amount/);
  await assert.rejects(run(org, (c) => importStatement(c, org, bank, [{ date: '2026-13-45', amount: '5' }], 't')), /not a date/);
  const rent = (await pool.query(`SELECT id FROM accounts WHERE organization_id = $1 AND name = 'Rent'`, [org])).rows[0].id as bigint;
  await assert.rejects(run(org, (c) => importStatement(c, org, rent, rows, 't')), /asset account/);
});

test('lines of the same amount are suggested, matched one to one, and the balance check adds up', { skip }, async () => {
  const { org, bank, rent, capital } = await books();
  const dep = await run(org, (c) => post(c, org, { date: '2026-06-01', sourceType: 'manual', sourceId: 'cap', lines: [{ account: bank, side: 'D', amount: 5_000_000n }, { account: capital, side: 'C', amount: 5_000_000n }], actor: 't' }));
  const exp = await run(org, (c) => recordExpense(c, org, { date: '2026-06-05', accountId: rent, amount: '10000', paidWith: 'BANK', description: 'June rent', idempotencyKey: 'rent-rec-0001' }, 't'));
  const lonely = await run(org, (c) => post(c, org, { date: '2026-06-20', sourceType: 'manual', sourceId: 'cheque', lines: [{ account: rent, side: 'D', amount: 7_700n }, { account: bank, side: 'C', amount: 7_700n }], actor: 't' }));
  await run(org, (c) => importStatement(c, org, bank, [
    { date: '2026-06-02', description: 'NEFT capital', amount: '50000' }, { date: '2026-06-07', description: 'Rent June', amount: '-10000' }, { date: '2026-06-25', description: 'SMS charges', amount: '-23.60' }], 't'));

  let w = await run(org, (c) => workbench(c, org, bank, '2026-06-30'));
  assert.deepEqual(w.statement.map((s) => s.suggestion_id !== null), [true, true, false], 'the third has no counterpart in the books');
  assert.equal(w.summary.bookBalance, 5_000_000n - 1_000_000n - 7_700n);
  const depLine = await journalLine(org, dep.entryId, bank); const rentLine = await journalLine(org, exp.entryId, bank);
  assert.equal(w.statement[0]?.suggestion_id, depLine);
  await run(org, (c) => matchLine(c, org, w.statement[0]!.id, depLine, 't'));
  await assert.rejects(run(org, (c) => matchLine(c, org, w.statement[1]!.id, depLine, 't')), /not open|already matched|differ/);
  await assert.rejects(run(org, (c) => matchLine(c, org, w.statement[2]!.id, rentLine, 't')), /amounts differ/);
  await run(org, (c) => matchLine(c, org, w.statement[1]!.id, rentLine, 't'));

  // the bank charge the books lack: add it, and it matches itself
  w = await run(org, (c) => workbench(c, org, bank, '2026-06-30'));
  const charge = w.statement.find((s) => s.amount_minor === -2360n)!;
  const added = await run(org, (c) => addEntry(c, org, charge.id, { counterAccountId: rent }, 't'));
  assert.ok(added.entryNo);
  w = await run(org, (c) => workbench(c, org, bank, '2026-06-30'));
  assert.equal(w.statement.length, 0, 'every statement line is matched');
  assert.deepEqual(w.book.map((b) => b.id), [lonely.entryId ? await journalLine(org, lonely.entryId, bank) : 0n], 'the cheque has not cleared');
  // statement closing = books − not on statement + not in books = 50,000 − 10,000 − 23.60
  assert.equal(w.summary.expectedStatementBalance, 5_000_000n - 1_000_000n - 2_360n);

  const matched = (await pool.query(`SELECT id FROM bank_statement_lines WHERE organization_id = $1 AND status = 'MATCHED' ORDER BY id LIMIT 1`, [org])).rows[0].id as bigint;
  await run(org, (c) => unmatchLine(c, org, matched, 't'));
  await assert.rejects(run(org, (c) => unmatchLine(c, org, matched, 't')), /not matched/);
  await run(org, (c) => setIgnored(c, org, matched, true, 't'));
  assert.equal((await run(org, (c) => workbench(c, org, bank, '2026-06-30'))).statement.find((s) => s.id === matched)?.status, 'IGNORED');
  assert.ok((await run(org, (c) => bankAccounts(c, org))).some((a) => a.name === 'Bank'));
});

test('a reversed entry and its reversal are not left as things to match', { skip }, async () => {
  const { org, bank, capital } = await books();
  const p = await run(org, (c) => post(c, org, { date: '2026-06-01', sourceType: 'manual', sourceId: 'oops', lines: [{ account: bank, side: 'D', amount: 100_000n }, { account: capital, side: 'C', amount: 100_000n }], actor: 't' }));
  await run(org, (c) => reverse(c, org, p.entryId, { date: '2026-06-02', reason: 'typo', actor: 't' }));
  assert.equal((await run(org, (c) => workbench(c, org, bank, '2026-06-30'))).book.length, 0);
});
