import test from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { issueDocument, saveDraft, voidDocument } from '../src/documents.ts';
import type { DocKind } from '../src/documents.ts';
import { createItem, createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { addWarehouse, adjust, listWarehouses, setTracking, stockByWarehouse, stockLedger, stockSummary, transferStock, updateWarehouse } from '../src/stock.ts';
import { newOrg, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
test.after(cleanup);
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const shop = async () => {
  const org = await newOrg(pool);
  const r = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    const item = await createItem(c, org, { sku: 'PEN', name: 'Pen', purchasePrice: '10', salePrice: '20', taxCode: 'GST18' }, 't');
    await setTracking(c, org, item, { trackStock: true, reorderLevel: '5' }, 't');
    const service = await createItem(c, org, { sku: 'SVC', name: 'Setup', kind: 'SERVICE', taxCode: 'GST0' }, 't');
    return { item, service, cust: await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '27' }, 't'), vend: await createParty(c, org, { kind: 'VENDOR', name: 'Mehta', stateCode: '27' }, 't') };
  });
  return { org, ...r };
};
let n = 0;
const doc = (org: bigint, kind: DocKind, partyId: bigint, itemId: bigint, quantity: string, unitPrice: string) => run(org, async (c) => {
  const id = await saveDraft(c, org, null, { kind, partyId, date: '2026-06-01', supplierRef: kind === 'BILL' ? `S-${++n}` : undefined, lines: [{ itemId, quantity, unitPrice, taxCode: 'GST18' }] }, 't');
  await issueDocument(c, org, kind, id, 't'); return id;
});
const summary = async (org: bigint) => (await run(org, (c) => stockSummary(c)))[0]!;

test('bills count stock in at cost, invoices take it out at average cost with a cost-of-goods entry, and voiding puts it back', { skip }, async () => {
  const { org, item, cust, vend } = await shop();
  await assert.rejects(doc(org, 'INVOICE', cust, item, '1', '20'), /only 0.000 of Pen in stock/);
  await doc(org, 'BILL', vend, item, '10', '10');      // 10 at 10 = 100
  await doc(org, 'BILL', vend, item, '10', '14');      // 10 at 14 = 140, so 20 for 240: average 12
  let s = await summary(org);
  assert.equal(s.quantity, '20.000'); assert.equal(s.value_minor, 24_000n); assert.equal(s.low, false);
  const inv = await doc(org, 'INVOICE', cust, item, '5', '20');   // cost 5 x 12 = 60
  s = await summary(org);
  assert.equal(s.quantity, '15.000'); assert.equal(s.value_minor, 18_000n);
  // the books agree with the count: Inventory is 180.00, cost of goods sold 60.00, nothing expensed on purchase
  const rows = (await run(org, (c) => c.query(`SELECT a.system_key, COALESCE(SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::bigint AS bal FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.system_key IN ('INVENTORY', 'COGS', 'PURCHASES') GROUP BY a.system_key`))).rows;
  const by = Object.fromEntries(rows.map((r) => [r.system_key, r.bal]));
  assert.equal(by.INVENTORY, 18_000n); assert.equal(by.COGS, 6_000n); assert.equal(by.PURCHASES, undefined);
  await assert.rejects(doc(org, 'INVOICE', cust, item, '16', '20'), /only 15.000 of Pen/);
  await run(org, (c) => voidDocument(c, org, 'INVOICE', inv, { date: '2026-06-02', reason: 'wrong' }, 't'));
  s = await summary(org);
  assert.equal(s.quantity, '20.000'); assert.equal(s.value_minor, 24_000n);
  assert.deepEqual((await run(org, (c) => stockLedger(c, item, 10))).map((m) => m.source_type), ['VOID', 'INVOICE', 'BILL', 'BILL']);
});

test('a purchase that was partly sold cannot be voided; returns go in at cost and out at the price paid', { skip }, async () => {
  const { org, item, cust, vend } = await shop();
  const bill = await doc(org, 'BILL', vend, item, '10', '10');
  await doc(org, 'INVOICE', cust, item, '8', '20');
  await assert.rejects(run(org, (c) => voidDocument(c, org, 'BILL', bill, { date: '2026-06-02', reason: 'oops' }, 't')), /has been sold, moved or used/);
  await doc(org, 'CREDIT_NOTE', cust, item, '3', '20');   // 3 back at the average cost of 10
  let s = await summary(org);
  assert.equal(s.quantity, '5.000'); assert.equal(s.value_minor, 5_000n);
  await doc(org, 'DEBIT_NOTE', vend, item, '2', '10');    // 2 sent back, valued at the 10 paid
  s = await summary(org);
  assert.equal(s.quantity, '3.000'); assert.equal(s.value_minor, 3_000n);
  assert.equal(s.low, true);
});

test('opening stock and write-offs are adjustments against an account you choose; services are not counted', { skip }, async () => {
  const { org, item, service, cust } = await shop();
  await assert.rejects(run(org, (c) => adjust(c, org, { itemId: item, date: '2026-06-01', direction: 'IN', quantity: '10', counterAccount: 'OPENING_BALANCE', reason: 'start' }, 't')), /what each unit cost/);
  await run(org, (c) => adjust(c, org, { itemId: item, date: '2026-06-01', direction: 'IN', quantity: '10', unitCost: '9.50', counterAccount: 'OPENING_BALANCE', reason: 'opening stock' }, 't'));
  let s = await summary(org);
  assert.equal(s.value_minor, 9_500n);
  await run(org, (c) => adjust(c, org, { itemId: item, date: '2026-06-05', direction: 'OUT', quantity: '4', counterAccount: 'COGS', reason: 'damaged' }, 't'));
  s = await summary(org);
  assert.equal(s.quantity, '6.000'); assert.equal(s.value_minor, 5_700n);
  await assert.rejects(run(org, (c) => adjust(c, org, { itemId: item, date: '2026-06-05', direction: 'OUT', quantity: '7', counterAccount: 'COGS', reason: 'x' }, 't')), /only 6.000/);
  await assert.rejects(run(org, (c) => setTracking(c, org, service, { trackStock: true }, 't')), /only goods/);
  await assert.rejects(run(org, (c) => setTracking(c, org, item, { trackStock: false }, 't')), /already has stock history/);
  await doc(org, 'INVOICE', cust, service, '1', '500');   // an untracked service sells freely and moves nothing
  assert.equal((await run(org, (c) => stockSummary(c))).length, 1);
  assert.equal((await run(org, (c) => stockLedger(c, service, 10))).length, 0);
});

