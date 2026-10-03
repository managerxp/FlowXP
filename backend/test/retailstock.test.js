/*
 * The retail stock center, through the real routers and tokens: receiving with batch and expiry, soonest-expiry-first
 * sales (and putting stock back on a cancel or a return), expiry write-off, the stock overview, stock counts, and the
 * spreadsheet imports. Money-adjacent invariants first: the ledger and the batches never disagree about a sale, and a
 * count is only a record until it is applied.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestDb } from './helpers/db.js';
import { dayFromNow } from './helpers/dates.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { default: express } = await import('express');
await import('express-async-errors');
const { signToken } = await import('../src/middleware/auth.js');
const { default: productRoutes } = await import('../src/routes/products.routes.js');
const { default: retailRoutes } = await import('../src/routes/retail.routes.js');
const { default: invoiceRoutes } = await import('../src/routes/invoices.routes.js');
const { default: purchaseRoutes } = await import('../src/routes/purchases.routes.js');
const { default: creditNoteRoutes } = await import('../src/routes/creditNotes.routes.js');

let server; let base;
test.after(async () => {
  if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  await cleanup();
});

const call = async (token, method, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let seq = 0;
const makeBusiness = async (type) => {
  seq += 1;
  const newUser = async (role) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id, token_version`, [`${role}${seq}`, `${role.toLowerCase()}${seq}@stock.test`])).rows[0];
  const owner = await newUser('OWNER');
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code) VALUES ($1,$2,$3,'ACTIVE','GROWTH') RETURNING business_id`, [`Shop ${seq}`, owner.user_id, type])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const staff = {};
  for (const role of ['OWNER', 'MANAGER', 'CASHIER']) {
    const user = role === 'OWNER' ? owner : await newUser(role);
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,$3,'ACTIVE')`, [biz, user.user_id, role]);
    staff[role] = signToken(user);
  }
  return { biz, branch, ...staff };
};

let S; let O; let R; let milk; let rice; let soap;
const stockOf = async (id, b = S) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [b.branch, id])).rows[0]?.quantity ?? 0);
const batches = async (id) => (await pool.query(`SELECT batch_no, qty_on_hand::float AS qty, expiry_date::text AS expiry FROM wholesale_batches WHERE product_id = $1 ORDER BY expiry_date, batch_no`, [id])).rows;
const receive = (items, b = S) => call(b.OWNER, 'POST', '/purchases', { items });
const sell = (id, quantity, b = S) => call(b.OWNER, 'POST', '/invoices', { items: [{ product_id: id, quantity }], payment: { method: 'CASH', amount: 'FULL' } });
const product = async (body, b = S) => (await call(b.OWNER, 'POST', '/products', { selling_price: 50, purchase_price: 30, ...body })).body.data.product_id;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const app = express();
  app.use(express.json());
  app.use('/api/retail', retailRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api', creditNoteRoutes);
  app.use('/api', productRoutes);
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ success: false, message: 'boom' }); });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  S = await makeBusiness('SUPERMARKET'); O = await makeBusiness('SUPERMARKET'); R = await makeBusiness('RESTAURANT');
  milk = await product({ name: 'Amul Milk 500ml', barcode: '8901262010011', track_expiry: true });
  rice = await product({ name: 'Basmati Rice 1kg', barcode: '8906001000019' });
  soap = await product({ name: 'Lux Soap', barcode: '8901030000010', min_stock: 5 });
});

/* ── receiving with batches ───────────────────────────────────────────────────────────────── */

test('a product that tracks expiry cannot be received without a real expiry date', { skip }, async () => {
  for (const bad of [{}, { expiry_date: 'soon' }, { expiry_date: '2026-02-30' }]) {
    const r = await receive([{ product_id: milk, quantity: 5, unit_cost: 20, ...bad }]);
    assert.equal(r.status, 400); assert.match(r.body.message, /expiry date/i);
  }
  assert.equal(await stockOf(milk), 0, 'nothing was received');
  assert.equal((await call(S.OWNER, 'GET', '/purchases')).body.data.length, 0, 'and no purchase was written');
});

