/*
 * The offline matrix (MOBILE.md phase 2): the catalogue copy in SQLite and how it keeps up, the outbox of unsent sales, and what happens when
 * the signal drops at the worst moments. Real SQLite (Node's), a fake server with switches for "no signal", "broken" and "reply lost".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox, MAX_UNSENT, type Preview } from '../src/lib/outbox.ts';
import { addProduct, emptyCart } from '../src/lib/cart.ts';
import { dayOf, previewOf, sendEntry, takeSale } from '../src/lib/till.ts';
import { pendingReceiptText } from '../src/lib/receipt.ts';
import { ApiError } from '../src/lib/api.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const open = async () => {
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
  return { db, catalog: createCatalog(db), outbox: createOutbox(db) };
};
const five = () => [P(1, 'Parle-G Biscuit', 10), P(2, 'Marie Gold Biscuit', 25), P(3, 'Tata Tea Gold', 120, { category_name: 'Beverages' }), P(4, 'Good Day Cashew', 30), P(5, 'Gold Flake', 15, { barcodes: ['8901234567890', '1234'] })];
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

/* ── the catalogue copy ─────────────────────────────────────────────────── */

test('first sync downloads every page into SQLite, then finds by barcode and by words', async () => {
  const server = fakeServer(five(), { pageSize: 2 });
  const { catalog } = await open(); const seen: number[] = [];
  const first = await catalog.sync(server.api, (n) => seen.push(n));
  assert.deepEqual(first, { mode: 'full', products: 5 }); assert.deepEqual(seen, [2, 4, 5]);
  assert.equal(server.state.calls[0], 'GET /sync/head', 'the position is read before the download');
  assert.equal(await catalog.count(), 5); assert.ok(await catalog.syncedAt());
  assert.equal((await catalog.findByBarcode('8901234567890'))?.name, 'Gold Flake');
  assert.equal((await catalog.findByBarcode(' 1234 '))?.name, 'Gold Flake', 'a second barcode on one product');
  assert.equal(await catalog.findByBarcode('nope'), undefined);
  assert.deepEqual(names(await catalog.search('biscuit')), ['Marie Gold Biscuit', 'Parle-G Biscuit']);
  assert.deepEqual(names(await catalog.search('gold bisc')), ['Marie Gold Biscuit'], 'every word must match');
  assert.deepEqual(names(await catalog.search('gold')), ['Gold Flake', 'Marie Gold Biscuit', 'Tata Tea Gold'], 'names starting with it come first');
  assert.deepEqual(names(await catalog.search('beverages')), ['Tata Tea Gold'], 'category is searched');
  assert.equal((await catalog.search('')).length, 5); assert.equal((await catalog.search('', 2)).length, 2);
  assert.deepEqual(await catalog.search('100%'), [], 'a % in the search is text, not a wildcard');
});

test('the copy survives the app being closed and works with no signal at all', async () => {
  const server = fakeServer(five());
  const { db, catalog } = await open();
  await catalog.sync(server.api);
  server.state.down = true;
  const reopened = createCatalog(db);                    // the app starts again; the database file is what remains
  assert.equal(await reopened.count(), 5);
  assert.equal((await reopened.findByBarcode('8900000001'))?.name, 'Parle-G Biscuit');
  await assert.rejects(reopened.sync(server.api), /offline/i);
  assert.equal(await reopened.count(), 5, 'a failed sync takes nothing away');
});

test('a download that stops half way leaves the old copy exactly as it was', async () => {
  const server = fakeServer(five(), { pageSize: 2 });
  const { catalog } = await open();
  await catalog.sync(server.api);
  server.upsert(P(1, 'Parle-G CHANGED', 11));
  // force the next sync to be a full download that dies on its second page
  server.state.floor = 999999;
  let page = 0; const real = server.fetchImpl;
  const flaky = (async (u: string, i: RequestInit) => { if (String(u).includes('pos-catalog') && ++page === 2) throw new TypeError('Network request failed'); return real(u, i); }) as typeof fetch;
  const { createApi } = await import('../src/lib/api.ts');
  const api = createApi({ baseUrl: 'http://x', getSession: () => server.session, fetchImpl: flaky });
  await assert.rejects(catalog.sync(api));
  assert.equal(await catalog.count(), 5); assert.equal((await catalog.search('parle'))[0].name, 'Parle-G Biscuit', 'still the old row');
});

