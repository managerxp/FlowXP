/*
 * Van stock: warehouse → vehicle → retailer → sale → collection → reconciliation.
 * The rule under test everywhere: stock is never deducted twice and never invented — warehouse + vans always equals
 * what came in minus what was sold, written off or found missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addCustomer, addProduct, dayFromNow, invoiceRow, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const vehicles = (await import('../src/controllers/distributorVehicles.controller.js')).default;
const schemes = (await import('../src/controllers/distributorSchemes.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const money = (await import('../src/controllers/wholesaleMoney.controller.js')).default;

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const dist = (tag, o = {}) => makeWholesaler(pool, tag, { type: 'DISTRIBUTOR', ...o });
const van = async (w, no = 'TS09UB1234', extra = {}) => { const r = await w.call(vehicles.create, { body: { vehicle_no: no, driver_name: 'Mahesh', ...extra } }); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
const onVans = async (productId) => Number((await pool.query(`SELECT COALESCE(SUM(qty_base), 0) AS q FROM dist_vehicle_stock WHERE product_id = $1`, [productId])).rows[0].q);
const total = async (w, productId) => (await stockOf(pool, w.branchId, productId)).on_hand + await onVans(productId);
const load = (w, v, items) => w.call(vehicles.load, { params: { id: v.vehicle_id }, body: { items } });
const sell = (w, v, body, tenant) => w.call(vehicles.sell, { params: { id: v.vehicle_id }, body }, tenant);

t('loading a van moves stock from the warehouse to the vehicle, in the unit it is loaded in', async () => {
  const w = await dist('v1');
  const p = await addProduct(pool, w, { name: 'Biscuit', unit: 'pcs', price: 10, cost: 7, tax: 0, stock: 1000, units: [{ name: 'carton', factor: 100 }] });
  const v = await van(w);
  const r = await load(w, v, [{ product_id: p, unit_name: 'carton', quantity: 3 }]);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 700, reserved: 0 });
  assert.equal(await onVans(p), 300);
  assert.equal(r.body.data.stock[0].qty, 300); assert.equal(r.body.data.stock[0].value, 2100); assert.equal(r.body.data.items, 1);
  const ledger = (await pool.query(`SELECT transaction_type, quantity, reference_type FROM inventory_transactions WHERE product_id = $1 ORDER BY txn_id DESC LIMIT 1`, [p])).rows[0];
  assert.deepEqual({ ...ledger, quantity: Number(ledger.quantity) }, { transaction_type: 'TRANSFER', quantity: -300, reference_type: 'van_load' });
  assert.equal(await total(w, p), 1000, 'nothing created or lost');
  // stock promised to orders cannot be loaded
  const c = await addCustomer(pool, w, { name: 'R' });
  const o = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 650 }] } })).body.data;
  await w.call(orders.confirm, { params: { id: o.order_id }, body: {} });
  const over = await load(w, v, [{ product_id: p, quantity: 100 }]);
  assert.equal(over.code, 409); assert.match(over.body.message, /Only 50 pcs .* free to load/);
  assert.equal((await load(w, v, [{ product_id: p, quantity: 50 }])).code, 200);
  assert.equal((await load(w, v, [])).code, 400);
  assert.equal((await load(w, v, [{ product_id: p, unit_name: 'pallet', quantity: 1 }])).code, 400);
});

t('selling from the van invoices through the billing engine without touching the warehouse a second time', async () => {
  const w = await dist('v2');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 18, stock: 500 });
  const c = await addCustomer(pool, w, { name: 'Balaji Kirana', terms: 15 });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 200 }]);
  const warehouseAfterLoad = await stockOf(pool, w.branchId, p);
  const r = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 30 }], payment: { amount: 1000, method: 'CASH' } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.invoice_total, 3540);                                // 30 × 100 + 18% GST
  assert.deepEqual(await stockOf(pool, w.branchId, p), warehouseAfterLoad, 'the warehouse was not charged for the van sale');
  assert.equal(await onVans(p), 170, 'the van was');
  assert.equal(await total(w, p), 500 - 30, 'conservation: 30 sold, nothing else moved');
  const inv = await invoiceRow(pool, r.body.data.invoice_id);
  assert.equal(Number(inv.total_paise), 354000); assert.equal(Number(inv.amount_paid_paise), 100000); assert.equal(Number(inv.balance_due_paise), 254000); assert.equal(inv.payment_status, 'PARTIAL');
  // there is no SALE row for the warehouse — the sale is on the vehicle ledger
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM inventory_transactions WHERE product_id = $1 AND transaction_type = 'SALE'`, [p])).rows[0].n), 0);
  const moves = (await pool.query(`SELECT kind, qty_base, ref_type, ref_id FROM dist_vehicle_moves WHERE vehicle_id = $1 ORDER BY move_id`, [v.vehicle_id])).rows;
  assert.deepEqual(moves.map((m) => [m.kind, Number(m.qty_base)]), [['LOAD', 200], ['SALE', -30]]); assert.equal(moves[1].ref_id, r.body.data.invoice_id);
  // the sale leaves an order behind, so it counts as a secondary sale with its rep and territory
  const order = (await pool.query(`SELECT status, source, vehicle_id, total_paise FROM wholesale_sales_orders WHERE order_id = $1`, [r.body.data.order_id])).rows[0];
  assert.deepEqual({ ...order, total_paise: Number(order.total_paise) }, { status: 'DELIVERED', source: 'VAN', vehicle_id: v.vehicle_id, total_paise: 354000 });
  const meta = (await pool.query(`SELECT kind, due_date, order_id FROM wholesale_invoice_meta WHERE invoice_id = $1`, [r.body.data.invoice_id])).rows[0];
  assert.equal(meta.order_id, r.body.data.order_id); assert.ok(meta.due_date);
  // the balance is collected later against the invoice
  const rc = await w.call(money.create, { body: { customer_id: c, amount: 2540, method: 'UPI', reference: 'UPI123' } });
  assert.equal(rc.code, 201);
  assert.equal(Number((await invoiceRow(pool, r.body.data.invoice_id)).balance_due_paise), 0);
});

t('a van cannot sell what it does not carry, and a failed sale changes nothing', async () => {
  const w = await dist('v3');
  const a = await addProduct(pool, w, { name: 'A', price: 10, tax: 0, stock: 100 }); const b = await addProduct(pool, w, { name: 'B', price: 10, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'R' });
  const v = await van(w);
  await load(w, v, [{ product_id: a, quantity: 10 }]);
  const fail = await sell(w, v, { customer_id: c, lines: [{ product_id: a, quantity: 5 }, { product_id: b, quantity: 1 }] });
  assert.equal(fail.code, 409); assert.match(fail.body.message, /Only 0 of B is on this van/);
  assert.equal(await onVans(a), 10, 'the first line was not taken either');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM invoices WHERE business_id = $1`, [w.businessId])).rows[0].n), 0);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_sales_orders WHERE business_id = $1`, [w.businessId])).rows[0].n), 0);
  assert.equal((await sell(w, v, { customer_id: c, lines: [{ product_id: a, quantity: 11 }] })).code, 409);
  assert.equal((await sell(w, v, { customer_id: 999999, lines: [{ product_id: a, quantity: 1 }] })).code, 400);
});

t('van batches go soonest-expiry first and an expired batch on the van is not sold', async () => {
  const w = await dist('v4');
  const p = await addProduct(pool, w, { name: 'Milk', price: 50, cost: 30, tax: 0, expiry: true });
  await addBatch(pool, w, p, { batchNo: 'LATE', qty: 100, expiry: dayFromNow(60) });
  await addBatch(pool, w, p, { batchNo: 'SOON', qty: 40, expiry: dayFromNow(5) });
  const c = await addCustomer(pool, w, { name: 'R' });
  const v = await van(w);
  assert.equal((await load(w, v, [{ product_id: p, quantity: 60 }])).code, 200);
  const rows = (await pool.query(`SELECT b.batch_no, s.qty_base FROM dist_vehicle_stock s JOIN wholesale_batches b ON b.batch_id = s.batch_id WHERE s.vehicle_id = $1 ORDER BY b.batch_no`, [v.vehicle_id])).rows;
  assert.deepEqual(rows.map((r) => [r.batch_no, Number(r.qty_base)]), [['LATE', 20], ['SOON', 40]], 'the soon-to-expire batch is loaded first');
  const batchQty = async (no) => Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE business_id = $1 AND batch_no = $2`, [w.businessId, no])).rows[0].qty_on_hand);
  assert.equal(await batchQty('SOON'), 0); assert.equal(await batchQty('LATE'), 80);
  await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 25 }] });
  const after = (await pool.query(`SELECT b.batch_no, s.qty_base FROM dist_vehicle_stock s JOIN wholesale_batches b ON b.batch_id = s.batch_id WHERE s.vehicle_id = $1 ORDER BY b.batch_no`, [v.vehicle_id])).rows;
  assert.deepEqual(after.map((r) => [r.batch_no, Number(r.qty_base)]), [['LATE', 20], ['SOON', 15]], 'sold from the batch that expires first');
  // the batch expires while on the van: it can no longer be sold
  await pool.query(`UPDATE wholesale_batches SET expiry_date = $2 WHERE business_id = $1 AND batch_no = 'SOON'`, [w.businessId, dayFromNow(-1)]);
  const r = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 30 }] });
  assert.equal(r.code, 409, 'only 20 unexpired units are left');
  assert.equal((await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 20 }] })).code, 201);
});

t('schemes work from the van: the free goods come off the van as well', async () => {
  const w = await dist('v5');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 200 });
  const c = await addCustomer(pool, w, { name: 'R' });
  await w.call(schemes.create, { body: { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 } });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 60 }]);
  const r = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 50 }] });
  assert.equal(r.code, 201, JSON.stringify(r.body)); assert.equal(r.body.data.invoice_total, 5000, 'pays for 50');
  assert.equal(await onVans(p), 5, '50 sold + 5 free');
  const free = (await pool.query(`SELECT SUM(quantity) AS q FROM invoice_items WHERE invoice_id = $1 AND unit_price_paise = 0`, [r.body.data.invoice_id])).rows[0].q;
  assert.equal(Number(free), 5);
  // 6 more cannot be sold: 6 + 0 free = 6 > 5 on the van; 5 sells (no free line because below ten)
  assert.equal((await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 6 }] })).code, 409);
  assert.equal((await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 5 }] })).code, 201);
});

t('credit: a van sale on credit respects the credit limit, but cash paid on the spot counts', async () => {
  const w = await dist('v6');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 200 });
  const c = await addCustomer(pool, w, { name: 'Tight', limit: 1000 });
  await w.call(parties.updateSettings, { body: { credit_policy: 'BLOCK' } });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 100 }]);
  const blocked = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 20 }] });          // ₹2,000 on credit against ₹1,000
  assert.equal(blocked.code, 409); assert.equal(blocked.body.code, 'CREDIT_BLOCK');
  assert.equal(await onVans(p), 100, 'nothing left the van');
  assert.equal((await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 20 }], payment: { amount: 1500, method: 'CASH' } })).code, 201, '₹500 left on credit is within the limit');
  assert.equal((await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 20 }], payment: { amount: 'FULL', method: 'UPI', reference_number: 'U1' } })).code, 201, 'paid in full');
  assert.equal(await onVans(p), 60);
});

t('unsold stock goes back to the warehouse, in the batch it came from', async () => {
  const w = await dist('v7');
  const p = await addProduct(pool, w, { name: 'Milk', price: 50, cost: 30, tax: 0, expiry: true });
  await addBatch(pool, w, p, { batchNo: 'B1', qty: 100, expiry: dayFromNow(30) });
  const c = await addCustomer(pool, w, { name: 'R' });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 60 }]);
  await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 22 }] });
  const back = await w.call(vehicles.giveBack, { params: { id: v.vehicle_id }, body: { all: true } });
  assert.equal(back.code, 200, JSON.stringify(back.body)); assert.equal(back.body.data.items, 0);
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 78);
  assert.equal(Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE business_id = $1 AND batch_no = 'B1'`, [w.businessId])).rows[0].qty_on_hand), 78, 'the batch is whole again');
  assert.equal(await total(w, p), 78);
  assert.equal((await w.call(vehicles.giveBack, { params: { id: v.vehicle_id }, body: { all: true } })).code, 409, 'nothing left to return');
});

t('end-of-day reconciliation: a shortage is written off, a surplus is booked, the rest returns, and the books balance', async () => {
  const w = await dist('v8');
  const a = await addProduct(pool, w, { name: 'A', price: 100, cost: 60, tax: 0, stock: 500 }); const b = await addProduct(pool, w, { name: 'B', price: 50, cost: 20, tax: 0, stock: 500 });
  const c = await addCustomer(pool, w, { name: 'R' });
  const v = await van(w);
  await load(w, v, [{ product_id: a, quantity: 100 }, { product_id: b, quantity: 100 }]);
  await sell(w, v, { customer_id: c, lines: [{ product_id: a, quantity: 40 }, { product_id: b, quantity: 10 }] });
  // the van should hold A 60, B 90. The driver counts A 57 (3 missing) and B 91 (1 extra)
  const stock = (await w.call(vehicles.get, { params: { id: v.vehicle_id } })).body.data.stock;
  const row = (name) => stock.find((s) => s.product === name);
  const incomplete = await w.call(vehicles.reconcile, { params: { id: v.vehicle_id }, body: { counts: [{ stock_id: row('A').stock_id, counted: 57 }] } });
  assert.equal(incomplete.code, 400); assert.match(incomplete.body.message, /Count every item/);
  const rec = await w.call(vehicles.reconcile, { params: { id: v.vehicle_id }, body: { counts: [{ stock_id: row('A').stock_id, counted: 57 }, { stock_id: row('B').stock_id, counted: 91 }], return_to_warehouse: true, note: 'Friday' } });
  assert.equal(rec.code, 200, JSON.stringify(rec.body));
  assert.equal(rec.body.data.shortage, 180); assert.equal(rec.body.data.surplus, 20);          // 3 × ₹60 and 1 × ₹20
  assert.deepEqual(rec.body.data.lines.map((l) => [l.product, l.system, l.counted, l.variance]), [['A', 60, 57, -3], ['B', 90, 91, 1]]);
  assert.equal(await onVans(a), 0); assert.equal(await onVans(b), 0);
  // warehouse: A 500 − 100 + 57 back = 457 (40 sold, 3 lost);  B 500 − 100 + 91 back = 491 (10 sold, 1 found)
  assert.equal((await stockOf(pool, w.branchId, a)).on_hand, 457); assert.equal((await stockOf(pool, w.branchId, b)).on_hand, 491);
  // conservation: the ledger of the warehouse explains every unit
  for (const [id, expected] of [[a, 457], [b, 491]]) {
    const sum = Number((await pool.query(`SELECT COALESCE(SUM(quantity), 0) AS s FROM inventory_transactions WHERE product_id = $1`, [id])).rows[0].s);
    assert.equal(sum, expected - 500, `the stock ledger for product ${id} adds up to what is on the shelf`);
  }
  const wastage = (await pool.query(`SELECT quantity FROM inventory_transactions WHERE product_id = $1 AND transaction_type = 'WASTAGE'`, [a])).rows;
  assert.equal(wastage.length, 1); assert.equal(Number(wastage[0].quantity), -3);
  const history = (await w.call(vehicles.get, { params: { id: v.vehicle_id } })).body.data.reconciliations;
  assert.equal(history.length, 1); assert.equal(history[0].shortage, 180); assert.equal(history[0].returned, true);
  // a reconciliation that leaves the stock on the van keeps the counted quantity there
  await load(w, v, [{ product_id: a, quantity: 10 }]);
  const again = (await w.call(vehicles.get, { params: { id: v.vehicle_id } })).body.data.stock;
  const kept = await w.call(vehicles.reconcile, { params: { id: v.vehicle_id }, body: { counts: [{ stock_id: again[0].stock_id, counted: 9 }] } });
  assert.equal(kept.code, 200); assert.equal(kept.body.data.shortage, 60);
  assert.equal(await onVans(a), 9); assert.equal((await stockOf(pool, w.branchId, a)).on_hand, 447, '457 − 10 loaded; the missing unit is already written off');
});

t('vans and warehouses stay tenant-specific; a field rep sells only from the van assigned to them', async () => {
  const w = await dist('x1'); const other = await dist('x2');
  const p = await addProduct(pool, w, { name: 'Soap', price: 10, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'R' });
  const [uA, uB] = await Promise.all(['a', 'b'].map(async (x) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Rep ${x}`, `van-${x}-${w.tag}@t.test`])).rows[0].user_id));
  for (const u of [uA, uB]) await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'FIELD_SALES','ACTIVE')`, [w.businessId, u]);
  const ra = (await w.call(parties.createSalesperson, { body: { name: 'Rep A', user_id: uA } })).body.data; const rb = (await w.call(parties.createSalesperson, { body: { name: 'Rep B', user_id: uB } })).body.data;
  await pool.query(`UPDATE wholesale_customer_profiles SET salesperson_id = $2 WHERE customer_id = $1`, [c, ra.salesperson_id]);
  const vA = await van(w, 'TS09AA0001', { salesperson_id: ra.salesperson_id }); const vB = await van(w, 'TS09BB0002', { salesperson_id: rb.salesperson_id });
  await load(w, vA, [{ product_id: p, quantity: 20 }]); await load(w, vB, [{ product_id: p, quantity: 20 }]);
  const asA = w.tenantFor('FIELD_SALES', { userId: uA, pinned: true });
  assert.deepEqual((await w.call(vehicles.list, {}, asA)).body.data.map((x) => x.vehicle_no), ['TS09AA0001']);
  assert.equal((await sell(w, vB, { customer_id: c, lines: [{ product_id: p, quantity: 1 }] }, asA)).code, 404, 'not their van');
  assert.equal((await sell(w, vA, { customer_id: c, lines: [{ product_id: p, quantity: 1 }] }, asA)).code, 201);
  assert.equal((await w.call(vehicles.load, { params: { id: vA.vehicle_id }, body: { items: [{ product_id: p, quantity: 1 }] } }, asA)).code === 200, true, 'the handler itself does not gate; the route requires the vehicles permission');
  // another business sees nothing of these vans
  assert.equal((await other.call(vehicles.get, { params: { id: vA.vehicle_id } })).code, 404);
  assert.equal((await other.call(vehicles.list, {})).body.data.length, 0);
  assert.equal((await other.call(vehicles.sell, { params: { id: vA.vehicle_id }, body: { customer_id: c, lines: [{ product_id: p, quantity: 1 }] } })).code, 404);
  assert.equal((await other.call(vehicles.create, { body: { vehicle_no: 'TS09AA0001' } })).code, 201, 'vehicle numbers are unique per business, not globally');
  assert.equal((await w.call(vehicles.create, { body: { vehicle_no: 'ts09aa0001' } })).code, 409);
  const foreign = await addProduct(pool, other, { name: 'Theirs', price: 1, tax: 0, stock: 10 });
  assert.equal((await load(w, vA, [{ product_id: foreign, quantity: 1 }])).code, 400, 'cannot load another tenant’s product');
  assert.equal((await w.call(vehicles.create, { body: { vehicle_no: 'TS09CC0003', branch_id: other.branchId } })).code, 400, 'cannot home a van at another tenant’s warehouse');
});
