import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { advancesAndRetention, setRetention, createPayment, deleteDraft, issueDocument, saveDraft, voidDocument, voidPayment } from '../src/documents.ts';
import { createItem } from '../src/masters.ts';
import { adjust, setTracking } from '../src/stock.ts';
import type { DocKind } from '../src/documents.ts';
import { recordExpense } from '../src/expenses.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { addTime, createProject, deleteTime, getProject, invoiceTime, listProjects, parseMinutes, updateProject } from '../src/projects.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const studio = async () => {
  const org = await newOrg(pool);
  const r = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    const cust = await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '27' }, 't');
    const vend = await createParty(c, org, { kind: 'VENDOR', name: 'Mehta', stateCode: '27' }, 't');
    const rent = (await c.query(`SELECT id FROM accounts WHERE organization_id = $1 AND name = 'Rent'`, [org])).rows[0].id as bigint;
    const proj = await createProject(c, org, { name: 'Website', code: 'WEB', customerId: cust, hourlyRate: '1000', budget: '50000' }, 't');
    return { cust, vend, rent, proj };
  });
  return { org, ...r };
};

test('hours are read as decimals or h:mm and must be between a minute and a day', () => {
  assert.equal(parseMinutes('1.5'), 90); assert.equal(parseMinutes('1:30'), 90); assert.equal(parseMinutes('0:05'), 5); assert.equal(parseMinutes('2'), 120);
  for (const bad of ['0', '25', 'abc', '1:75', '']) assert.throws(() => parseMinutes(bad), /not a time/);
});

test('invoicing the hours makes a draft invoice, marks the time billed, and deleting the draft frees it again', { skip }, async () => {
  const { org, proj } = await studio();
  const a = await run(org, (c) => addTime(c, org, proj, { date: '2026-06-01', hours: '2', notes: 'Design' }, 't'));
  await run(org, (c) => addTime(c, org, proj, { date: '2026-06-02', hours: '1:30', notes: 'Build' }, 't'));
  await run(org, (c) => addTime(c, org, proj, { date: '2026-06-03', hours: '1', billable: false }, 't'));
  let p = await run(org, (c) => getProject(c, proj));
  assert.equal(p!.unbilled_minor, 350_000n);                                 // 3.5 h x 1,000
  const inv = await run(org, (c) => invoiceTime(c, org, proj, { date: '2026-06-10', taxCode: 'GST18' }, 't'));
  assert.equal(inv.entries, 2);
  await assert.rejects(run(org, (c) => invoiceTime(c, org, proj, { date: '2026-06-10', taxCode: 'GST18' }, 't')), /no unbilled/);
  await assert.rejects(run(org, (c) => deleteTime(c, org, a, 't')), /on an invoice/);
  const d = (await pool.query(`SELECT subtotal_minor, project_id FROM documents WHERE id = $1`, [inv.id])).rows[0];
  assert.equal(d.subtotal_minor, 350_000n); assert.equal(d.project_id, proj);
  p = await run(org, (c) => getProject(c, proj));
  assert.equal(p!.unbilled_minor, 0n);
  await run(org, (c) => deleteDraft(c, org, 'INVOICE', inv.id, 't'));
  p = await run(org, (c) => getProject(c, proj));
  assert.equal(p!.unbilled_minor, 350_000n, 'the hours are billable again');
  await run(org, (c) => deleteTime(c, org, a, 't'));
});

