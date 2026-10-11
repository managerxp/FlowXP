/* A field rep with no signal: the visit, the order and the payment are kept on the phone and sent later, in order, once each. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as ACTIONS_SCHEMA, createActions } from '../src/lib/actions.ts';
import { addFLine, dropFLine, ensureVisit, estimateOrder, fieldOrderBody, fieldOrderProblem, fieldReceiptBody, routeShops, sendOrQueue, setFQty, setFUnit, visitBody, visitedHere, type FieldToday, type KV } from '../src/lib/field.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const mem = (): KV & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); } }; };
const open = async () => { const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(ACTIONS_SCHEMA); return { db, catalog: createCatalog(db), actions: createActions(db) }; };
const send = (server: ReturnType<typeof fakeServer>) => async (a: { path: string; method: string; body: Record<string, unknown>; id: string }) => { await server.api.call(a.path, { method: a.method, body: a.body, idempotencyKey: a.id, headers: /^\/wholesale/.test(a.path) ? { 'X-Offline-Sale': '1' } : undefined }); };
const wholesale = { wholesale_price: 40, moq: 6, sale_unit: null, units: [{ unit_name: 'Carton', factor: 12 }] };

test('a visit, an order and a payment taken with no signal are sent later in the order they were made, once each, and the order and payment name the visit', async () => {
  const server = fakeServer([P(1, 'Soap', 50, { tax_rate: 18, wholesale } as never)]);
  const { catalog, actions } = await open(); await catalog.sync(server.api);
  const kv = mem(); const deps = { api: server.api, actions, kv };
  server.state.down = true;
  const v = await ensureVisit(deps, { date: '2026-10-08', customerId: 5, shopName: 'Ravi Stores', outcome: 'ORDER', beatId: 2 });
  assert.equal(v.sent, false);
  const lines = addFLine([], (await catalog.search('soap', 5))[0]);
  const o = await sendOrQueue(deps, { id: 'ord-1', label: 'Order for Ravi Stores', method: 'POST', path: '/wholesale/orders', body: fieldOrderBody(5, lines, v.ref, 240) });
  const r = await sendOrQueue(deps, { id: 'rc-1', label: 'Payment from Ravi Stores', method: 'POST', path: '/wholesale/receipts', body: fieldReceiptBody(5, '500', 'CASH', '', v.ref) });
  assert.deepEqual([o.kind, r.kind], ['queued', 'queued']);
  assert.deepEqual(await actions.counts(), { pending: 3, failed: 0 });
  assert.deepEqual(await actions.flush(send(server)), { sent: 0, failed: 0, stopped: 'offline' }, 'nothing lost while offline');
  server.state.down = false;
  assert.deepEqual(await actions.flush(send(server)), { sent: 3, failed: 0, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => a.path), ['/distributor/visits', '/wholesale/orders', '/wholesale/receipts'], 'the visit first, so the others can name it');
  assert.equal((server.state.applied[1].body as { visit_ref: string }).visit_ref, v.ref); assert.equal((server.state.applied[2].body as { visit_ref: string }).visit_ref, v.ref);
  assert.equal((server.state.applied[1] as never as { headers: Record<string, string> }).headers['X-Offline-Sale'], '1');
});

test('with a signal the visit and the order go straight to the server; the visit is made once and the same one is used for the next thing done there', async () => {
  const server = fakeServer([P(1, 'Soap', 50, { wholesale } as never)]);
  const { actions } = await open(); const kv = mem(); const deps = { api: server.api, actions, kv };
  const a = await ensureVisit(deps, { date: '2026-10-08', customerId: 5, shopName: 'Ravi Stores', outcome: 'ORDER' });
  const b = await ensureVisit(deps, { date: '2026-10-08', customerId: 5, shopName: 'Ravi Stores', outcome: 'COLLECTION' });
  assert.deepEqual([a.sent, a.ref === b.ref], [true, true]);
  assert.equal(server.state.applied.filter((x) => x.path === '/distributor/visits').length, 1);
  const o = await sendOrQueue<{ order_id: number }>(deps, { id: 'o1', label: 'x', method: 'POST', path: '/wholesale/orders', body: { customer_id: 5, visit_ref: a.ref, lines: [] } });
  assert.equal(o.kind, 'sent'); assert.equal((await actions.counts()).pending, 0);
  assert.deepEqual([...(await visitedHere(kv, '2026-10-08', [5, 6]))], [[5, 'ORDER']], 'the route knows this shop was visited from this phone');
});

test('anything already waiting makes the next thing wait behind it, so an order is never sent before its visit', async () => {
  const server = fakeServer([]);
  const { actions } = await open(); const kv = mem(); const deps = { api: server.api, actions, kv };
  server.state.down = true;
  const v = await ensureVisit(deps, { date: '2026-10-08', customerId: 5, shopName: 'Ravi', outcome: 'ORDER' });
  server.state.down = false;   // the signal is back, but the visit has not been sent yet
  const o = await sendOrQueue(deps, { id: 'o1', label: 'x', method: 'POST', path: '/wholesale/orders', body: { customer_id: 5, visit_ref: v.ref, lines: [] } });
  assert.equal(o.kind, 'queued');
  assert.equal(server.state.applied.length, 0, 'the order did not jump the queue');
  assert.deepEqual(await actions.flush(send(server)), { sent: 2, failed: 0, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => a.path), ['/distributor/visits', '/wholesale/orders']);
});

test('the signal drops after the server took the order: the retry returns it, it is not made twice', async () => {
  const server = fakeServer([]);
  const { actions } = await open();
  await actions.add({ id: 'ord-x', label: 'x', method: 'POST', path: '/wholesale/orders', body: { customer_id: 5, lines: [] } });
  server.state.lostReplies = 1;
  assert.equal((await actions.flush(send(server))).stopped, 'offline');
  assert.deepEqual(await actions.counts(), { pending: 1, failed: 0 });
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
  assert.equal(server.state.applied.length, 1);
});

test('an order the server refuses is shown to the rep (not queued); one refused after being queued is parked with the reason', async () => {
  const server = fakeServer([]);
  const { actions } = await open(); const deps = { api: server.api, actions, kv: mem() };
  server.state.refuse.set('bad-1', { status: 400, message: 'Soap: the minimum order is 6 pcs' });
  await assert.rejects(sendOrQueue(deps, { id: 'bad-1', label: 'x', method: 'POST', path: '/wholesale/orders', body: { customer_id: 5 } }), /minimum order/);
  assert.equal((await actions.counts()).pending, 0, 'a refusal is not queued behind the rep\'s back');
  server.state.refuse.set('bad-2', { status: 400, message: 'That visit was not found' });
  await actions.add({ id: 'bad-2', label: 'x', method: 'POST', path: '/wholesale/orders', body: {} });
  await actions.add({ id: 'good', label: 'y', method: 'POST', path: '/wholesale/receipts', body: { amount: 1 } });
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 1, stopped: null });
  assert.match((await actions.list()).find((a) => a.id === 'bad-2')!.error!, /visit was not found/);
});

test('the products and prices come from the phone: the wholesale price, the minimum order, and a carton as its size times the piece price', async () => {
  const server = fakeServer([P(1, 'Soap', 50, { tax_rate: 18, wholesale } as never), P(2, 'Tea', 100, { tax_rate: 5 })]);
  const { catalog } = await open(); await catalog.sync(server.api);
  const soap = (await catalog.search('soap', 5))[0]; const tea = (await catalog.search('tea', 5))[0];
  assert.equal(soap.wholesale?.units[0].unit_name, 'Carton');
  let l = addFLine([], soap);
  assert.equal(l[0].quantity, '6', 'starts at the minimum order');
  assert.deepEqual(estimateOrder(l), { subtotalPaise: 24000, taxPaise: 4320, totalPaise: 28320 }, '6 at the wholesale price of 40, with GST 18%');
  l = setFUnit(setFQty(l, l[0].key, '2'), l[0].key, 'Carton');
  assert.equal(estimateOrder(l).subtotalPaise, 96000, '2 cartons of 12 at 40');
  l = addFLine(l, tea);
  assert.equal(estimateOrder(l).subtotalPaise, 96000 + 10000, 'a product with no wholesale price uses its shelf price');
  assert.equal(dropFLine(l, l[0].key).length, 1);
  const few = addFLine([], soap);
  assert.match(fieldOrderProblem(setFQty(few, few[0].key, '3')), /minimum order is 6/);
  assert.equal(fieldOrderProblem(addFLine([], soap)), '');
  assert.match(fieldOrderProblem([]), /at least one/);
});

test('what is sent: products, the visit, that it came from the field, the total the shop was shown; a payment goes against the oldest bills', () => {
  const server = fakeServer([P(1, 'Soap', 50, { wholesale } as never)]);
  void server;
  const prod = { product_id: 1, name: 'Soap', wholesale, selling_price: 50, tax_rate: 18, unit: 'pcs' } as never;
  const base = addFLine([], prod);
  const l = setFUnit(base, base[0].key, 'Carton');
  assert.deepEqual(fieldOrderBody(5, l, 'v-1', 283.2, { customerPo: ' PO-1 ', notes: '' }), { customer_id: 5, submit: true, source: 'FIELD', visit_ref: 'v-1', expected_total: 283.2, lines: [{ product_id: 1, quantity: 6, unit_name: 'Carton' }], customer_po: 'PO-1' });
  assert.deepEqual(fieldReceiptBody(5, '500', 'UPI', ' U1 ', 'v-1'), { customer_id: 5, amount: 500, method: 'UPI', allocate: 'OLDEST', visit_ref: 'v-1', reference: 'U1' });
  assert.deepEqual(visitBody({ customerId: 5, outcome: 'FOLLOW_UP', ref: 'r1', beatId: 2, notes: ' later ', nextVisit: '2026-10-15', date: '2026-10-08' }), { customer_id: 5, outcome: 'FOLLOW_UP', client_ref: 'r1', beat_id: 2, notes: 'later', next_visit_date: '2026-10-15', visit_date: '2026-10-08' });
});

test('the route is a flat list in visiting order with each shop\'s beat', () => {
  const t = { beats: [{ beat_id: 1, name: 'Monday north', customers: [{ seq: 1, customer_id: 5 }, { seq: 2, customer_id: 6 }] }, { beat_id: 2, name: 'Monday south', customers: [{ seq: 1, customer_id: 7 }] }] } as unknown as FieldToday;
  assert.deepEqual(routeShops(t).map((x) => [x.customer_id, x.beat]), [[5, 'Monday north'], [6, 'Monday north'], [7, 'Monday south']]);
  assert.deepEqual(routeShops(null), []);
});