test('received stock goes into dated batches; the same expiry date is one batch', { skip }, async () => {
  const first = await receive([{ product_id: milk, quantity: 10, unit_cost: 20, expiry_date: dayFromNow(3), batch_no: 'M1' }, { product_id: rice, quantity: 40, unit_cost: 60 }]);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await receive([{ product_id: milk, quantity: 10, unit_cost: 20, expiry_date: dayFromNow(30), batch_no: 'M2' }])).status, 201);
  for (let i = 0; i < 2; i += 1) assert.equal((await receive([{ product_id: milk, quantity: 4, unit_cost: 20, expiry_date: dayFromNow(60) }])).status, 201);
  assert.equal(await stockOf(milk), 28);
  const b = await batches(milk);
  assert.deepEqual(b.map((x) => [x.batch_no, x.qty]), [['M1', 10], ['M2', 10], [`EXP${dayFromNow(60).replaceAll('-', '')}`, 8]]);
  assert.equal((await batches(rice)).length, 0, 'a product that does not track expiry has no batches');
});

/* ── sales are taken soonest-expiry first ─────────────────────────────────────────────────── */

test('a sale is taken from the soonest-expiring batch first and the ledger agrees', { skip }, async () => {
  const bill = await sell(milk, 12);
  assert.equal(bill.status, 201);
  assert.deepEqual((await batches(milk)).map((x) => x.qty), [0, 8, 8]);   // M1 emptied, 2 more from M2
  assert.equal(await stockOf(milk), 16);
  const sale = (await pool.query(`SELECT SUM(quantity)::float AS q FROM inventory_transactions WHERE product_id = $1 AND transaction_type = 'SALE'`, [milk])).rows[0].q;
  assert.equal(sale, -12);
  const total = (await batches(milk)).reduce((t, x) => t + x.qty, 0);
  assert.equal(total, await stockOf(milk), 'batches add up to the shelf');
});

test('cancelling the invoice puts the stock back into the same batches', { skip }, async () => {
  const bill = (await sell(milk, 9)).body.data;
  assert.deepEqual((await batches(milk)).map((x) => x.qty), [0, 0, 7]);
  assert.equal((await call(S.OWNER, 'POST', `/invoices/${bill.invoice_id}/cancel`, {})).status, 200);
  assert.deepEqual((await batches(milk)).map((x) => x.qty), [0, 8, 8]);
  assert.equal(await stockOf(milk), 16);
});

test('a returned item (credit note with restock) goes back to the batch it left', { skip }, async () => {
  const bill = (await sell(milk, 3)).body.data;
  assert.deepEqual((await batches(milk)).map((x) => x.qty), [0, 5, 8]);
  const item = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [bill.invoice_id])).rows[0].item_id;
  const cn = await call(S.OWNER, 'POST', `/invoices/${bill.invoice_id}/credit-notes`, { items: [{ item_id: item, quantity: 2 }], reason: 'Packet leaked', restock: true });
  assert.equal(cn.status, 201, JSON.stringify(cn.body));
  assert.deepEqual((await batches(milk)).map((x) => x.qty), [0, 7, 8]);
  assert.equal(await stockOf(milk), 15);
});