test('profit is invoiced work less bills and tagged expenses; a void invoice frees its hours and stops counting', { skip }, async () => {
  const { org, proj, cust, vend, rent } = await studio();
  await run(org, (c) => addTime(c, org, proj, { date: '2026-06-01', hours: '10' }, 't'));
  const inv = await run(org, async (c) => { const r = await invoiceTime(c, org, proj, { date: '2026-06-10', taxCode: 'GST18' }, 't'); await issueDocument(c, org, 'INVOICE', r.id, 't'); return r.id; });
  const mk = (kind: DocKind, party: bigint, price: string) => run(org, async (c) => {
    const id = await saveDraft(c, org, null, { kind, partyId: party, date: '2026-06-12', projectId: proj, supplierRef: kind === 'BILL' ? 'S-1' : undefined, lines: [{ description: 'Hosting', quantity: '1', unitPrice: price, taxCode: 'GST18' }] }, 't');
    await issueDocument(c, org, kind, id, 't'); return id;
  });
  await mk('BILL', vend, '2000');
  await run(org, (c) => recordExpense(c, org, { date: '2026-06-13', accountId: rent, amount: '500', paidWith: 'CASH', description: 'Travel', idempotencyKey: 'pj-exp-1', projectId: proj }, 't'));
  void cust;
  let p = (await run(org, (c) => listProjects(c)))[0]!;
  assert.equal(p.invoiced_minor, 1_000_000n); assert.equal(p.bills_minor, 200_000n); assert.equal(p.expenses_minor, 50_000n);
  assert.equal(p.profit_minor, 750_000n); assert.equal(p.budget_left_minor, 5_000_000n - 250_000n);
  await run(org, (c) => voidDocument(c, org, 'INVOICE', inv, { date: '2026-06-20', reason: 'wrong' }, 't'));
  p = (await run(org, (c) => listProjects(c)))[0]!;
  assert.equal(p.invoiced_minor, 0n); assert.equal(p.unbilled_minor, 1_000_000n);
  await run(org, (c) => updateProject(c, org, proj, { status: 'ARCHIVED' }, 't'));
  await assert.rejects(run(org, (c) => addTime(c, org, proj, { date: '2026-06-21', hours: '1' }, 't')), /archived/);
});

test('the project dashboard: budget, spent by kind of cost, received, and goods counted in stock are charged once, when issued', { skip }, async () => {
  const { org, proj, cust, vend, rent } = await studio();
  const bill = (partyId: bigint, lines: { description?: string; itemId?: bigint; quantity: string; unitPrice: string }[], projectCategory?: string) => run(org, async (c) => {
    const id = await saveDraft(c, org, null, { kind: 'BILL', partyId, date: '2026-06-02', projectId: proj, projectCategory, supplierRef: `S-${Math.random()}`, lines: lines.map((l) => ({ taxCode: 'GST0', ...l })) }, 't');
    await issueDocument(c, org, 'BILL', id, 't'); return id;
  });
  await assert.rejects(run(org, (c) => saveDraft(c, org, null, { kind: 'BILL', partyId: vend, date: '2026-06-02', projectId: proj, projectCategory: 'Snacks', lines: [{ description: 'x', quantity: '1', unitPrice: '1', taxCode: 'GST0' }] }, 't')), /kind of cost/);
  await bill(vend, [{ description: 'Mason work', quantity: '1', unitPrice: '10000' }], 'Contractors');
  await run(org, (c) => recordExpense(c, org, { date: '2026-06-03', accountId: rent, amount: '2000', paidWith: 'CASH', description: 'Labour', idempotencyKey: 'dash-exp-01', projectId: proj, projectCategory: 'Labour' }, 't'));
  // 10 bags of cement bought for the project and counted in stock: cost is 1,000 but it reaches the project only when 4 are issued to it
  const cement = await run(org, async (c) => { const i = await createItem(c, org, { sku: 'CEM', name: 'Cement', purchasePrice: '100', salePrice: '0', taxCode: 'GST0' }, 't'); await setTracking(c, org, i, { trackStock: true }, 't'); return i; });
  await bill(vend, [{ itemId: cement, quantity: '10', unitPrice: '100' }]);
  let p = (await run(org, (c) => getProject(c, proj)))!;
  assert.equal(p.cost_minor, 1_200_000n, 'only the mason and the labour so far');
  await run(org, (c) => adjust(c, org, { itemId: cement, date: '2026-06-04', direction: 'OUT', quantity: '4', counterAccount: 'COGS', reason: 'slab', projectId: proj }, 't'));
  // an invoice to the owner, part paid
  const inv = await run(org, async (c) => { const id = await saveDraft(c, org, null, { kind: 'INVOICE', partyId: cust, date: '2026-06-05', projectId: proj, lines: [{ description: 'Stage 1', quantity: '1', unitPrice: '30000', taxCode: 'GST0' }] }, 't'); await issueDocument(c, org, 'INVOICE', id, 't'); return id; });
  const pay = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-06', mode: 'BANK', amount: 1_200_000n, allocations: [{ documentId: inv, amount: 1_200_000n }], idempotencyKey: 'dash-pay-0001' }, 't'));
  p = (await run(org, (c) => getProject(c, proj)))!;
  assert.equal(p.cost_minor, 1_000_000n + 200_000n + 40_000n);               // 10,000 + 2,000 + 4 bags at 100
  assert.deepEqual(p.breakdown.map((b) => [b.category, b.amount_minor]), [['Materials', 40_000n], ['Labour', 200_000n], ['Contractors', 1_000_000n]]);
  assert.equal(p.breakdown.reduce((a, b) => a + b.amount_minor, 0n), p.cost_minor, 'the parts add up to the total');
  assert.equal(p.breakdown.reduce((a, b) => a + b.share_bp, 0) <= 10_000, true);
  assert.equal(p.receipts_minor, 1_200_000n); assert.equal(p.invoiced_minor, 3_000_000n);
  assert.equal(p.budget_left_minor, 5_000_000n - p.cost_minor);
  await run(org, (c) => voidPayment(c, org, pay.id as bigint, { date: '2026-06-07', reason: 'bounced' }, 't'));
  assert.equal((await run(org, (c) => getProject(c, proj)))!.receipts_minor, 0n, 'a voided receipt stops counting');
});

