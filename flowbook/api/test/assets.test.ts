import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { addAsset, assetRegister, cancelAsset, disposeAsset, runDepreciation } from '../src/assets.ts';
import type { AssetIn } from '../src/assets.ts';
import { openFinancialYear } from '../src/periods.ts';
import { seedTaxRates } from '../src/masters.ts';
import { gstr3b } from '../src/gstr.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const books = async () => { const org = await newOrg(pool); await run(org, (c) => openFinancialYear(c, org, 2027, 4, 't')); return org; };
const bal = async (org: bigint, key: string) => (await pool.query(
  `SELECT COALESCE(SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::bigint AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.organization_id = $1 AND a.system_key = $2`, [org, key])).rows[0].b as bigint;
const laptop: AssetIn = { name: 'Laptop', tag: 'LT-1', purchaseDate: '2026-04-10', cost: '120000', method: 'SLM', lifeYears: '5', paidFrom: 'BANK' };

test('straight-line depreciation posts a month at a time, once, and the register agrees with the books', { skip }, async () => {
  const org = await books();
  const { id } = await run(org, (c) => addAsset(c, org, laptop, 't'));
  assert.equal(await bal(org, 'FIXED_ASSETS'), 12_000_000n); assert.equal(await bal(org, 'BANK'), -12_000_000n);
  await assert.rejects(run(org, (c) => addAsset(c, org, laptop, 't')), /already used/);
  await assert.rejects(run(org, (c) => runDepreciation(c, org, 'June', 't')), /YYYY-MM/);

  const done = await run(org, (c) => runDepreciation(c, org, '2026-06', 't'));
  assert.deepEqual(done.map((d) => [d.month, d.total]), [['2026-04', 200_000n], ['2026-05', 200_000n], ['2026-06', 200_000n]]);
  assert.deepEqual(await run(org, (c) => runDepreciation(c, org, '2026-06', 't')), [], 'running it again adds nothing');
  assert.equal(await bal(org, 'DEPRECIATION'), 600_000n); assert.equal(await bal(org, 'ACCUM_DEPRECIATION'), -600_000n);
  const reg = await run(org, (c) => assetRegister(c));
  assert.equal(reg.totals.book_value_minor, 12_000_000n - 600_000n);
  assert.equal(reg.totals.cost_minor, await bal(org, 'FIXED_ASSETS')); assert.equal(reg.totals.accumulated_minor, -(await bal(org, 'ACCUM_DEPRECIATION')));
  assert.equal(reg.assets[0]!.depreciated_through, '2026-06');
  await assert.rejects(run(org, (c) => cancelAsset(c, org, id, 'oops', '2026-07-01', 't')), /depreciation has been posted/);
});

test('written-down value takes a twelfth of the yearly rate of what is left, and never goes below scrap value', { skip }, async () => {
  const org = await books();
  await run(org, (c) => addAsset(c, org, { name: 'Machine', purchaseDate: '2026-04-01', cost: '100000', method: 'WDV', ratePercent: '15', paidFrom: 'BANK' }, 't'));
  const done = await run(org, (c) => runDepreciation(c, org, '2026-05', 't'));
  assert.equal(done[0]!.total, 125_000n);                          // 100,000 x 15% / 12 = 1,250.00
  assert.equal(done[1]!.total, 123_438n);                          // 98,750 x 15% / 12 = 1,234.375
  const org2 = await books();
  await run(org2, (c) => addAsset(c, org2, { name: 'Chair', purchaseDate: '2026-04-01', cost: '12000', salvage: '2000', method: 'SLM', lifeYears: '1', paidFrom: 'CASH' }, 't'));
  const all = await run(org2, (c) => runDepreciation(c, org2, '2027-03', 't'));
  assert.equal(all.length, 12);
  assert.equal(all.reduce((s, d) => s + d.total, 0n), 1_000_000n, 'exactly cost minus scrap, rounding included');
  assert.deepEqual(await run(org2, (c) => runDepreciation(c, org2, '2027-06', 't')), [], 'nothing more once at scrap value');
});