test('products that do not track expiry sell exactly as before', { skip }, async () => {
  assert.equal((await sell(rice, 5)).status, 201);
  assert.equal(await stockOf(rice), 35);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM wholesale_batch_moves WHERE batch_id IN (SELECT batch_id FROM wholesale_batches WHERE product_id = $1)`, [rice])).rows[0].n, 0);
});

/* ── expiry ───────────────────────────────────────────────────────────────────────────────── */

let expiredBatch;
test('expired stock is never sold from, is listed as expired, and can be written off', { skip }, async () => {
  const eggs = await product({ name: 'Farm Eggs 6', track_expiry: true });
  assert.equal((await receive([{ product_id: eggs, quantity: 6, unit_cost: 5, expiry_date: dayFromNow(-2), batch_no: 'OLD' }, { product_id: eggs, quantity: 6, unit_cost: 5, expiry_date: dayFromNow(10), batch_no: 'NEW' }])).status, 201);
  assert.equal((await sell(eggs, 4)).status, 201);
  assert.deepEqual((await batches(eggs)).map((x) => [x.batch_no, x.qty]), [['OLD', 6], ['NEW', 2]], 'the expired batch was skipped');

  const list = (await call(S.OWNER, 'GET', '/retail/expiry?state=expired')).body.data;
  assert.equal(list.summary.expired >= 1, true);
  const row = list.rows.find((r) => r.name === 'Farm Eggs 6');
  assert.equal(row.batch_no, 'OLD'); assert.equal(row.days_left, -2); assert.equal(row.qty_on_hand, 6);
  expiredBatch = row.batch_id;
  assert.equal((await call(S.OWNER, 'GET', '/retail/expiry?state=expiring&days=30')).body.data.rows.some((r) => r.batch_no === 'NEW'), true);

  const before = await stockOf(eggs);
  const wo = await call(S.OWNER, 'POST', `/retail/expiry/${expiredBatch}/write-off`, {});
  assert.equal(wo.status, 200, JSON.stringify(wo.body));
  assert.equal(await stockOf(eggs), before - 6);
  const led = (await pool.query(`SELECT transaction_type, reason_code, quantity::float AS q FROM inventory_transactions WHERE product_id = $1 AND transaction_type = 'WASTAGE'`, [eggs])).rows;
  assert.deepEqual(led, [{ transaction_type: 'WASTAGE', reason_code: 'EXPIRED', q: -6 }]);
  assert.equal((await call(S.OWNER, 'POST', `/retail/expiry/${expiredBatch}/write-off`, {})).status, 400, 'nothing left to write off');
});

test('a batch of another business is invisible: 404, not 403', { skip }, async () => {
  assert.equal((await call(O.OWNER, 'POST', `/retail/expiry/${expiredBatch}/write-off`, {})).status, 404);
});

/* ── the stock center ─────────────────────────────────────────────────────────────────────── */

test('the overview counts out, low and expiring products and values stock at cost', { skip }, async () => {
  await receive([{ product_id: soap, quantity: 3, unit_cost: 30 }]);       // min 5 -> low
  const empty = await product({ name: 'Empty Packet', min_stock: 2 });
  const all = (await call(S.OWNER, 'GET', '/retail/stock')).body.data;
  assert.equal(all.summary.out >= 1 && all.summary.low >= 1, true);
  assert.equal((await call(S.OWNER, 'GET', '/retail/stock?status=out')).body.data.rows.some((r) => r.product_id === empty), true);
  const low = (await call(S.OWNER, 'GET', '/retail/stock?status=low')).body.data.rows;
  assert.deepEqual(low.map((r) => r.name), ['Lux Soap']);
  assert.equal(low[0].state, 'low');
  const expiring = (await call(S.OWNER, 'GET', '/retail/stock?status=expiring&days=30')).body.data.rows;
  assert.equal(expiring.some((r) => r.name === 'Amul Milk 500ml'), true);
  assert.equal(expiring.some((r) => r.name === 'Lux Soap'), false);
  const milkRow = all.rows.find((r) => r.name === 'Amul Milk 500ml');
  assert.equal(milkRow.qty, await stockOf(milk)); assert.equal(milkRow.next_expiry, dayFromNow(30));
  const worth = (await pool.query(`SELECT SUM(current_stock * purchase_price_paise)::bigint AS v FROM products WHERE business_id = $1 AND track_inventory`, [S.biz])).rows[0].v;
  assert.equal(Math.round(all.summary.cost_value * 100), Number(worth));
  assert.equal((await call(S.OWNER, 'GET', '/retail/stock?search=8906001000019')).body.data.rows.map((r) => r.name).join(), 'Basmati Rice 1kg', 'found by barcode');
});

test('the stock center is retail-only, needs the inventory permission, and shows only your business', { skip }, async () => {
  assert.equal((await call(R.OWNER, 'GET', '/retail/stock')).status, 404, 'a restaurant has no stock center');
  assert.equal((await call(S.CASHIER, 'GET', '/retail/stock')).status, 403);
  assert.equal((await call(null, 'GET', '/retail/stock')).status, 401);
  assert.equal((await call(O.OWNER, 'GET', '/retail/stock')).body.data.summary.products, 0, 'the other supermarket has nothing');
  assert.equal((await call(O.OWNER, 'GET', '/retail/stock/movements')).body.data.length, 0);
});

test('the movement ledger lists every kind of movement with its reference', { skip }, async () => {
  const rows = (await call(S.OWNER, 'GET', `/retail/stock/movements?product_id=${milk}`)).body.data;
  const kinds = new Set(rows.map((r) => r.transaction_type));
  for (const k of ['PURCHASE', 'SALE', 'RETURN']) assert.equal(kinds.has(k), true, k);
  assert.equal((await call(S.OWNER, 'GET', '/retail/stock/movements?type=WASTAGE')).body.data.length, 1);
});

/* ── counts ───────────────────────────────────────────────────────────────────────────────── */

let count;
test('a count is a record until applied: scanning adds up, nothing moves yet', { skip }, async () => {
  assert.equal((await call(S.OWNER, 'POST', '/retail/counts', { name: '  ' })).status, 400);
  count = (await call(S.OWNER, 'POST', '/retail/counts', { name: 'Aisle 3' })).body.data.count_id;
  const item = (id, extra) => call(S.OWNER, 'POST', `/retail/counts/${count}/items`, { items: [{ product_id: id, ...extra }] });
  assert.equal((await item(rice, { add: 1 })).status, 200);
  await item(rice, { add: 1 }); await item(rice, { add: 1 });          // three scans of rice: counted 3
  const r = (await item(soap, { counted: 3 })).body.data[0];
  assert.deepEqual([r.system_qty, r.counted_qty, r.variance], [3, 3, 0]);
  assert.equal((await item(rice, { add: 'x' })).status, 400);
  assert.equal((await item(rice, { counted: -1 })).status, 400);
  assert.equal((await item(rice, { counted: 1, add: 1 })).status, 400, 'either counted or add');
  assert.equal(await stockOf(rice), 35, 'counting moved nothing');

  const d = (await call(S.OWNER, 'GET', `/retail/counts/${count}`)).body.data;
  assert.equal(d.totals.lines, 2); assert.equal(d.totals.variance_lines, 1); assert.equal(d.totals.short_units, 32);
  assert.equal(d.items.find((i) => i.name === 'Basmati Rice 1kg').variance, -32);
  assert.equal(d.totals.net_value, -32 * 60, 'valued at cost');
  assert.equal(d.uncounted >= 2, true, 'products nobody counted are reported');
});

test('a sale rung up while counting is not mistaken for a shortage', { skip }, async () => {
  assert.equal((await sell(rice, 2)).status, 201);                           // system 35 -> 33 after rice was counted
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${count}/items`, { items: [{ product_id: rice, counted: 33 }] })).status, 200);
  const r = (await call(S.OWNER, 'GET', `/retail/counts/${count}`)).body.data.items.find((i) => i.name === 'Basmati Rice 1kg');
  assert.equal(r.system_qty, 33); assert.equal(r.variance, 0);
  await call(S.OWNER, 'POST', `/retail/counts/${count}/items`, { items: [{ product_id: rice, counted: 30 }] });   // really 3 short
  const sold = await sell(rice, 1);                                          // a sale after the count line: system 32
  assert.equal(sold.status, 201);
});