test('changes arrive as upserts and deletes, page by page; a quiet server changes nothing', async () => {
  const server = fakeServer(five());
  const { catalog } = await open();
  await catalog.sync(server.api);
  assert.deepEqual(await catalog.sync(server.api), { mode: 'changes', applied: 0 });
  server.upsert(P(1, 'Parle-G Biscuit', 12, { barcodes: ['9990001'] }));      // price and barcode change
  server.upsert(P(6, 'Hide & Seek', 40));                                       // new
  server.remove(4);                                                             // gone
  const r = await catalog.sync(server.api);
  assert.deepEqual(r, { mode: 'changes', applied: 3 });
  assert.equal(await catalog.count(), 5);
  assert.equal((await catalog.search('parle'))[0].selling_price, 12);
  assert.equal((await catalog.findByBarcode('9990001'))?.name, 'Parle-G Biscuit'); assert.equal(await catalog.findByBarcode('8900000001'), undefined, 'the old barcode is gone');
  assert.equal(await catalog.findByBarcode('8900000004'), undefined, 'a deleted product is gone with its barcode');
  assert.deepEqual(names(await catalog.search('hide')), ['Hide & Seek']);

  for (let i = 0; i < 1300; i++) server.upsert(P(100 + i, `Bulk ${i}`, 5));    // more than one page of changes (limit 500)
  assert.deepEqual(await catalog.sync(server.api), { mode: 'changes', applied: 1300 });
  assert.equal(await catalog.count(), 1305);
});

test('away too long (409 RESYNC) means a fresh full download', async () => {
  const server = fakeServer(five());
  const { catalog } = await open();
  await catalog.sync(server.api);
  server.upsert(P(9, 'New thing', 1)); server.state.floor = 50;
  assert.deepEqual(await catalog.sync(server.api), { mode: 'full', products: 6 });
  assert.deepEqual(await catalog.sync(server.api), { mode: 'changes', applied: 0 }, 'and from then on, changes again');
});

test('100,000 products: the download lands, search and barcode answer in a blink', async () => {
  const products = Array.from({ length: 100000 }, (_, i) => P(i + 1, `Brand ${i % 50} Item ${i}`, 10 + (i % 90), { barcodes: [`89${String(i).padStart(11, '0')}`] }));
  const server = fakeServer(products, { pageSize: 2000 });
  const { catalog } = await open();
  const t0 = performance.now();
  await catalog.sync(server.api);
  const download = performance.now() - t0;
  assert.equal(await catalog.count(), 100000);
  const t1 = performance.now();
  for (let i = 0; i < 10; i++) await catalog.search('brand 7 item 7');
  const search = (performance.now() - t1) / 10;
  const t2 = performance.now(); for (let i = 0; i < 200; i++) assert.ok(await catalog.findByBarcode(`89${String(i * 37).padStart(11, '0')}`)); const scan = (performance.now() - t2) / 200;
  console.log(`  100k: download ${Math.round(download)} ms, search ${search.toFixed(1)} ms, barcode ${scan.toFixed(2)} ms`);
  assert.ok(search < 250, `search ${search.toFixed(1)} ms`); assert.ok(scan < 5, `barcode ${scan.toFixed(2)} ms`);
});

/* ── the outbox ─────────────────────────────────────────────────────────── */

const preview: Preview = { lines: [{ name: 'Tea', quantity: 2, unitPricePaise: 5000 }], subtotalPaise: 10000, taxPaise: 500, totalPaise: 10500, method: 'CASH' };
const add = (outbox: ReturnType<typeof createOutbox>, id: string) => outbox.add({ id, body: { items: [{ product_id: 1, quantity: 1 }], payment: { method: 'CASH', amount: 'FULL' }, id }, preview });

test('a queued sale gets a provisional number, the same key twice is one sale, and two phones never share a number', async () => {
  const a = await open(); const b = await open();
  const first = await add(a.outbox, 'k1'); const second = await add(a.outbox, 'k2'); const again = await add(a.outbox, 'k1');
  assert.match(first!.local_no, /^P-[A-Z2-9]{3}-0001$/); assert.match(second!.local_no, /-0002$/);
  assert.equal(again!.local_no, first!.local_no); assert.equal((await a.outbox.list()).length, 2);
  assert.notEqual((await add(b.outbox, 'k1'))!.local_no.slice(0, 5), first!.local_no.slice(0, 5), 'another phone has another device code (a one in 29,791 chance of equal)');
  assert.deepEqual(await a.outbox.counts(), { pending: 2, failed: 0, sent: 0 });
});

