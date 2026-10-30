import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { createProject, getProject } from '../src/projects.ts';
import { advancesAndRetention, getDocument } from '../src/documents.ts';
import { createWorkOrder, listWorkOrders, raiseRaBill, toMilli } from '../src/workorders.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

test('quantities are kept to three decimals', () => {
  assert.equal(toMilli('12.5'), 12_500n); assert.equal(toMilli('7'), 7_000n); assert.equal(toMilli('0.001'), 1n);
  for (const bad of ['', 'a', '1.2345', '-1']) assert.throws(() => toMilli(bad), /not a quantity/);
});

test('RA bills bill only the new work, hold the retention, and cannot go back or over the contract', { skip }, async () => {
  const org = await newOrg(pool);
  const { vend, proj } = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    return { vend: await createParty(c, org, { kind: 'VENDOR', name: 'Sharma Contractors', stateCode: '27' }, 't'), proj: await createProject(c, org, { name: 'Tower A' }, 't') };
  });
  const wo = await run(org, (c) => createWorkOrder(c, org, { projectId: proj, partyId: vend, side: 'PAYABLE', title: 'Plastering', taxCode: 'GST0', retentionPercent: 5,
    items: [{ description: 'Internal plaster', unit: 'SQM', quantity: '1000', rate: '100' }, { description: 'External plaster', unit: 'SQM', quantity: '500', rate: '200' }] }, 't'));
  const [a, b] = (await run(org, (c) => listWorkOrders(c, proj)))[0]!.items;
  const bill1 = await run(org, (c) => raiseRaBill(c, org, wo, { date: '2026-06-10', measured: [{ itemId: a.id, quantity: '400' }, { itemId: b.id, quantity: '100' }] }, 't'));
  const d1 = (await run(org, (c) => getDocument(c, 'BILL', bill1.id)))!;
  assert.equal(d1.subtotal_minor, 60_000_00n);                      // 400 x 100 + 100 x 200
  assert.equal(d1.retention_minor, 3_000_00n);                      // 5%
  const bill2 = await run(org, (c) => raiseRaBill(c, org, wo, { date: '2026-07-10', measured: [{ itemId: a.id, quantity: '700' }] }, 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'BILL', bill2.id)))!.subtotal_minor, 30_000_00n);   // only the 300 new
  await assert.rejects(run(org, (c) => raiseRaBill(c, org, wo, { date: '2026-07-11', measured: [{ itemId: a.id, quantity: '600' }] }, 't')), /cannot be less/);
  await assert.rejects(run(org, (c) => raiseRaBill(c, org, wo, { date: '2026-07-11', measured: [{ itemId: a.id, quantity: '1001' }] }, 't')), /more than/);
  await assert.rejects(run(org, (c) => raiseRaBill(c, org, wo, { date: '2026-07-11', measured: [{ itemId: a.id, quantity: '700' }] }, 't')), /no new work/);
  const w = (await run(org, (c) => listWorkOrders(c, proj)))[0]!;
  assert.equal(w.done_minor, 90_000_00n);                           // 700 x 100 + 100 x 200
  assert.equal(w.bills.length, 2); assert.equal(w.contract_minor, 200_000_00n);
  assert.equal((await run(org, (c) => advancesAndRetention(c))).retention.length, 2);
  assert.equal((await run(org, (c) => getProject(c, proj)))!.bills_minor, 90_000_00n);
});
