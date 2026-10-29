import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createBankAccount, listTransfers, transfer, voidTransfer } from '../src/bankacct.ts';
import { createPayment, issueDocument, saveDraft, voidPayment } from '../src/documents.ts';
import type { DocKind } from '../src/documents.ts';
import { holding, revalue, saveRate } from '../src/fx.ts';
import { post } from '../src/ledger.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { addEntry, bankAccounts, importStatement, workbench } from '../src/reconcile.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const books = async () => {
  const org = await newOrg(pool);
  const r = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    return { cust: await createParty(c, org, { kind: 'CUSTOMER', name: 'Acme Inc', stateCode: '27' }, 't'), vend: await createParty(c, org, { kind: 'VENDOR', name: 'Berlin GmbH', stateCode: '27' }, 't') };
  });
  return { org, ...r };
};
const make = (org: bigint, kind: DocKind, partyId: bigint, currency: string, extra: { fxRate?: string; unitPrice?: string } = {}) => run(org, async (c) => {
  const id = await saveDraft(c, org, null, { kind, partyId, date: '2026-06-01', currency, fxRate: extra.fxRate, supplierRef: kind === 'BILL' ? 'EU-1' : undefined, lines: [{ description: 'Consulting', quantity: '2', unitPrice: extra.unitPrice ?? '500', taxCode: 'GST0' }] }, 't');
  await issueDocument(c, org, kind, id, 't'); return id;
});
const balance = async (org: bigint, key: string) => (await pool.query(
  `SELECT COALESCE(SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::bigint AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.organization_id = $1 AND a.system_key = $2`, [org, key])).rows[0].b as bigint;
const accId = async (org: bigint, key: string) => (await pool.query(`SELECT id FROM accounts WHERE organization_id = $1 AND system_key = $2`, [org, key])).rows[0].id as bigint;

test('a dollar bank account: buying dollars, receiving and paying dollar documents, revaluing and selling, with the rupee value and the exchange difference right', { skip }, async () => {
  const { org, cust, vend } = await books();
  const inr = await accId(org, 'BANK');
  const usd = (await run(org, (c) => createBankAccount(c, org, { name: 'Wise', currency: 'USD' }, 't'))).id;
  await assert.rejects(run(org, (c) => createBankAccount(c, org, { name: 'X', currency: 'XYZ' }, 't')), /not a currency/);
  await run(org, (c) => saveRate(c, org, { currency: 'USD', date: '2026-05-30', rate: '83.25' }, 't'));
  const inv = await make(org, 'INVOICE', cust, 'USD');                                     // $1000 booked at Rs 83,250
  const bill = await make(org, 'BILL', vend, 'USD', { fxRate: '83', unitPrice: '100' });   // $200 booked at Rs 16,600
  const held = () => run(org, (c) => holding(c, usd));
  const ex = () => balance(org, 'EXCHANGE_GAIN_LOSS');

  // the ledger refuses a rupee-only posting to a dollar account
  await assert.rejects(run(org, (c) => post(c, org, { date: '2026-06-05', sourceType: 't', sourceId: 'x', lines: [{ account: usd, side: 'D', amount: 100n }, { account: 'BANK', side: 'C', amount: 100n }] })), /own currency/);

  // buy $1000 for Rs 82,000
  const xfer = (from: bigint, to: bigint, out: bigint, inn: bigint, date: string, key: string) => run(org, (c) => transfer(c, org, { fromAccountId: from, toAccountId: to, date, fromAmount: out, toAmount: inn, idempotencyKey: key }, 't'));
  await xfer(inr, usd, 8_200_000n, 100_000n, '2026-06-05', 'buy-usd-0001');
  assert.deepEqual(await held(), { foreign: 100_000n, base: 8_200_000n });
  assert.equal((await xfer(inr, usd, 8_200_000n, 100_000n, '2026-06-05', 'buy-usd-0001')).replayed, true, 'same key, same transfer');
  await assert.rejects(xfer(usd, usd, 1n, 1n, '2026-06-05', 'same-0000001'), /two different accounts/);

  // a customer pays $400 into the dollar account at 84: Rs 33,600 against Rs 33,300 booked is a gain of Rs 300
  const pay = (over: object, key: string) => run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-20', mode: 'BANK', amount: 0n, idempotencyKey: key, ...over }, 't'));
  await assert.rejects(pay({ accountId: usd }, 'usd-plain-0001'), /use it to receive or pay a USD/);
  const rec = await pay({ accountId: usd, rate: '84', fx: { documentId: inv, foreignAmount: 40_000n } }, 'usd-rec-00001');
  assert.deepEqual(await held(), { foreign: 140_000n, base: 8_200_000n + 3_360_000n });
  assert.equal(await ex(), -30_000n, 'a credit: a gain of Rs 300');
  assert.equal(await balance(org, 'BANK'), -8_200_000n, 'the rupee bank paid for the dollars; nothing else touched it');

  // paying the $200 vendor bill from it: the dollars leave at the average rupee value, 11,560,000 x 20,000 / 140,000
  await assert.rejects(run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vend, date: '2026-06-22', mode: 'BANK', amount: 0n, accountId: usd, fx: { documentId: bill, foreignAmount: 20_001n }, idempotencyKey: 'usd-over-00001' }, 't')), /outstanding/);
  await run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vend, date: '2026-06-22', mode: 'BANK', amount: 0n, accountId: usd, fx: { documentId: bill, foreignAmount: 20_000n }, idempotencyKey: 'usd-out-000001' }, 't'));
  assert.deepEqual(await held(), { foreign: 120_000n, base: 11_560_000n - 1_651_429n });
  assert.equal(await ex(), -30_000n - 8_571n, 'the bill was booked at 16,600, the dollars cost 16,514.29: a gain');
  assert.equal(await balance(org, 'AP'), 0n);

  // revalue at 85: the account is worth $1,200 x 85, the open $600 invoice 600 x 85; both reverse next day and the booked value is untouched
  await run(org, (c) => saveRate(c, org, { currency: 'USD', date: '2026-06-30', rate: '85' }, 't'));
  const rv = await run(org, (c) => revalue(c, org, '2026-06-30', 't'));
  assert.equal(rv.net, 105_000n + (10_200_000n - 9_908_571n));
  assert.equal(rv.reversed, true);
  const list = (await run(org, (c) => bankAccounts(c, org))).find((a) => a.id === usd)!;
  assert.deepEqual([list.currency, list.book_balance_minor, list.rupee_value_minor], ['USD', 120_000n, 9_908_571n]);
  assert.deepEqual(await held(), { foreign: 120_000n, base: 9_908_571n }, 'the booked value ignores revaluation');

  // sell $500 for Rs 42,500: it leaves at 9,908,571 x 50,000 / 120,000 = 4,128,571
  await xfer(usd, inr, 50_000n, 4_250_000n, '2026-07-05', 'sell-usd-0001');
  assert.deepEqual(await held(), { foreign: 70_000n, base: 9_908_571n - 4_128_571n });
  assert.equal(await ex(), -160_000n, 'gains: 300 + 85.71 + 1,214.29');
  await assert.rejects(xfer(usd, inr, 70_001n, 1n, '2026-07-06', 'sell-usd-0002'), /does not hold that much/);

  // voiding the receipt takes the dollars back out; voiding the sale puts them back
  await run(org, (c) => voidPayment(c, org, rec.id, { date: '2026-07-07', reason: 'bounced' }, 't'));
  assert.equal((await held()).foreign, 70_000n - 40_000n);
  const sold = (await run(org, (c) => listTransfers(c))).find((t) => t.to_account_id === inr && t.status === 'POSTED')!;
  await run(org, (c) => voidTransfer(c, org, sold.id as bigint, { date: '2026-07-08', reason: 'wrong amount' }, 't'));
  assert.equal((await held()).foreign, 70_000n - 40_000n + 50_000n);
});