test('sending goes oldest first and records the real invoice number', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  for (const k of ['k1', 'k2', 'k3']) await add(outbox, k);
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 3, failed: 0, stopped: null });
  assert.deepEqual(server.state.sales.map((s) => s.key), ['k1', 'k2', 'k3']);
  const sent = (await outbox.list()).reverse();
  assert.deepEqual(sent.map((e) => e.invoice_number), ['INV-0001', 'INV-0002', 'INV-0003']);
  for (const s of server.state.sales) { assert.equal(s.headers['X-Offline-Sale'], '1'); assert.equal(s.headers['X-Sale-Date'], dayOf(Date.now())); assert.equal(s.headers['Idempotency-Key'], s.key); }
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 0, failed: 0, stopped: null }, 'nothing left to send');
});

test('it stops at the first "try later" and keeps the order: no signal, a broken server, a signed-out session', async () => {
  for (const [setup, why] of [[(s: ReturnType<typeof fakeServer>) => { s.state.down = true; }, 'offline'], [(s: ReturnType<typeof fakeServer>) => { s.state.status = 503; }, 'server'], [(s: ReturnType<typeof fakeServer>) => { s.state.status = 500; }, 'server'], [(s: ReturnType<typeof fakeServer>) => { s.state.status = 401; }, 'auth'], [(s: ReturnType<typeof fakeServer>) => { s.state.status = 429; }, 'server']] as const) {
    const { outbox } = await open(); const server = fakeServer([]);
    await add(outbox, 'k1'); await add(outbox, 'k2');
    setup(server);
    assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 0, failed: 0, stopped: why });
    assert.deepEqual(await outbox.counts(), { pending: 2, failed: 0, sent: 0 }, `${why}: nothing lost, nothing parked`);
    server.state.down = false; server.state.status = 0;
    assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 2, failed: 0, stopped: null }, 'and it goes through once the trouble is over');
    assert.deepEqual(server.state.sales.map((s) => s.key), ['k1', 'k2'], 'in the order they were taken');
  }
});

test('a sale the server refuses is parked with its reason; the ones behind it still go; a person retries or discards it', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  for (const k of ['k1', 'k2', 'k3']) await add(outbox, k);
  server.state.refuse.set('k2', { status: 409, message: 'Not enough stock for Tin (0 left here)' });
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 2, failed: 1, stopped: null });
  const parked = (await outbox.list()).find((e) => e.id === 'k2')!;
  assert.equal(parked.state, 'failed'); assert.equal(parked.error, 'Not enough stock for Tin (0 left here)');
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 0, failed: 0, stopped: null }, 'a parked sale is not sent again by itself');

  await outbox.discard('k1');                                    // a SENT sale cannot be discarded
  assert.equal((await outbox.list()).length, 3);
  server.state.refuse.clear(); await outbox.retry('k2');
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null });

  server.state.refuse.set('k4', { status: 400, message: 'Coupon expired' }); await add(outbox, 'k4');
  await outbox.flush(sendEntry(server.api)); await outbox.discard('k4');
  assert.equal((await outbox.list()).some((e) => e.id === 'k4'), false);
  await add(outbox, 'k5'); await outbox.discard('k5');
  assert.equal((await outbox.list()).some((e) => e.id === 'k5'), true, 'a waiting sale is real money and cannot be discarded');
});

test('the signal drops AFTER the server made the invoice: the retry returns that invoice, never a second', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  await add(outbox, 'k1');
  server.state.lostReplies = 1;
  assert.equal((await outbox.flush(sendEntry(server.api))).stopped, 'offline');
  assert.equal(server.state.sales.length, 1, 'the server did make it');
  assert.equal((await outbox.get('k1'))!.state, 'pending', 'but the phone does not know');
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null });
  assert.equal(server.state.sales.length, 1, 'still one invoice'); assert.equal((await outbox.get('k1'))!.invoice_number, 'INV-0001');
});

test('the app is killed mid-send: the sale is still there and goes out once, with its attempts counted', async () => {
  const { db, outbox } = await open(); const server = fakeServer([]);
  await add(outbox, 'k1');
  await assert.rejects(outbox.flush(async () => { throw new Error('process killed'); }).then((r) => { if (r.stopped) throw new Error('stopped'); }));
  const restarted = createOutbox(db);
  assert.deepEqual(await restarted.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null });
  assert.equal((await restarted.get('k1'))!.attempts, 2); assert.equal(server.state.sales.length, 1);
});