test('a sale clears cost and accumulated depreciation and posts the gain or loss; depreciation must be up to date first', { skip }, async () => {
  const org = await books();
  const { id } = await run(org, (c) => addAsset(c, org, laptop, 't'));
  await run(org, (c) => runDepreciation(c, org, '2026-06', 't'));
  await assert.rejects(run(org, (c) => disposeAsset(c, org, id, { date: '2026-08-15', proceeds: '100000', receivedIn: 'BANK' }, 't')), /through 2026-07 first/);
  await run(org, (c) => runDepreciation(c, org, '2026-07', 't'));
  await assert.rejects(run(org, (c) => disposeAsset(c, org, id, { date: '2026-08-15', proceeds: '100000' }, 't')), /where the money went/);
  // 4 months taken: 8,000; book value 112,000; sold for 100,000: a loss of 12,000
  const out = await run(org, (c) => disposeAsset(c, org, id, { date: '2026-08-15', proceeds: '100000', receivedIn: 'BANK' }, 't'));
  assert.equal(out.gain, -1_200_000n);
  assert.equal(await bal(org, 'FIXED_ASSETS'), 0n); assert.equal(await bal(org, 'ACCUM_DEPRECIATION'), 0n);
  assert.equal(await bal(org, 'ASSET_SALE_GAIN_LOSS'), 1_200_000n, 'a debit: a loss');
  assert.equal(await bal(org, 'BANK'), -12_000_000n + 10_000_000n);
  await assert.rejects(run(org, (c) => disposeAsset(c, org, id, { date: '2026-08-16', proceeds: '0' }, 't')), /already/);
  assert.equal((await run(org, (c) => assetRegister(c))).totals.book_value_minor, 0n);
  // and a write-off of one already fully written down is a plain zero
  const { id: b } = await run(org, (c) => addAsset(c, org, { name: 'Old press', purchaseDate: '2020-04-01', cost: '50000', method: 'NONE', openingAccumulated: '50000', salvage: '0', paidFrom: 'OPENING_BALANCE' }, 't'));
  const w = await run(org, (c) => disposeAsset(c, org, b, { date: '2026-09-01', proceeds: '0' }, 't'));
  assert.equal(w.gain, 0n);
  assert.equal(await bal(org, 'FIXED_ASSETS'), 0n);
});

test('an asset already owned comes in against opening balances, and a mistaken one can be cancelled before any depreciation', { skip }, async () => {
  const org = await books();
  await assert.rejects(run(org, (c) => addAsset(c, org, { ...laptop, tag: undefined, openingAccumulated: '10000' }, 't')), /Already owned|already had/);
  await run(org, (c) => addAsset(c, org, { name: 'Lathe', purchaseDate: '2024-04-01', startDate: '2026-04-01', cost: '50000', openingAccumulated: '20000', method: 'SLM', lifeYears: '10', paidFrom: 'OPENING_BALANCE' }, 't'));
  assert.equal(await bal(org, 'FIXED_ASSETS'), 5_000_000n); assert.equal(await bal(org, 'ACCUM_DEPRECIATION'), -2_000_000n); assert.equal(await bal(org, 'OPENING_BALANCE'), -3_000_000n);
  const done = await run(org, (c) => runDepreciation(c, org, '2026-04', 't'));
  assert.equal(done[0]!.total, 41_667n);                          // 50,000 over 120 months
  const { id } = await run(org, (c) => addAsset(c, org, { ...laptop, tag: 'LT-2', purchaseDate: '2026-05-01' }, 't'));
  await run(org, (c) => cancelAsset(c, org, id, 'entered twice', '2026-05-02', 't'));
  assert.equal((await run(org, (c) => assetRegister(c))).assets.length, 1);
  assert.equal(await bal(org, 'FIXED_ASSETS'), 5_000_000n);
});

test('GST on the sale of an asset goes to output tax, not to the gain, and shows in GSTR-3B for the month', { skip }, async () => {
  const org = await books();
  await run(org, (c) => seedTaxRates(c, org));
  const { id } = await run(org, (c) => addAsset(c, org, laptop, 't'));
  await run(org, (c) => runDepreciation(c, org, '2026-07', 't'));
  await assert.rejects(run(org, (c) => disposeAsset(c, org, id, { date: '2026-08-15', proceeds: '0', taxCode: 'GST18' }, 't')), /needs a sale price/);
  const out = await run(org, (c) => disposeAsset(c, org, id, { date: '2026-08-15', proceeds: '100000', receivedIn: 'BANK', taxCode: 'GST18' }, 't'));
  assert.equal(out.gain, -1_200_000n, 'the gain or loss is worked on the price before GST');
  assert.equal(await bal(org, 'OUTPUT_CGST'), -900_000n); assert.equal(await bal(org, 'OUTPUT_SGST'), -900_000n);
  assert.equal(await bal(org, 'BANK'), -12_000_000n + 11_800_000n, 'the bank got the price plus GST');
  const f = (await run(org, (c) => gstr3b(c, org, '2026-08'))).file.sup_details.osup_det;
  assert.deepEqual([f.txval, f.camt, f.samt, f.iamt], [100000, 9000, 9000, 0]);
});
