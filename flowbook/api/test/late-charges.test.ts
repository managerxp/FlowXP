import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { gstDue, gstInterest, gstLateFee, lateCharges } from '../src/gstr.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);
const gstin = (state: string, pan: string) => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, d.kind, id, 't'); return id; });

test('due dates, late fee and interest follow the usual rules, and the caps hold', () => {
  assert.equal(gstDue('GSTR1', '2026-06'), '2026-07-11');
  assert.equal(gstDue('GSTR3B', '2026-06'), '2026-07-20');
  assert.equal(gstDue('GSTR3B', '2026-12'), '2027-01-20');
  assert.deepEqual(gstLateFee(5), { perDay: 50, cap: 2000, total: 250, cgst: 125, sgst: 125 });
  assert.equal(gstLateFee(0).total, 0);
  assert.equal(gstLateFee(500).total, 2000);                                  // capped
  assert.equal(gstLateFee(500, { band: 'UPTO_5CR' }).total, 5000);
  assert.equal(gstLateFee(500, { band: 'ABOVE_5CR' }).total, 10000);
  assert.deepEqual(gstLateFee(10, { nil: true }), { perDay: 20, cap: 500, total: 200, cgst: 100, sgst: 100 });
  assert.equal(gstLateFee(100, { nil: true }).total, 500);
  assert.equal(gstInterest(10_000, 10), 49);                                  // 10,000 x 18% x 10 / 365
  assert.equal(gstInterest(10_000, 0), 0);
  assert.equal(gstInterest(0, 10), 0);
});

test('late charges for a month: late fee on the filing date, interest on the tax paid after the due date', { skip }, async () => {
  const org = await newOrg(pool);
  const buyer = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27', gstin = $2 WHERE id = $1`, [org, gstin('27', 'AAAAA0000A')]);
    await seedTaxRates(c, org); await openFinancialYear(c, org, 2027, 4, 't');
    return createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Stores', stateCode: '27' }, 't');
  });
  await issue(org, { kind: 'INVOICE', partyId: buyer, date: '2026-06-10', lines: [{ description: 'Service', hsnSac: '9983', quantity: '1', unitPrice: '10000', taxCode: 'GST18' }] });   // tax 1,800
  const r = await run(org, (c) => lateCharges(c, org, { month: '2026-06', form: 'GSTR3B', filedOn: '2026-07-25', paidOn: '2026-07-30' }));
  assert.equal(r.dueOn, '2026-07-20');
  assert.equal(r.cashTax, 1800);
  assert.equal(r.daysLateFiling, 5); assert.equal(r.lateFee.total, 250);
  assert.equal(r.interest.days, 10); assert.equal(r.interest.amount, 9);       // 1,800 x 18% x 10 / 365 = 8.88
  assert.equal(r.total, 259);
  // on time: nothing to pay
  const ok = await run(org, (c) => lateCharges(c, org, { month: '2026-06', form: 'GSTR3B', filedOn: '2026-07-20', paidOn: '2026-07-19' }));
  assert.equal(ok.total, 0);
  // GSTR-1 has a late fee but no interest, and a typed due date and rates win
  const g1 = await run(org, (c) => lateCharges(c, org, { month: '2026-06', form: 'GSTR1', filedOn: '2026-07-21', paidOn: '2026-07-30', dueOn: '2026-07-16', feePerDay: 10, feeCap: 30 }));
  assert.equal(g1.lateFee.total, 30); assert.equal(g1.interest.amount, 0);
});
