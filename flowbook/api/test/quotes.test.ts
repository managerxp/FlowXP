import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { convertDocument, getDocument, issueDocument, listDocuments, saveDraft, setOutcome, voidDocument } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { partyStatement } from '../src/statement.ts';
import { trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

test('a quote posts nothing, can be accepted, becomes a sales order and then an invoice', { skip }, async () => {
  const org = await newOrg(pool);
  const cust = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27' WHERE id = $1`, [org]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '27' }, 't');
  });
  const d: DocIn = { kind: 'QUOTE', partyId: cust, date: '2026-06-01', dueDate: '2026-06-30', roundOff: true, lines: [{ description: 'Machine', quantity: '2', unitPrice: '1000', taxCode: 'GST18', unit: 'NOS' }] };
  const q = await run(org, async (c) => { const x = await saveDraft(c, org, null, d, 't'); const n = await issueDocument(c, org, 'QUOTE', x, 't'); return { id: x, ...n }; });
  assert.match(q.number, /^QUO-26-27-000001$/);
  const doc = await run(org, (c) => getDocument(c, 'QUOTE', q.id));
  assert.deepEqual([doc?.status, doc?.total_minor, doc?.balance_minor], ['ISSUED', 236_000n, 0n]);
  assert.equal((await run(org, (c) => trialBalance(c, org, { from: '2026-04-01', to: '2027-03-31' }))).rows.length, 0, 'nothing was posted');
  assert.equal((await run(org, (c) => partyStatement(c, cust, '2026-04-01', '2026-12-31'))).closing, 0n, 'and nothing is owed');

  await assert.rejects(run(org, (c) => convertDocument(c, org, q.id, 'INVOICE', '2026-06-05', 't')).then(() => run(org, (c) => convertDocument(c, org, q.id, 'INVOICE', '2026-06-06', 't'))), /already turned/);
  const second = await run(org, (c) => listDocuments(c, 'INVOICE', { limit: 10 }));
  assert.equal(second.length, 1, 'one invoice draft came from it');
  assert.deepEqual([second[0]?.status, second[0]?.total_minor], ['DRAFT', 236_000n]);
  await assert.rejects(run(org, (c) => voidDocument(c, org, 'QUOTE', q.id, { date: '2026-06-07', reason: 'x' }, 't')), /already turned/);
});

test('quote to order to invoice; declined or unsent ones cannot convert; an order voids freely', { skip }, async () => {
  const org = await newOrg(pool);
  const cust = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27' WHERE id = $1`, [org]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '27' }, 't');
  });
  const mk = (kind: 'QUOTE' | 'SALES_ORDER') => run(org, async (c) => { const x = await saveDraft(c, org, null, { kind, partyId: cust, date: '2026-06-01', lines: [{ description: 'Item', quantity: '1', unitPrice: '500', taxCode: 'GST0' }] }, 't'); return x; });
  const draft = await mk('QUOTE');
  await assert.rejects(run(org, (c) => convertDocument(c, org, draft, 'INVOICE', '2026-06-02', 't')), /send it first/);
  const q = await mk('QUOTE'); await run(org, (c) => issueDocument(c, org, 'QUOTE', q, 't'));
  await run(org, (c) => setOutcome(c, org, q, 'DECLINED', 't'));
  await assert.rejects(run(org, (c) => convertDocument(c, org, q, 'SALES_ORDER', '2026-06-02', 't')), /declined/);
  const q2 = await mk('QUOTE'); await run(org, (c) => issueDocument(c, org, 'QUOTE', q2, 't'));
  await run(org, (c) => setOutcome(c, org, q2, 'ACCEPTED', 't'));
  const so = (await run(org, (c) => convertDocument(c, org, q2, 'SALES_ORDER', '2026-06-02', 't'))).id;
  assert.equal((await run(org, (c) => getDocument(c, 'SALES_ORDER', so)))?.related_document_id, q2);
  await run(org, (c) => issueDocument(c, org, 'SALES_ORDER', so, 't'));
  await assert.rejects(run(org, (c) => convertDocument(c, org, so, 'SALES_ORDER', '2026-06-03', 't')), /becomes an invoice/);
  const inv = (await run(org, (c) => convertDocument(c, org, so, 'INVOICE', '2026-06-03', 't'))).id;
  assert.equal((await run(org, (c) => getDocument(c, 'INVOICE', inv)))?.status, 'DRAFT');
  const so2 = await mk('SALES_ORDER'); await run(org, (c) => issueDocument(c, org, 'SALES_ORDER', so2, 't'));
  await run(org, (c) => voidDocument(c, org, 'SALES_ORDER', so2, { date: '2026-06-04', reason: 'cancelled' }, 't'));
  assert.equal((await run(org, (c) => getDocument(c, 'SALES_ORDER', so2)))?.status, 'VOID');
});