const dated = (org: bigint, kind: DocKind, partyId: bigint, itemId: bigint, date: string, quantity: string, unitPrice: string) => run(org, async (c) => {
  const id = await saveDraft(c, org, null, { kind, partyId, date, supplierRef: kind === 'BILL' ? `S-${++n}` : undefined, lines: [{ itemId, quantity, unitPrice, taxCode: 'GST18' }] }, 't');
  await issueDocument(c, org, kind, id, 't'); return id;
});
const inventory = async (org: bigint) => (await pool.query(
  `SELECT COALESCE(SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::bigint AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.organization_id = $1 AND a.system_key = 'INVENTORY'`, [org])).rows[0].b as bigint;

test('a purchase entered for an earlier date changes the cost of the sales after it, and the books keep matching the stock', { skip }, async () => {
  const { org, item, cust, vend } = await shop();
  await dated(org, 'BILL', vend, item, '2026-06-01', '10', '10');            // 10 at 10 = 100
  const inv = await dated(org, 'INVOICE', cust, item, '2026-06-10', '5', '30');   // costed at 10: 50
  assert.equal((await summary(org)).value_minor, 5_000n);
  await dated(org, 'BILL', vend, item, '2026-06-05', '10', '20');            // 10 at 20 = 200, bought before the sale: average on the 10th is 15
  const s = await summary(org);
  assert.equal(s.value_minor, 30_000n - 7_500n, 'the sale now cost 5 x 15 = 75');
  assert.equal(await inventory(org), s.value_minor, 'Inventory in the books equals the value of the stock');
  const cogs = (await pool.query(`SELECT COALESCE(SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::bigint AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.organization_id = $1 AND a.system_key = 'COGS'`, [org])).rows[0].b as bigint;
  assert.equal(cogs, 7_500n);
  // voiding the sale puts back what it now cost, not what it first cost
  await run(org, (c) => voidDocument(c, org, 'INVOICE', inv, { date: '2026-06-12', reason: 'wrong' }, 't'));
  assert.equal((await summary(org)).value_minor, 30_000n); assert.equal(await inventory(org), 30_000n);
});

test('stock cannot be taken out for a day it was not there, even if there is plenty today', { skip }, async () => {
  const { org, item, cust, vend } = await shop();
  await dated(org, 'BILL', vend, item, '2026-06-10', '10', '10');
  await assert.rejects(dated(org, 'INVOICE', cust, item, '2026-06-05', '2', '30'), /only 0.000 of Pen in stock on 2026-06-05/);
  await dated(org, 'INVOICE', cust, item, '2026-06-12', '8', '30');
  // a bill dated after the sale would have left the stock short on the 12th
  await assert.rejects(dated(org, 'INVOICE', cust, item, '2026-06-11', '5', '30'), /would have been in stock|only 10.000 of Pen in stock on 2026-06-11/);
  assert.equal(await inventory(org), (await summary(org)).value_minor);
});

test('warehouses split the quantity, transfers move it at the average without touching the books, and each warehouse cannot go below zero', { skip }, async () => {
  const { org, item, cust, vend } = await shop();
  const [main] = await run(org, (c) => listWarehouses(c, org));
  const shed = await run(org, (c) => addWarehouse(c, org, 'Shed', 't'));
  await assert.rejects(run(org, (c) => addWarehouse(c, org, 'shed', 't')), /already a warehouse/);
  await dated(org, 'BILL', vend, item, '2026-06-01', '10', '10');
  const before = await inventory(org);
  await run(org, (c) => transferStock(c, org, { itemId: item, from: main!.id as bigint, to: shed, quantity: '4', date: '2026-06-02' }, 't'));
  assert.equal(await inventory(org), before, 'a transfer posts no journal');
  const by = await run(org, (c) => stockByWarehouse(c));
  assert.deepEqual(by.map((r) => [r.warehouse, r.quantity]), [['Main', '6.000'], ['Shed', '4.000']]);
  assert.equal((await run(org, (c) => stockSummary(c, shed)))[0]!.quantity, '4.000');
  assert.equal((await summary(org)).quantity, '10.000');
  await assert.rejects(run(org, (c) => transferStock(c, org, { itemId: item, from: shed, to: main!.id as bigint, quantity: '5', date: '2026-06-03' }, 't')), /only 4.000 of Pen in Shed/);
  // a sale drawn from the shed
  const id = await run(org, async (c) => { const d = await saveDraft(c, org, null, { kind: 'INVOICE', partyId: cust, date: '2026-06-04', warehouseId: shed, lines: [{ itemId: item, quantity: '5', unitPrice: '30', taxCode: 'GST18' }] }, 't'); await issueDocument(c, org, 'INVOICE', d, 't'); return d; }).catch((e) => e);
  assert.match(String(id), /only 4.000 of Pen in Shed/);
  await assert.rejects(run(org, (c) => updateWarehouse(c, org, shed, { active: false }, 't')), /still holds/);
  assert.equal(await inventory(org), (await summary(org)).value_minor);
});
