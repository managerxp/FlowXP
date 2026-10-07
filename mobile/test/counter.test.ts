/*
 * The café and restaurant counter (MOBILE.md phase 3): choosing size / milk / sugar / add-ons, the same drink with different options as
 * different lines, the offers preview, the kitchen token, and the option groups living on the phone so all of it works with no signal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { addProduct, emptyCart, lineKey, lineName, saleBody, setQuantity, totals } from '../src/lib/cart.ts';
import { initialChoice, missing, picked, toggle, type Group } from '../src/lib/options.ts';
import { noOffers, previewOffers } from '../src/lib/offers.ts';
import { sendEntry, takeSale } from '../src/lib/till.ts';
import { receiptText, pendingReceiptText, type Invoice } from '../src/lib/receipt.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const group = (id: number, name: string, min: number, max: number | null, mods: [number, string, number][]): Group => ({
  group_id: id, name, is_variant: min === 1 && max === 1, min_select: min, max_select: max, modifiers: mods.map(([modifier_id, n, price_delta]) => ({ modifier_id, name: n, price_delta }))
});
const SIZE = group(1, 'Size', 1, 1, [[11, 'Small', 0], [12, 'Regular', 20], [13, 'Large', 40]]);
const MILK = group(2, 'Milk', 1, 1, [[21, 'Full cream', 0], [22, 'Toned', 0], [23, 'Oat', 40], [24, 'Almond', 50]]);
const ADDONS = group(3, 'Add-ons', 0, 3, [[31, 'Extra shot', 40], [32, 'Syrup', 30], [33, 'Whipped cream', 30], [34, 'Drizzle', 25]]);
const GROUPS = [SIZE, MILK, ADDONS];
const latte = P(1, 'Cafe Latte', 160, { modifier_group_ids: [1, 2, 3], category_name: 'Coffee' });
const muffin = P(2, 'Blueberry Muffin', 110, { category_name: 'Bakes' });

/* ── choosing options ───────────────────────────────────────────────────── */

test('required single choices start on their first option, extras start empty, and a missing choice is named', () => {
  assert.deepEqual(initialChoice(GROUPS), { 1: [11], 2: [21], 3: [] });
  assert.equal(missing(GROUPS, initialChoice(GROUPS)), undefined);
  assert.equal(missing(GROUPS, { 1: [], 2: [21], 3: [] })?.name, 'Size');
  assert.equal(missing([group(9, 'Spice', 2, 3, [[91, 'a', 0], [92, 'b', 0], [93, 'c', 0]])], { 9: [91] })?.name, 'Spice', 'a group that needs two');
});

test('a single-choice group swaps; an extras group toggles up to its maximum and no further', () => {
  let c = initialChoice(GROUPS);
  c = toggle(SIZE, c, 13); assert.deepEqual(c[1], [13]);
  c = toggle(SIZE, c, 12); assert.deepEqual(c[1], [12], 'swapped, not added');
  c = toggle(ADDONS, c, 31); c = toggle(ADDONS, c, 32); c = toggle(ADDONS, c, 33);
  assert.deepEqual(c[3], [31, 32, 33]);
  assert.deepEqual(toggle(ADDONS, c, 34)[3], [31, 32, 33], 'a fourth is refused when the limit is three');
  assert.deepEqual(toggle(ADDONS, c, 32)[3], [31, 33], 'tapping a chosen one takes it off');
});

test('the chosen options give their names, ids and the extra price in paise', () => {
  const c = { 1: [13], 2: [23], 3: [31, 34] };
  assert.deepEqual(picked(GROUPS, c), { ids: [13, 23, 31, 34], names: ['Large', 'Oat', 'Extra shot', 'Drizzle'], deltaPaise: 4000 + 4000 + 4000 + 2500 });
  assert.deepEqual(picked(GROUPS, { 1: [], 2: [], 3: [] }), { ids: [], names: [], deltaPaise: 0 });
});

/* ── the cart ───────────────────────────────────────────────────────────── */

