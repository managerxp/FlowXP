/*
 * Salon stock: batches and expiry, stock in, buying with batch details, service consumption (fixed, variable, manual
 * override), what cancelling gives back, and the alerts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { dayFromNow } from './helpers/dates.js';
import { addRecipe, addService, addStaff, addStock, makeSalon, sell, stockOf } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createSalonInvoice } = await import('../src/modules/salon/pos.js');
const { allocateRemaining, batchPositions } = await import('../src/modules/salon/stock.js');
const { computeAlerts } = await import('../src/modules/salon/alerts.js');
const inventory = (await import('../src/controllers/salonInventory.controller.js')).default;
const invoices = await import('../src/controllers/invoices.controller.js');
const orders = await import('../src/controllers/purchaseOrders.controller.js');
const { fakeRes } = await import('./helpers/salon.js');

test.after(cleanup);

let S; let ravi; let shampoo; let colour; let gel; let colouring; let trim;
const go = (input, opts) => sell(pool, createSalonInvoice, S, input, opts);
const day = (n) => (n == null ? null : dayFromNow(n));
const today = () => day(0);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeSalon(pool, 'stock');
  ravi = await addStaff(pool, S, { name: 'Ravi' });
  shampoo = await addStock(pool, S, { name: 'Shampoo', kind: 'DISH', price: 400, cost: 250, stock: 0, min: 3 });
  colour = await addStock(pool, S, { name: 'Hair colour', kind: 'INGREDIENT', cost: 2, stock: 0, min: 100, unit: 'ml' });
  gel = await addStock(pool, S, { name: 'Gel', kind: 'DISH', price: 300, cost: 100, stock: 20, min: 2 });
  colouring = await addService(pool, S, { name: 'Hair colouring', price: 2000 });
  trim = await addService(pool, S, { name: 'Trim', price: 300 });
  await addRecipe(pool, S, colouring, colour, 50, { variable: true });
  await addRecipe(pool, S, trim, gel, 1);
});

/* ── pure ─────────────────────────────────────────────────────────────────── */

test('what is left is split across batches newest-expiry first (first-expiry-first-out)', { skip }, async () => {
  const batches = [
    { batch_id: 1, expiry_date: '2026-11-01', qty_received: 10 },
    { batch_id: 2, expiry_date: '2027-03-01', qty_received: 10 },
    { batch_id: 3, expiry_date: null, qty_received: 5 }
  ];
  const left = (stock) => Object.fromEntries(allocateRemaining(batches, stock).map((b) => [b.batch_id, b.remaining]));
  assert.deepEqual(left(25), { 1: 10, 2: 10, 3: 5 }, 'nothing used yet');
  assert.deepEqual(left(12), { 1: 0, 2: 7, 3: 5 }, 'the soonest-to-expire is used up first; no-expiry stock last');
  assert.deepEqual(left(3), { 1: 0, 2: 0, 3: 3 });
  assert.deepEqual(left(0), { 1: 0, 2: 0, 3: 0 });
  assert.deepEqual(left(-4), { 1: 0, 2: 0, 3: 0 }, 'negative stock leaves nothing in any batch');
  assert.deepEqual(left(99), { 1: 10, 2: 10, 3: 5 }, 'stock received without a batch record is not attributed');
});

/* ── stock in ─────────────────────────────────────────────────────────────── */

const stockIn = async (body, tenant) => { const res = fakeRes(); await inventory.stockIn(S.req({ body }, tenant), res); return res; };

