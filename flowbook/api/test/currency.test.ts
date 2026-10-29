import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { allocatePayment, createPayment, getDocument, getPayment, issueDocument, saveDraft, voidDocument, voidPayment } from '../src/documents.ts';
import type { DocKind } from '../src/documents.ts';
import { listRates, rateOn, saveRate } from '../src/fx.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
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

test('a foreign-currency invoice is booked in rupees at its rate, and a payment that brings fewer rupees posts an exchange loss', { skip }, async () => {
  const { org, cust } = await books();
  await assert.rejects(make(org, 'INVOICE', cust, 'USD'), /no USD rate saved/);
  await assert.rejects(make(org, 'INVOICE', cust, 'XYZ', { fxRate: '1' }), /not a currency/);
  await run(org, (c) => saveRate(c, org, { currency: 'USD', date: '2026-05-30', rate: '83.25' }, 't'));
  assert.equal(await run(org, (c) => rateOn(c, 'USD', '2026-06-01')), '83.250000');
  assert.equal(await run(org, (c) => rateOn(c, 'USD', '2026-05-01')), null, 'no rate before the first one saved');
  assert.equal((await run(org, (c) => listRates(c))).length, 1);

  const inv = await make(org, 'INVOICE', cust, 'USD');           // 2 x $500 = $1000 at 83.25 = Rs 83,250
  let d = (await run(org, (c) => getDocument(c, 'INVOICE', inv)))!;
  assert.equal(d.currency, 'USD'); assert.equal(d.fx_rate, '83.250000');
  assert.equal(d.total_minor, 8_325_000n); assert.equal(d.foreign_total_minor, 100_000n); assert.equal(d.foreign_balance_minor, 100_000n);
  assert.equal(await balance(org, 'AR'), 8_325_000n);

  await assert.rejects(run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-20', mode: 'BANK', amount: 8_000_000n, allocations: [{ documentId: inv, amount: 8_000_000n }], idempotencyKey: 'inr-against-usd-1' }, 't')), /is in USD/);

  // $400 settled, Rs 33,000 arrive: the $400 was booked at 33,300, so Rs 300 is lost
  await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-20', mode: 'BANK', amount: 3_300_000n, fx: { documentId: inv, foreignAmount: 40_000n }, idempotencyKey: 'usd-part-0001' }, 't'));
  d = (await run(org, (c) => getDocument(c, 'INVOICE', inv)))!;
  assert.equal(d.balance_minor, 8_325_000n - 3_330_000n); assert.equal(d.foreign_balance_minor, 60_000n);
  assert.equal(await balance(org, 'BANK'), 3_300_000n);
  assert.equal(await balance(org, 'EXCHANGE_GAIN_LOSS'), 30_000n, 'a debit: a loss of Rs 300');
  assert.equal(await balance(org, 'AR'), 4_995_000n);

  // the rest, $600, brings Rs 50,100 against 49,950 booked: a gain of Rs 150
  const last = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-25', mode: 'BANK', amount: 5_010_000n, fx: { documentId: inv, foreignAmount: 60_000n }, idempotencyKey: 'usd-rest-0001' }, 't'));
  d = (await run(org, (c) => getDocument(c, 'INVOICE', inv)))!;
  assert.equal(d.balance_minor, 0n); assert.equal(d.foreign_balance_minor, 0n);
  assert.equal(await balance(org, 'AR'), 0n);
  assert.equal(await balance(org, 'EXCHANGE_GAIN_LOSS'), 30_000n - 15_000n);
  const p = (await run(org, (c) => getPayment(c, last.id)))!;
  assert.equal(p.unallocated_minor, 0n); assert.equal(p.currency, 'USD');
  await assert.rejects(run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-26', mode: 'BANK', amount: 100n, fx: { documentId: inv, foreignAmount: 100n }, idempotencyKey: 'usd-over-0001' }, 't')), /outstanding/);

  // voiding the last payment brings the document and the foreign balance back
  await run(org, (c) => voidPayment(c, org, last.id, { date: '2026-06-27', reason: 'bounced' }, 't'));
  d = (await run(org, (c) => getDocument(c, 'INVOICE', inv)))!;
  assert.equal(d.balance_minor, 4_995_000n); assert.equal(d.foreign_balance_minor, 60_000n);
  assert.equal(await balance(org, 'EXCHANGE_GAIN_LOSS'), 30_000n);
});

test('a foreign vendor bill settled for fewer rupees than booked is a gain; notes, rounding and plain allocation are refused', { skip }, async () => {
  const { org, cust, vend } = await books();
  const bill = await make(org, 'BILL', vend, 'EUR', { fxRate: '90', unitPrice: '100' });   // 2 x 100 = EUR 200 = Rs 18,000
  assert.equal(await balance(org, 'AP'), -1_800_000n);
  await run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vend, date: '2026-06-10', mode: 'BANK', amount: 1_770_000n, fx: { documentId: bill, foreignAmount: 20_000n }, idempotencyKey: 'eur-pay-00001' }, 't'));
  assert.equal(await balance(org, 'AP'), 0n);
  assert.equal(await balance(org, 'BANK'), -1_770_000n);
  assert.equal(await balance(org, 'EXCHANGE_GAIN_LOSS'), -30_000n, 'a credit: a gain of Rs 300');
  await assert.rejects(run(org, (c) => voidDocument(c, org, 'BILL', bill, { date: '2026-06-11', reason: 'x' }, 't')), /applied/);

  await assert.rejects(run(org, (c) => saveDraft(c, org, null, { kind: 'CREDIT_NOTE', partyId: cust, date: '2026-06-01', currency: 'USD', fxRate: '80', lines: [{ description: 'x', unitPrice: '1', taxCode: 'GST0' }] }, 't')), /written in rupees/);
  await assert.rejects(run(org, (c) => saveDraft(c, org, null, { kind: 'INVOICE', partyId: cust, date: '2026-06-01', currency: 'USD', fxRate: '80', roundOff: true, lines: [{ description: 'x', unitPrice: '1', taxCode: 'GST0' }] }, 't')), /rounded off/);
  // a rupee payment cannot be allocated to a foreign invoice later either
  const inv = await make(org, 'INVOICE', cust, 'USD', { fxRate: '80', unitPrice: '10' });
  const adv = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-02', mode: 'BANK', amount: 5_000n, idempotencyKey: 'inr-advance-01' }, 't'));
  await assert.rejects(run(org, (c) => allocatePayment(c, org, adv.id, [{ documentId: inv, amount: 5_000n }], 't')), /in USD/);
});

test('an invoice in rupees is untouched: no foreign total, ordinary payment', { skip }, async () => {
  const { org, cust } = await books();
  const inv = await make(org, 'INVOICE', cust, 'INR');
  const d = (await run(org, (c) => getDocument(c, 'INVOICE', inv)))!;
  assert.equal(d.currency, 'INR'); assert.equal(d.foreign_total_minor, null);
  await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-03', mode: 'CASH', amount: 100_000n, allocations: [{ documentId: inv, amount: 100_000n }], idempotencyKey: 'plain-inr-0001' }, 't'));
  assert.equal(await balance(org, 'AR'), 0n);
});