test('the same drink with different options is a different line; the same options merge', () => {
  const oat = picked(GROUPS, { 1: [12], 2: [23], 3: [] }); const full = picked(GROUPS, { 1: [12], 2: [21], 3: [] });
  let cart = addProduct(emptyCart(), latte, 1, oat);
  cart = addProduct(cart, latte, 1, full); cart = addProduct(cart, latte, 1, oat); cart = addProduct(cart, muffin);
  assert.deepEqual(cart.lines.map((l) => [lineName(l), l.quantity]), [['Cafe Latte (Regular, Oat)', 2], ['Cafe Latte (Regular, Full cream)', 1], ['Blueberry Muffin', 1]]);
  assert.equal(lineKey(1, [23, 12]), lineKey(1, [12, 23]), 'the order the options were tapped in does not matter');
  cart = setQuantity(cart, cart.lines[0].key, 0);
  assert.equal(cart.lines.length, 2, 'removing one line leaves the other latte');
});

test('the preview prices the options in: Large oat latte is 160 + 40 + 40 = 240, plus 5% GST', () => {
  const cart = addProduct(emptyCart(), latte, 2, picked(GROUPS, { 1: [13], 2: [23], 3: [] }));
  assert.deepEqual(totals(cart), { itemCount: 2, subtotalPaise: 48000, offersPaise: 0, taxPaise: 2400, totalPaise: 50400 });
});

test('offers come off before GST, line by line, and never below zero', () => {
  const cart = addProduct(addProduct(emptyCart(), muffin, 2), latte, 1, picked(GROUPS, { 1: [11], 2: [21], 3: [] }));
  const offers = new Map([[cart.lines[0].key, 4000], [cart.lines[1].key, 99999999]]);
  // muffins 22000 - 4000 = 18000 (+5% = 900); latte 16000 - 16000 = 0
  assert.deepEqual(totals(cart, offers), { itemCount: 3, subtotalPaise: 38000, offersPaise: 20000, taxPaise: 900, totalPaise: 18900 });
});

test('the sale body carries option ids, the kitchen flag only when asked, and no prices', () => {
  const cart = addProduct(addProduct(emptyCart(), latte, 1, picked(GROUPS, { 1: [12], 2: [23], 3: [31] })), muffin);
  const body = saleBody(cart, { method: 'UPI' }, { kitchen: true });
  assert.deepEqual(body.items, [{ product_id: 1, quantity: 1, modifier_ids: [12, 23, 31] }, { product_id: 2, quantity: 1 }]);
  assert.equal(body.send_to_kitchen, true); assert.equal(JSON.stringify(body).includes('price'), false);
  assert.equal('send_to_kitchen' in saleBody(cart, { method: 'UPI' }), false);
});

/* ── offers preview ─────────────────────────────────────────────────────── */

test('the offers preview asks the server with the option-inclusive price and maps each saving to its line', async () => {
  const server = fakeServer([]); server.state.offerPerLine = 15;
  const cart = addProduct(addProduct(emptyCart(), latte, 1, picked(GROUPS, { 1: [13], 2: [23], 3: [] })), muffin);
  const o = await previewOffers(server.api, cart);
  assert.equal(o.savingPaise, 3000); assert.deepEqual(o.names, ['Happy hour']);
  assert.deepEqual([...o.byKey.entries()], [[cart.lines[0].key, 1500], [cart.lines[1].key, 1500]]);
  assert.deepEqual(JSON.parse(String(server.state.calls.length)) > 0, true);
  server.state.offerPerLine = 0;
  assert.equal((await previewOffers(server.api, cart)).savingPaise, 0, 'no offers running');
  assert.deepEqual(await previewOffers(server.api, emptyCart()), noOffers(), 'nothing on the bill, nothing asked');
});

/* ── the option groups on the phone ─────────────────────────────────────── */

const open = async () => { const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); return { db, catalog: createCatalog(db), outbox: createOutbox(db) }; };

test('the groups are downloaded with the catalogue, kept on the phone, and read back with no signal', async () => {
  const server = fakeServer([latte, muffin]); server.state.groups = GROUPS.map((g) => ({ ...g, products: [{ product_id: 1 }] }));
  const { db, catalog } = await open();
  await catalog.sync(server.api);
  server.state.down = true;
  const again = createCatalog(db);
  assert.deepEqual((await again.groupsFor(latte)).map((g) => g.name), ['Size', 'Milk', 'Add-ons']);
  assert.deepEqual((await again.groupsFor(latte))[1].modifiers.map((m) => [m.name, m.price_delta]), [['Full cream', 0], ['Toned', 0], ['Oat', 40], ['Almond', 50]]);
  assert.deepEqual(await again.groupsFor(muffin), [], 'a muffin has none');
  assert.equal((await again.groupsFor(latte))[0].hasOwnProperty('products'), false, 'the list of dishes is not kept');
  assert.equal((await again.byId(1))?.name, 'Cafe Latte'); assert.equal(await again.byId(99), undefined);
});

