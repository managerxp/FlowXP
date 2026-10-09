/* Van sales: what the van holds, what was sold from it on this phone since the last look, and a sale kept for later when there is no signal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as ACTIONS_SCHEMA, createActions } from '../src/lib/actions.ts';
import { addFLine, ensureVisit, estimateOrder, sendOrQueue, setFQty, setFUnit, unitFactor, type KV } from '../src/lib/field.ts';
import { invoiceKind, leftOnVan, lineTotalPaise, overVan, pendingOnVan, stockByProduct, vanSaleBody, vanSaleProblem, type VanStockRow } from '../src/lib/van.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const mem = (): KV => { const data = new Map<string, string>(); return { get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); } }; };
const wholesale = { wholesale_price: 40, moq: 1, sale_unit: null, units: [{ unit_name: 'Carton', factor: 12 }] };
const row = (id: number, product: string, qty: number, batch: string | null = null): VanStockRow => ({ stock_id: id * 10 + qty, product_id: id, product, unit: 'pcs', batch_no: batch, expiry_date: null, qty });

test('the van\'s stock is added up by product across its batches', () => {
  const s = stockByProduct([row(2, 'Tea', 30, 'B1'), row(1, 'Soap', 100), row(2, 'Tea', 20, 'B2')]);
  assert.deepEqual(s.map((p) => [p.name, p.qty, p.batches.length]), [['Soap', 100, 1], ['Tea', 50, 2]]);
});

test('what was sold on this phone and not yet sent is taken off what the van shows, in base units (a carton is its size)', () => {
  const acts = [
    { path: '/distributor/vehicles/7/sell', state: 'pending' as const, body: { lines: [{ product_id: 1, quantity: 2, unit_name: 'Carton' }, { product_id: 2, quantity: 5 }] } },
    { path: '/distributor/vehicles/7/sell', state: 'failed' as const, body: { lines: [{ product_id: 1, quantity: 1 }] } },
    { path: '/distributor/vehicles/7/sell', state: 'sent' as const, body: { lines: [{ product_id: 1, quantity: 99 }] } },
    { path: '/distributor/vehicles/8/sell', state: 'pending' as const, body: { lines: [{ product_id: 1, quantity: 50 }] } },
    { path: '/wholesale/orders', state: 'pending' as const, body: { lines: [{ product_id: 1, quantity: 50 }] } }
  ];
  const p = pendingOnVan(acts, 7, (id, unit) => (unit === 'Carton' ? 12 : 1));
  assert.deepEqual([...p], [[1, 25], [2, 5]], 'a sent sale, another van and an order are not counted; a refused one still is until a person decides');
  const soap = stockByProduct([row(1, 'Soap', 30)])[0];
  assert.equal(leftOnVan(soap, p), 5);
  assert.equal(leftOnVan(soap, new Map([[1, 99]])), 0, 'never below zero');
});

test('asking for more than the van holds is shown before the sale', () => {
  const soap = { product_id: 1, name: 'Soap', unit: 'pcs', wholesale } as never;
  let l = addFLine([], soap); l = setFUnit(setFQty(l, l[0].key, '2'), l[0].key, 'Carton');
  assert.deepEqual(overVan(l, new Map([[1, 20]])), [{ name: 'Soap', short: 4 }]);
  assert.deepEqual(overVan(l, new Map([[1, 24]])), []);
});

test('a sale is paid in full (a cash bill), part paid or left on credit (a credit sale), and the right things are asked for', () => {
  const soap = { product_id: 1, name: 'Soap', unit: 'pcs', selling_price: 50, tax_rate: 18, wholesale } as never;
  const l = addFLine([], soap);
  assert.deepEqual([invoiceKind('FULL'), invoiceKind('PART'), invoiceKind('CREDIT')], ['CASH', 'CREDIT', 'CREDIT']);
  assert.match(vanSaleProblem(null, l, 'FULL', '', 'CASH', ''), /shop/);
  assert.match(vanSaleProblem(5, [], 'FULL', '', 'CASH', ''), /at least one/);
  assert.match(vanSaleProblem(5, l, 'PART', '', 'CASH', ''), /how much/i);
  assert.match(vanSaleProblem(5, l, 'FULL', '', 'UPI', ''), /reference/);
  assert.equal(vanSaleProblem(5, l, 'CREDIT', '', 'UPI', ''), '', 'on credit needs no payment details');
  assert.equal(vanSaleProblem(5, l, 'FULL', '', 'CASH', ''), '');
});

test('what a van sale sends: the shop, the products, payment (the whole bill, a part, or none), the total shown, the visit', () => {
  const soap = { product_id: 1, name: 'Soap', unit: 'pcs', selling_price: 50, tax_rate: 18, wholesale } as never;
  const base = addFLine([], soap); const l = setFUnit(base, base[0].key, 'Carton');
  const full = vanSaleBody({ customerId: 5, lines: l, mode: 'FULL', paid: '', method: 'UPI', reference: ' U1 ', expectedTotal: 566.4, visitRef: 'v-1' });
  assert.deepEqual(full, { customer_id: 5, lines: [{ product_id: 1, quantity: 1, unit_name: 'Carton' }], invoice_kind: 'CASH', expected_total: 566.4, payment: { amount: 'FULL', method: 'UPI', reference_number: 'U1' }, visit_ref: 'v-1' });
  assert.deepEqual(vanSaleBody({ customerId: 5, lines: l, mode: 'PART', paid: '200', method: 'CASH', reference: '', expectedTotal: 566.4 }).payment, { amount: 200, method: 'CASH' });
  assert.equal('payment' in vanSaleBody({ customerId: 5, lines: l, mode: 'CREDIT', paid: '', method: 'CASH', reference: '', expectedTotal: 566.4 }), false);
  assert.equal(lineTotalPaise(l[0]), 48000, 'a carton of 12 at 40');
  assert.equal(unitFactor(soap, 'Carton'), 12);
  assert.equal(estimateOrder(l).totalPaise, 56640);
});

test('a van sale made with no signal is kept, sent later behind its visit, once, to the right van, and the server\'s review note comes back', async () => {
  const server = fakeServer([P(1, 'Soap', 50, { wholesale } as never)]);
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(ACTIONS_SCHEMA);
  const catalog = createCatalog(db); const actions = createActions(db); await catalog.sync(server.api);
  const deps = { api: server.api, actions, kv: mem() };
  server.state.down = true;
  const v = await ensureVisit(deps, { date: '2026-10-08', customerId: 5, shopName: 'Ravi Stores', outcome: 'ORDER' });
  const lines = addFLine([], (await catalog.search('soap', 5))[0]);
  const body = vanSaleBody({ customerId: 5, lines, mode: 'FULL', paid: '', method: 'CASH', reference: '', expectedTotal: 47.2, visitRef: v.ref });
  const r = await sendOrQueue(deps, { id: 'van-1', label: 'Van sale', method: 'POST', path: '/distributor/vehicles/7/sell', body });
  assert.equal(r.kind, 'queued');
  const send = async (a: { path: string; method: string; body: Record<string, unknown>; id: string }) => { await server.api.call(a.path, { method: a.method, body: a.body, idempotencyKey: a.id, headers: { 'X-Offline-Sale': '1' } }); };
  assert.equal((await actions.flush(send)).stopped, 'offline');
  server.state.down = false;
  assert.deepEqual(await actions.flush(send), { sent: 2, failed: 0, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => a.path), ['/distributor/visits', '/distributor/vehicles/7/sell']);
  assert.deepEqual(await actions.flush(send), { sent: 0, failed: 0, stopped: null });
  assert.equal(server.state.applied.length, 2, 'sent once');
});
