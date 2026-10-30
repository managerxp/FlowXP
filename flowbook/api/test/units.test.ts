import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createPayment } from '../src/documents.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { createProject, getProject } from '../src/projects.ts';
import { addUnit, listUnits, raiseStage, sellUnit } from '../src/units.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

test('a flat is sold in stages: each stage becomes an invoice, receipts count against it, and the stages must add up', { skip }, async () => {
  const org = await newOrg(pool);
  const { cust, proj, unit } = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    const cust = await createParty(c, org, { kind: 'CUSTOMER', name: 'Buyer', stateCode: '27' }, 't');
    const proj = await createProject(c, org, { name: 'Tower A', budget: '0' }, 't');
    return { cust, proj, unit: await addUnit(c, org, proj, { name: 'A-101', price: '5000000' }, 't') };
  });
  await assert.rejects(run(org, (c) => addUnit(c, org, proj, { name: 'A-101', price: '1' }, 't')), /already a unit/);
  const two = [{ name: 'Booking', percent: 10 }, { name: 'Slab', percent: 50 }];
  await assert.rejects(run(org, (c) => sellUnit(c, org, unit, { partyId: cust, date: '2026-06-01', stages: two }, 't')), /add up to 100/);
  await run(org, (c) => sellUnit(c, org, unit, { partyId: cust, date: '2026-06-01', stages: [...two, { name: 'Possession', percent: 40, dueDate: '2026-12-01' }] }, 't'));
  await assert.rejects(run(org, (c) => sellUnit(c, org, unit, { partyId: cust, date: '2026-06-01', stages: [{ name: 'All', percent: 100 }] }, 't')), /already has a buyer/);
  let u = (await run(org, (c) => listUnits(c, proj)))[0]!;
  assert.equal(u.status, 'SOLD'); assert.deepEqual(u.stages.map((s: any) => s.amount_minor), [500_000_00n, 2_500_000_00n, 2_000_000_00n]);
  const inv = await run(org, (c) => raiseStage(c, org, u.stages[0].id, '2026-06-02', 't'));
  await assert.rejects(run(org, (c) => raiseStage(c, org, u.stages[0].id, '2026-06-02', 't')), /already raised/);
  await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-03', mode: 'BANK', amount: 200_000_00n, allocations: [{ documentId: inv.id, amount: 200_000_00n }], idempotencyKey: 'unit-pay-0001' }, 't'));
  u = (await run(org, (c) => listUnits(c, proj)))[0]!;
  assert.equal(u.invoiced_minor, 500_000_00n); assert.equal(u.received_minor, 200_000_00n);
  assert.equal((await run(org, (c) => getProject(c, proj)))!.receipts_minor, 200_000_00n);
});
