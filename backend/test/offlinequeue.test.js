/*
 * Offline sales: the queue that keeps a sale when the connection is down and replays it, once, afterwards.
 * (The queue is plain logic with injected storage and sender, so it runs here without a browser.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, MAX_QUEUED } from '../../frontend/src/lib/offlineQueue.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const sale = (n, extra = {}) => ({ label: `Rs ${n} · 1 item`, path: '/invoices', body: { items: [{ product_id: n, quantity: 1 }] }, idempotencyKey: `key-${n}`, scope: { businessId: 7, branchId: 3 }, ...extra });

test('a sale is kept, in order, and survives a reload', () => {
  const storage = memory();
  const q = createQueue({ storage, send: async () => ({ status: 201 }) });
  q.add(sale(1)); q.add(sale(2));
  assert.deepEqual(q.list().map((i) => i.idempotencyKey), ['key-1', 'key-2']);
  assert.equal(q.list()[0].state, 'pending');

  const reloaded = createQueue({ storage, send: async () => ({ status: 201 }) });   // a new page, the same device
  assert.equal(reloaded.size(), 2);
});

test('the same sale added twice is still one sale', () => {
  const q = createQueue({ storage: memory(), send: async () => ({ status: 201 }) });
  q.add(sale(1)); q.add(sale(1));
  assert.equal(q.list().length, 1);
});

test('sending replays each sale with its own key and outlet, oldest first, and empties the queue', async () => {
  const seen = [];
  const q = createQueue({ storage: memory(), send: async (item) => { seen.push({ key: item.idempotencyKey, path: item.path, scope: item.scope, body: item.body }); return { status: 201 }; } });
  q.add(sale(1)); q.add(sale(2, { scope: { businessId: 7, branchId: 9 } }));
  assert.deepEqual(await q.flush(), { sent: 2, failed: 0, stopped: null });
  assert.deepEqual(seen.map((s) => s.key), ['key-1', 'key-2']);
  assert.equal(seen[1].scope.branchId, 9);                       // the outlet it was rung up at, not the one on screen later
  assert.equal(seen[0].path, '/invoices');
  assert.equal(q.list().length, 0);
});

test('no connection stops the run and keeps everything for later', async () => {
  let up = false;
  const q = createQueue({ storage: memory(), send: async () => { if (!up) throw new TypeError('fetch failed'); return { status: 201 }; } });
  q.add(sale(1)); q.add(sale(2));
  assert.deepEqual(await q.flush(), { sent: 0, failed: 0, stopped: 'offline' });
  assert.equal(q.size(), 2);
  up = true;
  assert.deepEqual(await q.flush(), { sent: 2, failed: 0, stopped: null });
});

test('a server error or being signed out pauses; the order is kept', async () => {
  const answers = [201, 503];
  const q = createQueue({ storage: memory(), send: async () => ({ status: answers.shift() ?? 201 }) });
  q.add(sale(1)); q.add(sale(2)); q.add(sale(3));
  assert.deepEqual(await q.flush(), { sent: 1, failed: 0, stopped: 'server' });
  assert.deepEqual(q.list().map((i) => i.idempotencyKey), ['key-2', 'key-3']);

  const signedOut = createQueue({ storage: memory(), send: async () => ({ status: 401 }) });
  signedOut.add(sale(1));
  assert.equal((await signedOut.flush()).stopped, 'auth');
  assert.equal(signedOut.size(), 1);                              // still there for after sign-in
});

test('a sale the server refuses is parked with the reason and the rest carry on', async () => {
  const q = createQueue({ storage: memory(), send: async (item) => (item.idempotencyKey === 'key-2' ? { status: 409, message: 'Not enough stock for Thali (0 left here)' } : { status: 201 }) });
  q.add(sale(1)); q.add(sale(2)); q.add(sale(3));
  assert.deepEqual(await q.flush(), { sent: 2, failed: 1, stopped: null });
  const [left] = q.list();
  assert.equal(left.idempotencyKey, 'key-2');
  assert.equal(left.state, 'failed');
  assert.match(left.error, /Not enough stock/);
  assert.equal(q.size(), 0);                                      // nothing is still waiting to be tried

  assert.deepEqual(await q.flush(), { sent: 0, failed: 0, stopped: null });   // a parked sale is not resent on its own
  q.retry('key-2');
  assert.equal(q.size(), 1);
  assert.equal(q.list()[0].error, null);
});

test('a discarded sale is gone', () => {
  const q = createQueue({ storage: memory(), send: async () => ({ status: 201 }) });
  q.add(sale(1)); q.add(sale(2));
  q.remove('key-1');
  assert.deepEqual(q.list().map((i) => i.id), ['key-2']);
});

test('two flushes at once send each sale once', async () => {
  let calls = 0;
  const q = createQueue({ storage: memory(), send: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { status: 201 }; } });
  q.add(sale(1)); q.add(sale(2));
  const [a, b] = await Promise.all([q.flush(), q.flush()]);
  assert.equal(calls, 2);
  assert.deepEqual(a, b);
});

test('the queue has a ceiling, and a full or blocked store does not break it', () => {
  const q = createQueue({ storage: memory(), send: async () => ({ status: 201 }) });
  for (let n = 0; n < MAX_QUEUED; n += 1) assert.ok(q.add(sale(n)));
  assert.equal(q.add(sale(MAX_QUEUED + 1)), null);

  const changes = [];
  const full = createQueue({ storage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }, send: async () => ({ status: 201 }), onChange: (i) => changes.push(i.length) });
  assert.doesNotThrow(() => full.add(sale(1)));
  assert.deepEqual(changes, [1]);                                 // the page still hears about it
});

test('a corrupted store starts empty instead of crashing the till', () => {
  const q = createQueue({ storage: { getItem: () => '{not json', setItem: () => {} }, send: async () => ({ status: 201 }) });
  assert.deepEqual(q.list(), []);
  assert.equal(q.size(), 0);
});
