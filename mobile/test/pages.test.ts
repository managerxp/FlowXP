/* The pages: cached loading with no signal, date ranges, the chart, categories on the phone, and a customer on a sale. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedLoad, cachedRead } from '../src/lib/cache.ts';
import { ApiError, NetworkError } from '../src/lib/api.ts';
import { ago, barHeights, ranges } from '../src/lib/ranges.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { addProduct, emptyCart, saleBody } from '../src/lib/cart.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { sendEntry, takeSale } from '../src/lib/till.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const memory = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); }, m }; };

/* ── cached loading ─────────────────────────────────────────────────────── */

test('an answer is kept; with no signal the kept answer shows, marked with when it was from', async () => {
  const store = memory(); let clock = 1000;
  const first = await cachedLoad('dash', async () => ({ sales: 120 }), store, () => clock);
  assert.deepEqual(first, { data: { sales: 120 }, at: 1000, fromCache: false });
  clock = 5000;
  const offline = await cachedLoad('dash', async () => { throw new NetworkError(); }, store, () => clock);
  assert.deepEqual(offline, { data: { sales: 120 }, at: 1000, fromCache: true }, 'the time shown is when it was saved, not now');
  assert.deepEqual(await cachedRead('dash', store), { data: { sales: 120 }, at: 1000, fromCache: true });
  assert.equal(await cachedRead('never', store), null);
});

test('with no signal and nothing kept it says so; a refusal is never hidden behind old data', async () => {
  const store = memory();
  await assert.rejects(cachedLoad('x', async () => { throw new NetworkError(); }, store), (e) => e instanceof NetworkError);
  await cachedLoad('x', async () => ({ ok: 1 }), store);
  await assert.rejects(cachedLoad('x', async () => { throw new ApiError('You may not see reports', 403); }, store), (e) => e instanceof ApiError && e.status === 403, 'not allowed stays not allowed');
  await assert.rejects(cachedLoad('x', async () => { throw new ApiError('boom', 500); }, store), (e) => e instanceof ApiError && e.status === 500);
  store.m.set('cache:bad', '{not json');
  await assert.rejects(cachedLoad('bad', async () => { throw new NetworkError(); }, store), (e) => e instanceof NetworkError, 'a damaged saved copy is no use');
});

test('different businesses, outlets or searches keep different answers', async () => {
  const store = memory();
  await cachedLoad('bills:1:9:today:', async () => ['a'], store); await cachedLoad('bills:2:9:today:', async () => ['b'], store);
  assert.deepEqual((await cachedRead<string[]>('bills:1:9:today:', store))!.data, ['a']); assert.deepEqual((await cachedRead<string[]>('bills:2:9:today:', store))!.data, ['b']);
});

/* ── ranges, chart, time ────────────────────────────────────────────────── */

test('the date ranges are in the phone\'s calendar and include both ends', () => {
  const r = Object.fromEntries(ranges(new Date(2026, 9, 7, 15, 0)).map((x) => [x.id, x]));   // 7 Oct 2026
  assert.deepEqual([r.today.from, r.today.to], ['2026-10-07', '2026-10-07']);
  assert.deepEqual([r.yesterday.from, r.yesterday.to], ['2026-10-06', '2026-10-06']);
  assert.deepEqual([r['7d'].from, r['7d'].to], ['2026-10-01', '2026-10-07']);
  assert.deepEqual([r['30d'].from, r['30d'].to], ['2026-09-08', '2026-10-07']);
  assert.deepEqual([r.month.from, r.month.to], ['2026-10-01', '2026-10-07']);
  const jan = Object.fromEntries(ranges(new Date(2026, 0, 3)).map((x) => [x.id, x]));
  assert.equal(jan.yesterday.from, '2026-01-02'); assert.equal(jan['7d'].from, '2025-12-28', 'across the new year');
});

test('chart bars: the best day is full height, a zero day is still a hairline, and an empty chart does not divide by zero', () => {
  assert.deepEqual(barHeights([50, 100, 0]), [0.5, 1, 0.02]);
  assert.deepEqual(barHeights([0, 0]), [0.02, 0.02]); assert.deepEqual(barHeights([]), []);
  assert.equal(barHeights([1, 1000])[0], 0.02, 'a tiny day is not drawn smaller than a hairline');
});

test('"ago" reads like a person', () => {
  const now = 10 * 3600 * 1000;
  assert.equal(ago(now - 20000, now), 'just now'); assert.equal(ago(now - 5 * 60000, now), '5 min ago'); assert.equal(ago(now - 3 * 3600000, now), '3 h ago');
  assert.match(ago(now - 3 * 86400000, now), /\d/);
});

/* ── categories and the product list on the phone ───────────────────────── */

const open = async () => { const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); return { catalog: createCatalog(db), outbox: createOutbox(db) }; };

test('categories are counted on the phone, biggest first; a category narrows the search; paging walks the whole list', async () => {
  const items = [P(1, 'Latte', 160, { category_name: 'Coffee' }), P(2, 'Mocha', 180, { category_name: 'Coffee' }), P(3, 'Muffin', 110, { category_name: 'Bakes' }), P(4, 'Straw', 1, { category_name: null }), P(5, 'Espresso', 90, { category_name: 'Coffee' })];
  const server = fakeServer(items); const { catalog } = await open();
  await catalog.sync(server.api);
  assert.deepEqual(await catalog.categories(), [{ name: 'Coffee', count: 3 }, { name: '', count: 1 }, { name: 'Bakes', count: 1 }].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
  assert.deepEqual((await catalog.search('', 40, 'Coffee')).map((p) => p.name), ['Espresso', 'Latte', 'Mocha']);
  assert.deepEqual((await catalog.search('mo', 40, 'Coffee')).map((p) => p.name), ['Mocha']);
  assert.deepEqual((await catalog.search('', 40, '')).map((p) => p.name), ['Straw'], 'the products with no category');
  assert.deepEqual((await catalog.search('', 40, 'Nothing')), []);
  const all: string[] = []; for (let off = 0; ; off += 2) { const page = await catalog.search('', 2, undefined, off); if (!page.length) break; all.push(...page.map((p) => p.name)); }
  assert.deepEqual(all, ['Espresso', 'Latte', 'Mocha', 'Muffin', 'Straw'], 'every product once, in order');
});

/* ── a customer on the bill ─────────────────────────────────────────────── */

test('a customer on the bill is sent with the sale, including when it waits offline; no customer sends none', async () => {
  const cart = addProduct(emptyCart(), P(1, 'Tea', 50));
  assert.equal(saleBody(cart, { method: 'CASH' }, { customerId: 257 }).customer_id, 257);
  assert.equal('customer_id' in saleBody(cart, { method: 'CASH' }, { customerId: null }), false);
  const { outbox } = await open(); const server = fakeServer([]); server.state.down = true;
  const taken = await takeSale({ api: server.api, outbox, cart, method: 'CASH', key: 'k-cust', customerId: 257 });
  assert.equal(taken.kind, 'queued'); server.state.down = false;
  await outbox.flush(sendEntry(server.api));
  assert.equal(server.state.sales[0].body.customer_id, 257);
});