test('the groups are re-read at most every ten minutes, and a failure to read them never fails the product sync', async () => {
  const server = fakeServer([latte]); server.state.groups = [SIZE];
  const { catalog } = await open();
  const reads = () => server.state.calls.filter((c) => c === 'GET /modifier-groups').length;
  await catalog.sync(server.api); assert.equal(reads(), 1);
  server.state.groups = [SIZE, MILK];
  await catalog.sync(server.api); assert.equal(reads(), 1, 'fresh enough: not asked again');
  assert.equal((await catalog.groupsFor(latte)).length, 1);
  const realNow = Date.now; Date.now = () => realNow() + 11 * 60 * 1000;
  try { await catalog.sync(server.api); } finally { Date.now = realNow; }
  assert.equal(reads(), 2); assert.equal((await catalog.groupsFor(latte)).length, 2, 'after ten minutes the new group is there');

  server.state.groupsDown = true; server.upsert(P(1, 'Cafe Latte 2', 170, { modifier_group_ids: [1, 2, 3] }));
  Date.now = () => realNow() + 30 * 60 * 1000;
  try { assert.equal((await catalog.sync(server.api)).mode, 'changes', 'the product change still arrived'); } finally { Date.now = realNow; }
  assert.equal((await catalog.groupsFor(latte)).length, 2, 'the groups kept from before still work');
});

/* ── the kitchen token ──────────────────────────────────────────────────── */

test('online, a café sale goes to the kitchen and comes back with its token', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  const cart = addProduct(emptyCart(), latte, 1, picked(GROUPS, { 1: [12], 2: [21], 3: [] }));
  const taken = await takeSale({ api: server.api, outbox, cart, method: 'CASH', key: 'k-cafe', kitchen: true });
  assert.deepEqual(taken, { kind: 'billed', invoiceId: 1, token: 'ORD-0001' });
  assert.equal(server.state.sales[0].body.send_to_kitchen, true);
  assert.deepEqual(server.state.sales[0].body.items, [{ product_id: 1, quantity: 1, modifier_ids: [12, 21] }]);
});

test('offline, the sale is kept with the SAME body (kitchen flag included); when sent it is marked offline and makes no ticket', async () => {
  const { outbox } = await open(); const server = fakeServer([]);
  const cart = addProduct(emptyCart(), latte, 1, picked(GROUPS, { 1: [12], 2: [23], 3: [31] }));
  server.state.down = true;
  const taken = await takeSale({ api: server.api, outbox, cart, method: 'UPI', key: 'k-cafe-off', kitchen: true });
  assert.equal(taken.kind, 'queued');
  const entry = (taken as { entry: NonNullable<Awaited<ReturnType<typeof outbox.get>>> }).entry;
  assert.equal(entry.body.send_to_kitchen, true, 'the retry must equal the first attempt');
  assert.equal(entry.preview.lines[0].name, 'Cafe Latte (Regular, Oat, Extra shot)'); assert.equal(entry.preview.lines[0].unitPricePaise, 16000 + 2000 + 4000 + 4000);
  const pending = pendingReceiptText(entry, 'Brew & Bloom');
  assert.ok(pending.includes('Cafe Latte (Regular, Oat, Extra shot)') && pending.includes('No kitchen ticket was made'));
  server.state.down = false;
  assert.deepEqual(await outbox.flush(sendEntry(server.api)), { sent: 1, failed: 0, stopped: null });
  assert.equal(server.state.sales[0].headers['X-Offline-Sale'], '1');
});

test('the receipt shows the kitchen token under the bill number', () => {
  const inv: Invoice = {
    invoice_id: 1, invoice_number: 'INV-0042', invoice_date: '2026-10-07', order_number: 'ORD-0017', subtotal: 160, discount: 0, tax: 8, round_off: 0, total: 168, amount_paid: 168, balance_due: 0,
    items: [{ description: 'Cafe Latte (Regular, Oat)', quantity: 1, unit_price: 160, discount: 0, tax_rate: 5, line_total: 168 }], payments: [{ method: 'CASH', amount: 168 }]
  };
  const lines = receiptText(inv, 'Brew & Bloom').split('\n');
  assert.equal(lines[lines.findIndex((l) => l.includes('INV-0042')) + 1], 'TOKEN ORD-0017');
  assert.equal(receiptText({ ...inv, order_number: null }, 'Shop').includes('TOKEN'), false);
});