test('applying a count writes COUNT movements for the differences only, once', { skip }, async () => {
  const before = await stockOf(rice);                                        // 32
  assert.equal(before, 32);
  const done = await call(S.OWNER, 'POST', `/retail/counts/${count}/apply`, {});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.status, 'APPLIED'); assert.equal(done.body.data.lines_adjusted, 1);
  assert.equal(await stockOf(rice), 29, 'the 3 short were removed; the later sale is kept');
  const moves = (await pool.query(`SELECT product_id, quantity::float AS q, reference_type FROM inventory_transactions WHERE transaction_type = 'COUNT'`)).rows;
  assert.deepEqual(moves, [{ product_id: rice, q: -3, reference_type: 'stock_count' }]);
  assert.equal((await pool.query(`SELECT current_stock::float AS c FROM products WHERE product_id = $1`, [rice])).rows[0].c, 29, 'outlet and business totals agree');
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${count}/apply`, {})).status, 409, 'not twice');
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${count}/items`, { items: [{ product_id: rice, add: 1 }] })).status, 409, 'a closed count takes no more lines');
});

test('"zero the rest" is explicit; a cancelled count changes nothing; counts are private to the business', { skip }, async () => {
  const c2 = (await call(S.OWNER, 'POST', '/retail/counts', { name: 'Full' })).body.data.count_id;
  await call(S.OWNER, 'POST', `/retail/counts/${c2}/items`, { items: [{ product_id: soap, counted: 3 }] });
  assert.equal((await call(O.OWNER, 'GET', `/retail/counts/${c2}`)).status, 404);
  assert.equal((await call(O.OWNER, 'POST', `/retail/counts/${c2}/apply`, {})).status, 404);
  assert.equal((await call(S.CASHIER, 'POST', '/retail/counts', { name: 'x' })).status, 403);
  const stockBefore = await stockOf(rice);
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${c2}/apply`, {})).status, 200);
  assert.equal(await stockOf(rice), stockBefore, 'uncounted products are left alone by default');

  const c3 = (await call(S.OWNER, 'POST', '/retail/counts', { name: 'Zero' })).body.data.count_id;
  await call(S.OWNER, 'POST', `/retail/counts/${c3}/items`, { items: [{ product_id: soap, counted: 3 }] });
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${c3}/apply`, { zero_uncounted: true })).status, 200);
  assert.equal(await stockOf(rice), 0, 'with the box ticked, what nobody counted is zeroed');
  assert.equal(await stockOf(soap), 3);

  const c4 = (await call(S.OWNER, 'POST', '/retail/counts', { name: 'Never mind' })).body.data.count_id;
  await call(S.OWNER, 'POST', `/retail/counts/${c4}/items`, { items: [{ product_id: soap, counted: 99 }] });
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${c4}/cancel`, {})).status, 200);
  assert.equal(await stockOf(soap), 3);
  const list = (await call(S.OWNER, 'GET', '/retail/counts')).body.data;
  assert.deepEqual(list.map((c) => c.status).sort(), ['APPLIED', 'APPLIED', 'APPLIED', 'CANCELLED']);
});

test('a count can be limited to one category', { skip }, async () => {
  const cat = (await call(S.OWNER, 'POST', '/categories', { name: 'Dairy' })).body.data.category_id;
  const curd = await product({ name: 'Curd 400g', category_id: cat });
  await receive([{ product_id: curd, quantity: 10, unit_cost: 25 }]);
  const c = (await call(S.OWNER, 'POST', '/retail/counts', { name: 'Dairy shelf', category_id: cat })).body.data;
  assert.equal(c.scope, 'CATEGORY');
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${c.count_id}/items`, { items: [{ product_id: soap, add: 1 }] })).status, 400, 'soap is not dairy');
  assert.equal((await call(S.OWNER, 'POST', `/retail/counts/${c.count_id}/items`, { items: [{ product_id: curd, counted: 9 }] })).status, 200);
});