test('two flushes at once are one flush', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  await add(outbox, 'k1'); await add(outbox, 'k2');
  const [x, y] = await Promise.all([outbox.flush(sendEntry(server.api)), outbox.flush(sendEntry(server.api))]);
  assert.deepEqual(x, y); assert.equal(server.state.sales.length, 2);
});

test('the queue has a ceiling, and sent sales are forgotten after a week', async () => {
  let clock = Date.now();
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
  const outbox = createOutbox(db, { now: () => clock }); const server = fakeServer([]);
  for (let i = 0; i < MAX_UNSENT; i++) await add(outbox, `q${i}`);
  assert.equal(await add(outbox, 'one-too-many'), null, 'full');
  assert.deepEqual((await outbox.flush(sendEntry(server.api))).sent, MAX_UNSENT);
  assert.ok(await add(outbox, 'fits-again'), 'room again once they are sent');
  await outbox.flush(sendEntry(server.api));
  clock += 8 * 24 * 3600 * 1000;
  await add(outbox, 'fresh'); await outbox.flush(sendEntry(server.api));
  const left = await outbox.list();
  assert.deepEqual(left.map((e) => e.id), ['fresh'], 'a week on, only the sale taken since is left');
});

/* ── taking a sale ──────────────────────────────────────────────────────── */

const cartOf = () => addProduct(addProduct(emptyCart(), P(1, 'Tea', 50), 2), P(2, 'Biscuit', 20));

test('online: the sale goes straight to the server and nothing is queued', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  const taken = await takeSale({ api: server.api, outbox, cart: cartOf(), method: 'UPI', reference: 'T9', key: 'k-online' });
  assert.deepEqual(taken, { kind: 'billed', invoiceId: 1, token: null });
  assert.equal((await outbox.list()).length, 0);
  assert.equal(server.state.sales[0].headers['X-Offline-Sale'], undefined, 'a sale made online is not marked offline');
  assert.deepEqual(server.state.sales[0].body.items, [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }]);
});

test('no signal, a timeout, or a dead gateway: the sale is kept, with a provisional receipt', async () => {
  for (const setup of [(s: ReturnType<typeof fakeServer>) => { s.state.down = true; }, (s: ReturnType<typeof fakeServer>) => { s.state.hang = true; }, (s: ReturnType<typeof fakeServer>) => { s.state.status = 502; }, (s: ReturnType<typeof fakeServer>) => { s.state.status = 504; }]) {
    const { outbox } = await open(); const server = fakeServer([]); setup(server);
    const taken = await takeSale({ api: server.api, outbox, cart: cartOf(), method: 'CASH', key: 'k-off', tryMs: 30 });
    assert.equal(taken.kind, 'queued');
    const e = (taken as { entry: Awaited<ReturnType<typeof outbox.get>> }).entry!;
    assert.equal(e.state, 'pending'); assert.deepEqual(e.preview, previewOf(cartOf(), 'CASH')); assert.equal(e.preview.totalPaise, 12600);
    const text = pendingReceiptText(e, 'Shop');
    for (const want of ['*** PENDING BILL ***', 'Not final', e.local_no, 'Tea', '2 x ₹50.00', 'Biscuit', 'TOTAL (about)', '₹126.00']) assert.ok(text.includes(want), `missing ${want}`);
    // signal back: it goes out with the same body, marked offline
    server.state.down = false; server.state.hang = false; server.state.status = 0;
    assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null });
    assert.equal(server.state.sales.length, 1); assert.equal(server.state.sales[0].headers['X-Offline-Sale'], '1');
  }
});

test('the first attempt timed out but the server DID make the invoice: the queued retry matches it exactly and returns it', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  server.state.lostReplies = 1;
  const taken = await takeSale({ api: server.api, outbox, cart: cartOf(), method: 'CASH', key: 'k-lost' });
  assert.equal(taken.kind, 'queued'); assert.equal(server.state.sales.length, 1);
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null }, 'not "a different request" (422) and not a second invoice');
  assert.equal(server.state.sales.length, 1); assert.equal((await outbox.get('k-lost'))!.invoice_number, 'INV-0001');
});

test('a refusal while online is shown to the cashier, NOT queued behind their back', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  server.state.refuse.set('k-no', { status: 409, message: 'Not enough stock for Tin (0 left here)' });
  await assert.rejects(takeSale({ api: server.api, outbox, cart: cartOf(), method: 'CASH', key: 'k-no' }), (e) => e instanceof ApiError && e.status === 409);
  assert.equal((await outbox.list()).length, 0);
});

