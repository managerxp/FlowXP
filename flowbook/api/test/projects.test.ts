import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { deleteDraft, issueDocument, saveDraft, voidDocument } from '../src/documents.ts';
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
