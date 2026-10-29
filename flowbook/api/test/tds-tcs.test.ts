import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createPayment, getPayment, issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { salesAnalysis } from '../src/analysis.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { partyStatement } from '../src/statement.ts';
import { trialBalance } from '../src/reports.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const shop = async () => {
  const org = await newOrg(pool);
  const parties = await run(org, async (c) => {
    await c.query(`UPDATE organizations SET state_code = '27' WHERE id = $1`, [org]);
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return { cust: await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '27' }, 't'), vend: await createParty(c, org, { kind: 'VENDOR', name: 'Mehta', stateCode: '27' }, 't') };
  });
  return { org, ...parties };
};
const balances = async (org: bigint) => {
  const tb = await run(org, (c) => trialBalance(c, org, { from: '2026-04-01', to: '2027-03-31' }));
  return Object.fromEntries(tb.rows.map((r) => [r.name, [r.debitBalance, r.creditBalance]]));
};

test('TDS a customer deducts is receivable, settles the invoice in full, and shows on the statement', { skip }, async () => {
  const { org, cust } = await shop();
  const d: DocIn = { kind: 'INVOICE', partyId: cust, date: '2026-06-10', lines: [{ description: 'Consulting', quantity: '1', unitPrice: '100000', taxCode: 'GST0' }] };
  const inv = await run(org, async (c) => { const x = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, 'INVOICE', x, 't'); return x; });
  const pay = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-20', mode: 'BANK', amount: 9_000_000n, tds: 1_000_000n, tdsSection: '194J', idempotencyKey: 'tds-in-0001', allocations: [{ documentId: inv, amount: 10_000_000n }] }, 't'));
  const bal = await balances(org);
  assert.deepEqual([bal['Bank'], bal['TDS receivable'], bal['Accounts receivable']], [[9_000_000n, 0n], [1_000_000n, 0n], [0n, 0n]], 'AR is cleared by cash plus TDS');
  const p = await run(org, (c) => getPayment(c, pay.id));
  assert.deepEqual([p?.amount_minor, p?.tds_minor, p?.tds_section, p?.unallocated_minor], [9_000_000n, 1_000_000n, '194J', 0n]);
  assert.equal((await pool.query(`SELECT balance_minor FROM documents WHERE id = $1`, [inv])).rows[0].balance_minor, 0n);
  const st = await run(org, (c) => partyStatement(c, cust, '2026-04-01', '2026-12-31'));
  assert.equal(st.closing, 0n, 'the statement agrees with the ledger');
  await assert.rejects(run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: cust, date: '2026-06-21', mode: 'BANK', amount: 100n, tds: 100n, idempotencyKey: 'tds-in-0002', allocations: [{ documentId: inv, amount: 500n }] }, 't')), /outstanding/);
});

test('TDS deducted from a vendor payment is owed to the government', { skip }, async () => {
  const { org, vend } = await shop();
  await run(org, (c) => createPayment(c, org, { direction: 'OUT', partyId: vend, date: '2026-06-20', mode: 'BANK', amount: 9_000_000n, tds: 1_000_000n, tdsSection: '194C', idempotencyKey: 'tds-out-0001' }, 't'));
  const bal = await balances(org);
  assert.deepEqual([bal['Bank'], bal['TDS payable'], bal['Accounts payable']], [[0n, 9_000_000n], [0n, 1_000_000n], [10_000_000n, 0n]], 'a debit on payables for the full amount settled');
});

test('TCS is added to the invoice total and owed to the government', { skip }, async () => {
  const { org, cust } = await shop();
  const d: DocIn = { kind: 'INVOICE', partyId: cust, date: '2026-06-10', tcsRateBp: 100, tcsSection: '206C(1)', lines: [{ description: 'Scrap', quantity: '1', unitPrice: '100000', taxCode: 'GST18' }] };
  const id = await run(org, async (c) => { const x = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, 'INVOICE', x, 't'); return x; });
  const row = (await pool.query(`SELECT subtotal_minor, tax_minor, tcs_minor, total_minor FROM documents WHERE id = $1`, [id])).rows[0];
  assert.deepEqual([row.subtotal_minor, row.tax_minor, row.tcs_minor, row.total_minor], [10_000_000n, 1_800_000n, 118_000n, 11_918_000n], 'TCS is 1% of value plus GST');
  const bal = await balances(org);
  assert.deepEqual([bal['TCS payable'], bal['Accounts receivable']], [[0n, 118_000n], [11_918_000n, 0n]]);
  await assert.rejects(run(org, (c) => saveDraft(c, org, null, { ...d, kind: 'CREDIT_NOTE', relatedDocumentId: id }, 't')), /TCS is collected on sales invoices only/);
});

test('sales analysis ranks customers and items and nets credit notes', { skip }, async () => {
  const { org, cust } = await shop();
  const line = { description: 'Widget', quantity: '2', unitPrice: '1000', taxCode: 'GST18' };
  const inv = await run(org, async (c) => { const x = await saveDraft(c, org, null, { kind: 'INVOICE', partyId: cust, date: '2026-06-10', lines: [line] }, 't'); await issueDocument(c, org, 'INVOICE', x, 't'); return x; });
  await run(org, async (c) => { const x = await saveDraft(c, org, null, { kind: 'CREDIT_NOTE', partyId: cust, date: '2026-07-02', relatedDocumentId: inv, lines: [{ ...line, quantity: '1' }] }, 't'); await issueDocument(c, org, 'CREDIT_NOTE', x, 't'); });
  const a = await run(org, (c) => salesAnalysis(c, '2026-04-01', '2027-03-31'));
  assert.deepEqual(a.customers.map((x) => [x.party_name, x.sales_minor, x.invoices]), [['Ravi', 100_000n, 1n]], '2000 less a 1000 credit note');
  assert.deepEqual(a.items.map((x) => [x.name, x.sales_minor, x.quantity_milli]), [['Widget', 200_000n, 2000n]]);
  assert.deepEqual(a.months.map((m) => [m.month, m.sales_minor]), [['2026-06', 200_000n], ['2026-07', -100_000n]]);
});