test('a full queue says so instead of taking a sale it cannot keep', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  for (let i = 0; i < MAX_UNSENT; i++) await add(outbox, `q${i}`);
  server.state.down = true;
  assert.deepEqual(await takeSale({ api: server.api, outbox, cart: cartOf(), method: 'CASH', key: 'k-x' }), { kind: 'full' });
});

test('the phone\'s date: its own calendar day, zero padded', () => {
  assert.equal(dayOf(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05'); assert.equal(dayOf(new Date(2026, 11, 31, 0, 1).getTime()), '2026-12-31');
});

test('a phone with an older copy downloads once more (so removed kinds of product disappear), and the download leaves no side tables behind', async () => {
  const server = fakeServer(five());
  const { db, catalog } = await open();
  await catalog.sync(server.api);
  server.remove(4);                                              // the server no longer sends this one (as when ingredients stopped being sent)
  await db.run(`DELETE FROM meta WHERE k = 'v'`);                // a copy made before the version mark existed
  const r = await catalog.sync(server.api);
  assert.deepEqual(r, { mode: 'full', products: 4 }, 'one full download, not just changes');
  assert.equal(await catalog.findByBarcode('8900000004'), undefined, 'the removed product is gone from the phone');
  assert.deepEqual((await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_next'`)), [], 'no side tables left');
  assert.equal((await catalog.sync(server.api)).mode, 'changes', 'and from then on, changes again');
});

test('the phone database: writes queue one at a time, a failed transaction leaves nothing behind, and a write waits for a transaction in progress', async () => {
  const db = nodeDb(); await db.exec('CREATE TABLE t (n INTEGER)');
  await assert.rejects(db.tx(async (x) => { await x.run('INSERT INTO t VALUES (1)'); throw new Error('stop half way'); }), /stop half way/);
  assert.equal((await db.all('SELECT * FROM t')).length, 0, 'rolled back');
  let release!: () => void; const hold = new Promise<void>((r) => { release = r; });
  const slow = db.tx(async (x) => { await x.run('INSERT INTO t VALUES (2)'); await hold; await x.run('INSERT INTO t VALUES (3)'); });
  const other = db.run('INSERT INTO t VALUES (99)');                 // arrives while the transaction is open
  await new Promise((r) => setTimeout(r, 20));
  release(); await slow; await other;
  assert.deepEqual((await db.all<{ n: number }>('SELECT n FROM t ORDER BY n')).map((r) => r.n), [2, 3, 99], 'the other write ran after the transaction, not inside it');
  await assert.rejects(db.tx(async (x) => { await x.tx(async () => {}); }), /inside another/);
  const many = await Promise.all(Array.from({ length: 50 }, (_, i) => db.run('INSERT INTO t VALUES (?)', [1000 + i])));
  assert.equal(many.length, 50); assert.equal(Number((await db.all<{ c: number }>('SELECT COUNT(*) AS c FROM t'))[0].c), 53);
});

test('rebuilding the product list starts it fresh, even from a damaged copy, and never touches a bill waiting to send', async () => {
  const server = fakeServer(five()); const { db, catalog, outbox } = await open();
  await catalog.sync(server.api); await add(outbox, 'waiting-bill');
  await db.exec(`DROP TABLE barcodes`);                                         // a damaged copy
  await catalog.rebuild();
  assert.equal(await catalog.count(), 0);
  assert.deepEqual((await catalog.sync(server.api)), { mode: 'full', products: 5 }, 'downloads everything again');
  assert.equal((await outbox.list()).length, 1, 'the bill is still waiting'); assert.equal((await catalog.findByBarcode('8900000001'))?.name, 'Parle-G Biscuit');
  await db.exec(`DROP TABLE products_next`).catch(() => {});
});

test('paging through the product list never repeats or skips a product, even when names repeat', async () => {
  const { catalog } = await open();
  // 130 products sharing a handful of names: the order within one name must be fixed, or a page boundary can show the same product twice
  const many = Array.from({ length: 130 }, (_, i) => P(1000 + i, ['Americano', 'Latte', 'Muffin'][i % 3], 50 + (i % 7)));
  await catalog.sync(fakeServer(many).api);
  const seen: number[] = [];
  for (let offset = 0; ; offset += 20) {
    const page = await catalog.search('', 20, undefined, offset);
    seen.push(...page.map((p) => p.product_id));
    if (page.length < 20) break;
  }
  assert.equal(seen.length, 130);
  assert.equal(new Set(seen).size, 130, 'no product appears twice');
});
