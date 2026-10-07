/* More that works with no internet: customers on the phone, price and stock changes queued and sent later exactly once. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as ACTIONS_SCHEMA, createActions, MAX_ACTIONS } from '../src/lib/actions.ts';
import { createApi } from '../src/lib/api.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const open = async () => { const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(ACTIONS_SCHEMA); return { db, catalog: createCatalog(db), actions: createActions(db) }; };
const send = (server: ReturnType<typeof fakeServer>) => async (a: { path: string; method: string; body: Record<string, unknown>; id: string }) => { await server.api.call(a.path, { method: a.method, body: a.body, idempotencyKey: a.id }); };

/* ── customers on the phone ─────────────────────────────────────────────── */

test('customers come with the first download, are found by name or phone with no signal, and follow changes', async () => {
  const server = fakeServer([P(1, 'Tea', 50)]);
  server.upsertCustomer({ customer_id: 1, name: 'Aanya Kapoor', phone: '9816202111' }); server.upsertCustomer({ customer_id: 2, name: 'Ravi Kumar', phone: '9000000002' });
  server.state.log = [];
  const { catalog } = await open();
  await catalog.sync(server.api);
  assert.equal(await catalog.customerCount(), 2);
  server.state.down = true;
  assert.deepEqual((await catalog.customers('aan')).map((c) => c.name), ['Aanya Kapoor']);
  assert.deepEqual((await catalog.customers('9000')).map((c) => c.name), ['Ravi Kumar'], 'by phone');
  assert.deepEqual((await catalog.customers('kapoor aanya')).map((c) => c.name), ['Aanya Kapoor'], 'every word, any order');
  assert.equal((await catalog.customers('')).length, 2); assert.deepEqual(await catalog.customers('100%'), []);
  server.state.down = false;
  server.upsertCustomer({ customer_id: 3, name: 'New Person', phone: null }); server.upsertCustomer({ customer_id: 2, name: 'Ravi K', phone: '9000000002' }); server.removeCustomer(1);
  assert.deepEqual(await catalog.sync(server.api), { mode: 'changes', applied: 3 });
  assert.deepEqual((await catalog.customers('')).map((c) => c.name), ['New Person', 'Ravi K']);
});

test('a customer list that cannot be read does not stop the products', async () => {
  const server = fakeServer([P(1, 'Tea', 50)]);
  const real = server.fetchImpl;
  const api = createApi({ baseUrl: 'http://x', getSession: () => server.session, fetchImpl: (async (u: string, i: RequestInit) => (String(u).endsWith('/customers') ? new Response('{"success":false,"message":"no"}', { status: 403 }) : real(u, i))) as typeof fetch });
  const { catalog } = await open();
  assert.deepEqual(await catalog.sync(api), { mode: 'full', products: 1 }); assert.equal(await catalog.customerCount(), 0);
});

/* ── changes made offline ───────────────────────────────────────────────── */

test('a price and a stock change made offline show on the phone at once and reach the server once, in order', async () => {
  const server = fakeServer([P(1, 'Tea', 50, { track_inventory: true, current_stock: 10 })]);
  const { catalog, actions } = await open(); await catalog.sync(server.api);
  server.state.down = true;
  await catalog.setLocal(1, { selling_price: 55 }); await catalog.setLocal(1, { stockDelta: -3 });
  await actions.add({ id: 'a1', label: 'Price of Tea to 55', method: 'PATCH', path: '/products/1', body: { selling_price: 55 } });
  await actions.add({ id: 'a2', label: 'Stock of Tea: -3', method: 'POST', path: '/inventory/adjust', body: { product_id: 1, quantity: -3, reason: 'counted' } });
  assert.deepEqual([(await catalog.byId(1))!.selling_price, (await catalog.byId(1))!.current_stock], [55, 7], 'the till already uses them');
  assert.deepEqual(await actions.counts(), { pending: 2, failed: 0 });
  assert.deepEqual(await actions.flush(send(server)), { sent: 0, failed: 0, stopped: 'offline' }, 'nothing lost while offline');
  server.state.down = false;
  assert.deepEqual(await actions.flush(send(server)), { sent: 2, failed: 0, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => [a.key, a.path]), [['a1', '/products/1'], ['a2', '/inventory/adjust']], 'in order, once each');
  assert.deepEqual(await actions.flush(send(server)), { sent: 0, failed: 0, stopped: null });
});

test('the signal drops after the server applied a stock change: the retry does not apply it twice', async () => {
  const server = fakeServer([P(1, 'Tea', 50)]); const { actions } = await open();
  await actions.add({ id: 'once', label: 'Stock', method: 'POST', path: '/inventory/adjust', body: { product_id: 1, quantity: 5, reason: 'x' } });
  server.state.lostReplies = 1;
  assert.equal((await actions.flush(send(server))).stopped, 'offline');
  assert.deepEqual(await actions.counts(), { pending: 1, failed: 0 });
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
  assert.equal(server.state.applied.length, 1, 'the server saw the same key twice and changed the stock once');
});

test('a change the server refuses is parked with its reason and does not block the next one; a person can retry or discard it', async () => {
  const server = fakeServer([P(1, 'Tea', 50)]); const { actions } = await open();
  server.state.refuse.set('bad', { status: 403, message: 'You are not allowed to change stock' });
  await actions.add({ id: 'bad', label: 'Stock', method: 'POST', path: '/inventory/adjust', body: { product_id: 1, quantity: 1, reason: 'x' } });
  await actions.add({ id: 'good', label: 'Price', method: 'PATCH', path: '/products/1', body: { selling_price: 60 } });
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 1, stopped: null });
  const parked = (await actions.list()).find((a) => a.id === 'bad')!; assert.equal(parked.state, 'failed'); assert.match(parked.error!, /not allowed/);
  await actions.discard('good'); assert.equal((await actions.list()).some((a) => a.id === 'good'), true, 'a change already sent cannot be discarded');
  server.state.refuse.clear(); await actions.retry('bad');
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
  await actions.add({ id: 'bad2', label: 'x', method: 'POST', path: '/inventory/adjust', body: {} }); server.state.refuse.set('bad2', { status: 400, message: 'no' });
  await actions.flush(send(server)); await actions.discard('bad2'); assert.equal((await actions.list()).some((a) => a.id === 'bad2'), false);
});

test('server trouble and a signed-out session stop the queue without losing anything; the same id twice is one change; the queue has a ceiling', async () => {
  const server = fakeServer([P(1, 'Tea', 50)]); const { actions } = await open();
  await actions.add({ id: 'k', label: 'x', method: 'PATCH', path: '/products/1', body: { selling_price: 1 } }); await actions.add({ id: 'k', label: 'x', method: 'PATCH', path: '/products/1', body: { selling_price: 1 } });
  assert.equal((await actions.list()).length, 1);
  for (const [status, why] of [[503, 'server'], [401, 'auth'], [429, 'server']] as const) { server.state.status = status; assert.equal((await actions.flush(send(server))).stopped, why); }
  server.state.status = 0; assert.equal((await actions.counts()).pending, 1);
  for (let i = 0; i < MAX_ACTIONS; i++) await actions.add({ id: `q${i}`, label: 'x', method: 'PATCH', path: '/products/1', body: {} });
  assert.equal(await actions.add({ id: 'one-too-many', label: 'x', method: 'PATCH', path: '/products/1', body: {} }), null);
});