/* ── imports ──────────────────────────────────────────────────────────────────────────────── */

const importRows = (kind, rows, mode, apply = false, b = S) => call(b.OWNER, 'POST', `/retail/import/${kind}`, { rows, mode, apply });

test('a product import is checked row by row first, and nothing is written when any row is bad', { skip }, async () => {
  const rows = [
    { Name: 'Tata Salt 1kg', Barcode: '8904043901015', MRP: '28', 'Selling Price': '27', 'Purchase Price': '22', 'Tax Rate': '0', Category: 'Staples', 'Opening Stock': '20' },
    { Name: 'X', Barcode: '8900000000001', 'Selling Price': '10' },                                       // name too short
    { Name: 'Overpriced', MRP: '10', 'Selling Price': '12' },                                              // above MRP
    { Name: 'Rice again', Barcode: '8906001000019', 'Selling Price': '70' },                              // already ours
    { Name: 'Dup A', Barcode: '8900000000007', 'Selling Price': '5' }, { Name: 'Dup B', Barcode: '8900000000007', 'Selling Price': '5' },
    { Name: 'Curd Cup', 'Selling Price': '30', 'Track Expiry': 'yes', 'Opening Stock': '5' },            // tracks expiry, stock but no date
    { Name: 'Bad Date', 'Selling Price': '5', 'Expiry Date': '31/02/2026' }
  ];
  const dry = await importRows('products', rows, 'create');
  assert.equal(dry.status, 200);
  const e = dry.body.data;
  assert.equal(e.total_errors, 6); assert.equal(e.applied, false);
  assert.deepEqual(e.errors.map((x) => x.row), [3, 4, 5, 7, 8, 9]);
  assert.match(e.errors[0].message, /too short/); assert.match(e.errors[1].message, /above the MRP/); assert.match(e.errors[2].message, /Already in your catalogue/);
  assert.match(e.errors[3].message, /also on row 6/); assert.match(e.errors[4].message, /expiry date/); assert.match(e.errors[5].message, /real date|not a date/);
  const forced = await importRows('products', rows, 'create', true);
  assert.equal(forced.status, 422);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE name = 'Tata Salt 1kg'`)).rows[0].n, 0, 'nothing was imported');
});

test('a good product import creates products with SKUs, categories, barcodes and opening stock', { skip }, async () => {
  const rows = [
    { name: 'Tata Salt 1kg', barcode: '8904043901015.0', mrp: '₹28', selling_price: '27', purchase_price: '22', gst: '0', category: 'Staples', opening_stock: '20', aliases: 'namak | salt tata' },
    { name: 'Curd Cup 200g', barcode: '8901262020012', mrp: '30', 'Track Expiry': 'yes', 'Opening Stock': '5', 'Expiry Date': dayFromNow(9).split('-').reverse().join('/'), 'Batch No': 'C1' }
  ];
  const res = await importRows('products', rows, 'create', true);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.data.created, res.body.data.applied], [2, true]);
  const salt = (await pool.query(`SELECT p.*, c.name AS cat FROM products p JOIN categories c ON c.category_id = p.category_id WHERE p.name = 'Tata Salt 1kg'`)).rows[0];
  assert.match(salt.sku, /^STAP-\d{5}$/); assert.equal(salt.barcode, '8904043901015'); assert.equal(Number(salt.mrp_paise), 2800); assert.equal(Number(salt.selling_price_paise), 2700);
  assert.equal(await stockOf(salt.product_id), 20);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM product_aliases WHERE product_id = $1`, [salt.product_id])).rows[0].n, 2);
  assert.equal((await pool.query(`SELECT transaction_type FROM inventory_transactions WHERE product_id = $1`, [salt.product_id])).rows[0].transaction_type, 'OPENING');
  const curd = (await pool.query(`SELECT * FROM products WHERE name = 'Curd Cup 200g'`)).rows[0];
  assert.equal(curd.track_expiry, true); assert.equal(Number(curd.selling_price_paise), 3000, 'no selling price: the MRP is used');
  assert.deepEqual(await batches(curd.product_id), [{ batch_no: 'C1', qty: 5, expiry: dayFromNow(9) }]);
  assert.equal((await call(S.OWNER, 'GET', '/products?search=namak')).body.data.map((p) => p.name).join(), 'Tata Salt 1kg', 'the alias finds it');
});