test('retention holds part of a bill: it cannot be paid until released, and the books still balance', { skip }, async () => {
  const { org, vend } = await studio();
  const bill = await run(org, async (c) => {
    const id = await saveDraft(c, org, null, { kind: 'BILL', partyId: vend, date: '2026-06-02', supplierRef: 'R-1', lines: [{ description: 'Slab work', quantity: '1', unitPrice: '1000', taxCode: 'GST0' }] }, 't');
    await issueDocument(c, org, 'BILL', id, 't'); return id;
  });
  await run(org, (c) => setRetention(c, org, bill, 5_000n, 't'));
  const pay = (key: string, amt: bigint) => run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vend, date: '2026-06-05', mode: 'BANK', amount: amt, allocations: [{ documentId: bill, amount: amt }], idempotencyKey: key }, 't'));
  await assert.rejects(pay('ret-pay-0001', 100_000n), /held as retention/);
  await pay('ret-pay-0002', 95_000n);
  const mid = await run(org, (c) => advancesAndRetention(c));
  assert.equal(mid.retention.length, 1); assert.equal(mid.retention[0].balance_minor, 5_000n);
  await assert.rejects(run(org, (c) => setRetention(c, org, bill, 9_000n, 't')), /between zero/);
  await run(org, (c) => setRetention(c, org, bill, 0n, 't'));
  await pay('ret-pay-0003', 5_000n);
  const end = await run(org, (c) => advancesAndRetention(c));
  assert.equal(end.retention.length, 0);
});

test('a payment made ahead of the bill shows as an advance until it is applied', { skip }, async () => {
  const { org, vend } = await studio();
  await run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vend, date: '2026-06-01', mode: 'BANK', amount: 30_000n, idempotencyKey: 'adv-pay-0001' }, 't'));
  const a = await run(org, (c) => advancesAndRetention(c));
  assert.equal(a.advances.length, 1); assert.equal(a.advances[0].unallocated_minor, 30_000n);
});
