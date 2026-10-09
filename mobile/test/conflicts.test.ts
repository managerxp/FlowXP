/* Two devices change the same price: send when nobody else did, do nothing when it already matches, ask when another device changed it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, createActions, ConflictError } from '../src/lib/actions.ts';
import { conflictText, guard, priceVerdict, split, withCheck } from '../src/lib/conflicts.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const money = (n: number) => `₹${n}`;
const open = async () => { const db = nodeDb(); await db.exec(SCHEMA); return createActions(db); };
/** What sync does for one queued change. */
const send = (server: ReturnType<typeof fakeServer>) => async (a: Parameters<Parameters<ReturnType<typeof createActions>['flush']>[0]>[0]) => {
  if ((await guard(server.api, a)) === 'skip') return;
  await server.api.call(a.path, { method: a.method, body: split(a.body).clean, idempotencyKey: a.id });
};
const queue = (actions: ReturnType<typeof createActions>, id: string, product: number, seen: number, mine: number) =>
  actions.add({ id, label: `Price of Latte to ${mine}`, method: 'PATCH', path: `/products/${product}`, body: withCheck({ selling_price: mine }, { kind: 'price', product_id: product, seen, mine }) });

test('the three answers: send, already the same, conflict', () => {
  assert.equal(priceVerdict({ seen: 35, mine: 40 }, 35), 'send');
  assert.equal(priceVerdict({ seen: 35, mine: 40 }, 40), 'already');
  assert.equal(priceVerdict({ seen: 35, mine: 40 }, 38), 'conflict');
  assert.equal(priceVerdict({ seen: 35.1, mine: 40 }, 35.10), 'send', 'compared in paise, not floating point');
});

test('nobody else changed it: the change is sent as normal, without our private notes', async () => {
  const server = fakeServer([P(1, 'Latte', 35)]); const actions = await open();
  await queue(actions, 'k1', 1, 35, 40);
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => a.body), [{ selling_price: 40 }]);
});

test('already changed to the same price elsewhere: nothing is sent, and it is done', async () => {
  const server = fakeServer([P(1, 'Latte', 40)]); const actions = await open();
  await queue(actions, 'k1', 1, 35, 40);
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
  assert.equal(server.state.applied.length, 0);
});

test('another device changed it: the change waits, nothing is overwritten, and it counts as needing a decision', async () => {
  const server = fakeServer([P(1, 'Latte', 38)]); const actions = await open();
  await queue(actions, 'k1', 1, 35, 40);
  assert.deepEqual(await actions.flush(send(server)), { sent: 0, failed: 1, stopped: null });
  assert.equal(server.state.applied.length, 0, 'the server was not touched');
  assert.deepEqual(await actions.counts(), { pending: 0, failed: 1 });
  const [a] = await actions.list();
  assert.equal(a.state, 'conflict'); assert.equal(split(a.body).server, 38);
  assert.deepEqual(await actions.flush(send(server)), { sent: 0, failed: 0, stopped: null }, 'it is not tried again until someone decides');
});

test('keep mine: it is sent as it is, even though the server has another price now', async () => {
  const server = fakeServer([P(1, 'Latte', 38)]); const actions = await open();
  await queue(actions, 'k1', 1, 35, 40); await actions.flush(send(server));
  await actions.resolve('k1', 'mine');
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => a.body), [{ selling_price: 40 }]);
  assert.equal(server.state.applied[0].key, 'k1', 'the same key as before');
});

test('keep the server\'s: this phone\'s change is dropped and nothing is sent', async () => {
  const server = fakeServer([P(1, 'Latte', 38)]); const actions = await open();
  await queue(actions, 'k1', 1, 35, 40); await actions.flush(send(server));
  await actions.resolve('k1', 'server');
  assert.deepEqual(await actions.list(), []);
  assert.equal(server.state.applied.length, 0);
});

test('a conflict on one change does not hold up the others', async () => {
  const server = fakeServer([P(1, 'Latte', 38), P(2, 'Tea', 20)]); const actions = await open();
  await queue(actions, 'k1', 1, 35, 40); await queue(actions, 'k2', 2, 20, 22);
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 1, stopped: null });
  assert.deepEqual(server.state.applied.map((a) => a.body), [{ selling_price: 22 }]);
});

test('stock changes carry no check, so they never conflict', async () => {
  const server = fakeServer([P(1, 'Latte', 38)]); const actions = await open();
  await actions.add({ id: 's1', label: 'Stock of Latte: +5', method: 'POST', path: '/inventory/adjust', body: { product_id: 1, quantity: 5, reason: 'Counted' } });
  assert.deepEqual(await actions.flush(send(server)), { sent: 1, failed: 0, stopped: null });
});

test('the question is asked in plain words', () => {
  const t = conflictText('Price of Latte to 40', 40, 38, money);
  assert.equal(t.title, 'Something changed on another device');
  assert.equal(t.keepMine, 'Keep my change (₹40)'); assert.equal(t.keepServer, "Keep FlowXP's (₹38)");
  assert.ok(new ConflictError(38) instanceof Error);
});