test('an upsert updates only the columns that are filled in, and will not take another product’s barcode', { skip }, async () => {
  const rows = [{ barcode: '8906001000019', name: 'Basmati Rice 1kg', 'Selling Price': '65' }];
  const dry = await importRows('products', rows, 'upsert');
  assert.deepEqual([dry.body.data.to_update, dry.body.data.to_create, dry.body.data.total_errors], [1, 0, 0]);
  assert.equal((await importRows('products', rows, 'upsert', true)).status, 200);
  const p = (await pool.query(`SELECT selling_price_paise, purchase_price_paise FROM products WHERE product_id = $1`, [rice])).rows[0];
  assert.deepEqual([Number(p.selling_price_paise), Number(p.purchase_price_paise)], [6500, 6000], 'the cost was left alone');
  const clash = await importRows('products', [{ sku: (await pool.query(`SELECT sku FROM products WHERE product_id = $1`, [soap])).rows[0].sku, barcode: '8906001000019', 'Selling Price': '5', name: 'Mixed up' }], 'upsert');
  assert.equal(clash.body.data.total_errors, 1); assert.match(clash.body.data.errors[0].message, /different products/);
});

test('a stock import sets what is on the shelf, or adds a delivery, and refuses unknown items', { skip }, async () => {
  const before = await stockOf(soap);                                    // 3
  const set = [{ Barcode: '8901030000010', Quantity: '10' }];
  assert.equal((await importRows('stock', set, 'set', true)).status, 200);
  assert.equal(await stockOf(soap), 10);
  assert.equal((await importRows('stock', [{ SKU: (await pool.query(`SELECT sku FROM products WHERE product_id = $1`, [soap])).rows[0].sku, Quantity: '5' }], 'add', true)).status, 200);
  assert.equal(await stockOf(soap), 15); assert.equal(before, 3);
  const bad = (await importRows('stock', [{ Barcode: '0000000000000', Quantity: '1' }, { Barcode: '8901262010011', Quantity: '4' }, { Barcode: '8901030000010', Quantity: '-2' }], 'add')).body.data;
  assert.deepEqual(bad.errors.map((e) => e.row), [2, 3, 4]);
  assert.match(bad.errors[0].message, /No product/); assert.match(bad.errors[1].message, /expiry date/);
  const delivery = await importRows('stock', [{ Barcode: '8901262010011', Quantity: '4', 'Expiry Date': dayFromNow(45) }], 'add', true);
  assert.equal(delivery.status, 200);
  assert.equal((await batches(milk)).some((b) => b.expiry === dayFromNow(45) && b.qty === 4), true, 'an added delivery of an expiry product makes a batch');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE reference_type = 'import'`)).rows[0].n >= 4, true);
});

test('imports are retail-only and limited to people who may manage stock', { skip }, async () => {
  assert.equal((await importRows('products', [{ Name: 'Pizza', 'Selling Price': '99' }], 'create', false, R)).status, 404);
  assert.equal((await call(S.CASHIER, 'POST', '/retail/import/stock', { rows: [{ Barcode: '1', Quantity: '1' }] })).status, 403);
  assert.equal((await importRows('products', [], 'create')).status, 400, 'an empty file is refused');
});