test('a dollar account is reconciled against its statement in dollars, and a line the books lack is posted at the days rate', { skip }, async () => {
  const { org } = await books();
  const usd = (await run(org, (c) => createBankAccount(c, org, { name: 'Wise', currency: 'USD' }, 't'))).id;
  const inr = await accId(org, 'BANK'); const fees = await accId(org, 'BANK_CHARGES'); const income = await accId(org, 'SALES');
  await run(org, (c) => saveRate(c, org, { currency: 'USD', date: '2026-06-01', rate: '80' }, 't'));
  await run(org, (c) => transfer(c, org, { fromAccountId: inr, toAccountId: usd, date: '2026-06-02', fromAmount: 8_000_000n, toAmount: 100_000n, idempotencyKey: 'rec-buy-00001' }, 't'));
  await run(org, (c) => importStatement(c, org, usd, [{ date: '2026-06-02', description: 'Top up', amount: '1000.00' }, { date: '2026-06-10', description: 'Client', amount: '50.00' }, { date: '2026-06-12', description: 'Card fee', amount: '-4.00' }], 't'));
  const w = await run(org, (c) => workbench(c, org, usd, '2026-06-30'));
  assert.equal(w.statement.find((l) => l.description === 'Top up')!.suggestion_id !== null, true, 'matched on the dollar amount');
  assert.equal(w.summary.bookBalance, 100_000n, 'the balance is in dollars');
  const dep = w.statement.find((l) => l.description === 'Client')!; const fee = w.statement.find((l) => l.description === 'Card fee')!;
  await assert.rejects(run(org, (c) => addEntry(c, org, dep.id as bigint, { counterAccountId: usd }, 't')), /different account/);
  await run(org, (c) => addEntry(c, org, dep.id as bigint, { counterAccountId: income }, 't'));   // $50 at 80
  await run(org, (c) => addEntry(c, org, fee.id as bigint, { counterAccountId: fees }, 't'));      // $4 at the average, 80
  assert.deepEqual(await run(org, (c) => holding(c, usd)), { foreign: 100_000n + 5_000n - 400n, base: 8_000_000n + 400_000n - 32_000n });
  const after = await run(org, (c) => workbench(c, org, usd, '2026-06-30'));
  assert.equal(after.summary.expectedStatementBalance, 100_000n + 5_000n - 400n);
});