test('stock in with a batch number and expiry raises stock and records the batch', { skip }, async () => {
  const res = await stockIn({ product_id: shampoo, quantity: 10, batch_no: 'SH-01', expiry_date: day(200), unit_cost: 250, reason: 'OPENING' });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(await stockOf(pool, S.branchId, shampoo), 10);
  const t = (await pool.query(`SELECT transaction_type, quantity FROM inventory_transactions WHERE product_id = $1`, [shampoo])).rows;
  assert.deepEqual(t.map((r) => [r.transaction_type, Number(r.quantity)]), [['OPENING', 10]]);
  const b = (await pool.query(`SELECT * FROM salon_stock_batches WHERE product_id = $1`, [shampoo])).rows[0];
  assert.equal(b.batch_no, 'SH-01'); assert.equal(Number(b.qty_received), 10); assert.equal(Number(b.unit_cost_paise), 25000);
  // the audit write is fire-and-forget: wait for it to land (up to 3 s under load, same pattern as audit.test.js)
  let audited = 0;
  for (let i = 0; i < 30 && audited < 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
    audited = (await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE business_id = $1 AND action = 'salon.stock_in'`, [S.businessId])).rows[0].n;
  }
  assert.ok(audited >= 1, 'audited');
});

test('stock in is validated: a product that is yours, tracked, and a positive amount', { skip }, async () => {
  assert.equal((await stockIn({ product_id: shampoo, quantity: 0 })).code, 400);
  assert.equal((await stockIn({ product_id: shampoo, quantity: -5 })).code, 400);
  assert.equal((await stockIn({ product_id: shampoo, quantity: 1, expiry_date: '31/12/2027' })).code, 400);
  assert.equal((await stockIn({ product_id: shampoo, quantity: 1, reason: 'STOLEN' })).code, 400);
  assert.equal((await stockIn({ product_id: 99999999, quantity: 1 })).code, 404);
  assert.equal((await stockIn({ product_id: trim, quantity: 1 })).code, 409, 'a service is not in stock');
  assert.equal(await stockOf(pool, S.branchId, shampoo), 10, 'nothing changed');
});

test('a second batch for the same product; the batch list shows how much of each is left', { skip }, async () => {
  await stockIn({ product_id: shampoo, quantity: 6, batch_no: 'SH-02', expiry_date: day(40) });
  assert.equal(await stockOf(pool, S.branchId, shampoo), 16);
  // sell 12: they come from the soonest-to-expire batch first (SH-02, 6) and then SH-01
  await go({ items: [{ type: 'PRODUCT', product_id: shampoo, quantity: 12 }] });
  assert.equal(await stockOf(pool, S.branchId, shampoo), 4);
  const list = await S.call(inventory.batches, { query: {} });
  assert.equal(list.code, 200);
  const by = Object.fromEntries(list.body.data.map((b) => [b.batch_no, b]));
  assert.equal(by['SH-01'].remaining, 4); assert.equal(by['SH-02']?.remaining, undefined, 'used-up batches are hidden');
  const all = await S.call(inventory.batches, { query: { include_empty: '1' } });
  assert.equal(all.body.data.find((b) => b.batch_no === 'SH-02').remaining, 0);
  assert.equal(by['SH-01'].status, 'OK');
  assert.ok(by['SH-01'].days_to_expiry >= 199 && by['SH-01'].days_to_expiry <= 200);
});

test('a purchase order receipt can carry the batch number and expiry for each line', { skip }, async () => {
  const supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Beauty Wholesale') RETURNING supplier_id`, [S.businessId])).rows[0].supplier_id;
  const mk = fakeRes();
  await orders.createDraft(S.req({ body: { supplier_id: supplier, items: [{ product_id: colour, quantity: 1000, unit_cost: 2 }] } }), mk);
  assert.equal(mk.code, 201, JSON.stringify(mk.body));
  const poId = mk.body.data.po_id;
  const sent = fakeRes(); await orders.send(S.req({ params: { id: poId }, body: {} }), sent);
  const item = (await pool.query(`SELECT item_id FROM purchase_order_items WHERE po_id = $1`, [poId])).rows[0].item_id;
  const bad = fakeRes();
  await orders.receive(S.req({ params: { id: poId }, body: { items: [{ item_id: item, batch_no: 'C-1', expiry_date: '31-12-2027' }] } }), bad);
  assert.equal(bad.code, 400, 'a malformed expiry date is refused');
  assert.equal(await stockOf(pool, S.branchId, colour), 0, 'and nothing was received');
  const res = fakeRes();
  await orders.receive(S.req({ params: { id: poId }, body: { items: [{ item_id: item, batch_no: 'C-1', expiry_date: day(300) }] } }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(await stockOf(pool, S.branchId, colour), 1000);
  const b = (await pool.query(`SELECT batch_no, qty_received, source, reference_id FROM salon_stock_batches WHERE product_id = $1`, [colour])).rows[0];
  assert.equal(b.batch_no, 'C-1'); assert.equal(Number(b.qty_received), 1000); assert.equal(b.source, 'PURCHASE'); assert.equal(Number(b.reference_id), poId);
});

test('a purchase receipt without batch details is an ordinary receipt', { skip }, async () => {
  const mk = fakeRes();
  await orders.createDraft(S.req({ body: { items: [{ product_id: gel, quantity: 5, unit_cost: 100 }] } }), mk);
  await orders.send(S.req({ params: { id: mk.body.data.po_id }, body: {} }), fakeRes());
  const res = fakeRes(); await orders.receive(S.req({ params: { id: mk.body.data.po_id }, body: {} }), res);
  assert.equal(res.code, 200);
  assert.equal(await stockOf(pool, S.branchId, gel), 25);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM salon_stock_batches WHERE product_id = $1`, [gel])).rows[0].n, 0);
});

/* ── consumption by services ──────────────────────────────────────────────── */

test('a service uses its recipe: fixed amounts by default', { skip }, async () => {
  const before = await stockOf(pool, S.branchId, gel);
  const out = await go({ items: [{ type: 'SERVICE', service_id: trim, staff_id: ravi, quantity: 2 }] });
  assert.equal(await stockOf(pool, S.branchId, gel), before - 2, '1 per trim x 2');
  const tx = (await pool.query(`SELECT quantity, transaction_type FROM inventory_transactions WHERE product_id = $1 AND reference_type = 'invoice' AND reference_id = $2`, [gel, out.invoice.invoice_id])).rows;
  assert.equal(tx.length, 1); assert.equal(tx[0].transaction_type, 'SALE'); assert.equal(Number(tx[0].quantity), -2);
});

test('a variable recipe takes the stylist\'s actual amount; any consumable can also be corrected by hand', { skip }, async () => {
  const start = await stockOf(pool, S.branchId, colour);
  await go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi }] });
  assert.equal(await stockOf(pool, S.branchId, colour), start - 50, 'the default amount');
  await go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: 85 }] }] });
  assert.equal(await stockOf(pool, S.branchId, colour), start - 135, 'the 85 ml actually used');
  await go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: 0 }] }] });
  assert.equal(await stockOf(pool, S.branchId, colour), start - 135, 'zero is allowed: none was used');
  // any consumable of the service can be corrected by hand (a manual override), but only one that is in the recipe
  const g = await stockOf(pool, S.branchId, gel);
  await go({ items: [{ type: 'SERVICE', service_id: trim, staff_id: ravi, consumption_actual: [{ ingredient_id: gel, quantity: 3 }] }] });
  assert.equal(await stockOf(pool, S.branchId, gel), g - 3, 'the override replaced the recipe\'s 1');
  // and something the recipe does not list (an extra product the stylist used) is recorded too
  const c = await stockOf(pool, S.branchId, colour);
  await go({ items: [{ type: 'SERVICE', service_id: trim, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: 3 }] }] });
  assert.equal(await stockOf(pool, S.branchId, colour), c - 3);
});

test('cancelling a bill puts the retail stock and the consumables back', { skip }, async () => {
  const g = await stockOf(pool, S.branchId, gel); const c = await stockOf(pool, S.branchId, colour); const s = await stockOf(pool, S.branchId, shampoo);
  const out = await go({ items: [
    { type: 'SERVICE', service_id: trim, staff_id: ravi }, { type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: 70 }] },
    { type: 'PRODUCT', product_id: shampoo, quantity: 1 }
  ] });
  assert.equal(await stockOf(pool, S.branchId, gel), g - 1);
  assert.equal(await stockOf(pool, S.branchId, colour), c - 70);
  assert.equal(await stockOf(pool, S.branchId, shampoo), s - 1);
  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: out.invoice.invoice_id } }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(await stockOf(pool, S.branchId, gel), g);
  assert.equal(await stockOf(pool, S.branchId, colour), c, 'the amount actually used is what comes back');
  assert.equal(await stockOf(pool, S.branchId, shampoo), s);
});

test('the quote (dry run) never touches stock', { skip }, async () => {
  const g = await stockOf(pool, S.branchId, gel);
  const q = await go({ items: [{ type: 'SERVICE', service_id: trim, staff_id: ravi, quantity: 3 }] }, { dryRun: true });
  assert.ok(q.invoice.total > 0);
  assert.equal(await stockOf(pool, S.branchId, gel), g);
});

test('running out of a consumable never blocks the client in the chair: stock goes negative and is flagged', { skip }, async () => {
  const c = await stockOf(pool, S.branchId, colour);
  await go({ items: [{ type: 'SERVICE', service_id: colouring, staff_id: ravi, consumption_actual: [{ ingredient_id: colour, quantity: c + 10 }] }] });
  assert.equal(await stockOf(pool, S.branchId, colour), -10);
  const al = await S.call(inventory.alerts, { query: {} });
  assert.ok(al.body.data.negative_stock.some((x) => x.name === 'Hair colour'));
  await stockIn({ product_id: colour, quantity: 500, reason: 'ADJUSTMENT', note: 'restocked' });
  assert.equal(await stockOf(pool, S.branchId, colour), 490);
});

/* ── alerts ───────────────────────────────────────────────────────────────── */

test('alerts: low, out of stock, expiring soon, expired', { skip }, async () => {
  const fresh = await makeSalon(pool, 'alert');
  const a = await addStock(pool, fresh, { name: 'Low item', kind: 'DISH', stock: 2, min: 5 });
  const b = await addStock(pool, fresh, { name: 'Empty item', kind: 'DISH', stock: 0, min: 3 });
  const c = await addStock(pool, fresh, { name: 'Healthy item', kind: 'DISH', stock: 50, min: 5 });
  const d = await addStock(pool, fresh, { name: 'Soon item', kind: 'INGREDIENT', stock: 10, min: 1 });
  const e = await addStock(pool, fresh, { name: 'Old item', kind: 'INGREDIENT', stock: 4, min: 1 });
  const f = await addStock(pool, fresh, { name: 'Far item', kind: 'INGREDIENT', stock: 10, min: 1 });
  const batch = (p, qty, exp, no) => pool.query(`INSERT INTO salon_stock_batches (business_id, branch_id, product_id, batch_no, expiry_date, qty_received, source) VALUES ($1,$2,$3,$4,$5,$6,'MANUAL')`, [fresh.businessId, fresh.branchId, p, no, exp, qty]);
  await batch(d, 10, day(10), 'SOON'); await batch(e, 4, day(-3), 'OLD'); await batch(f, 10, day(300), 'FAR');
  const al = await computeAlerts(pool, fresh.businessId, { scope: null, today: today() });
  const names = (xs) => xs.map((x) => x.name).sort();
  assert.deepEqual(names(al.low_stock), ['Low item']);
  assert.deepEqual(names(al.out_of_stock), ['Empty item']);
  assert.deepEqual(names(al.expiring_soon), ['Soon item']);
  assert.deepEqual(names(al.expired), ['Old item']);
  assert.equal(al.counts.low_stock, 1); assert.equal(al.counts.expired, 1);
  assert.ok(!JSON.stringify(al).includes('Healthy item') && !JSON.stringify(al).includes('Far item'));
  void a; void b; void c;

  // the expiry warning window is the salon's own setting
  await pool.query(`UPDATE salon_settings SET expiry_alert_days = 365 WHERE business_id = $1`, [fresh.businessId]);
  const wide = await computeAlerts(pool, fresh.businessId, { scope: null, today: today() });
  assert.deepEqual(names(wide.expiring_soon), ['Far item', 'Soon item']);
});

test('alerts: negative stock and unusually heavy use', { skip }, async () => {
  const fresh = await makeSalon(pool, 'alert2');
  const neg = await addStock(pool, fresh, { name: 'Negative item', kind: 'INGREDIENT', stock: 0, min: 0 });
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,-3) ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = -3`, [fresh.branchId, neg]);
  const busy = await addStock(pool, fresh, { name: 'Busy item', kind: 'INGREDIENT', stock: 100, min: 1 });
  const tx = (qty, daysAgo) => pool.query(
    `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_at) VALUES ($1,$2,$3,'SALE',$4,'invoice', now() - ($5 || ' days')::interval)`,
    [fresh.businessId, fresh.branchId, busy, -qty, String(daysAgo)]);
  for (const d of [10, 17, 24, 31]) await tx(10, d);      // 10 a week, usually
  await tx(40, 2);                                         // 40 this week
  const al = await computeAlerts(pool, fresh.businessId, { scope: null, today: today() });
  assert.deepEqual(al.negative_stock.map((x) => x.name), ['Negative item']);
  assert.deepEqual(al.unusual_consumption.map((x) => x.name), ['Busy item']);
  assert.equal(al.unusual_consumption[0].last_7_days, 40); assert.equal(al.unusual_consumption[0].usual_week, 10);
});

test('the alerts endpoint and the dashboard counts agree', { skip }, async () => {
  const res = await S.call(inventory.alerts, { query: {} });
  assert.equal(res.code, 200);
  const { counts } = res.body.data;
  assert.equal(counts.low_stock, res.body.data.low_stock.length);
  assert.equal(counts.expired, res.body.data.expired.length);
  const positions = await batchPositions(pool, S.businessId, { today: today() });
  assert.ok(positions.length >= 2);
});
