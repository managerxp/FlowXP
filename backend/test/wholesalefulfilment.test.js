/*
 * Wholesale fulfilment: pick → pack → dispatch (challan + invoice through the billing engine), partial shipments and
 * back-orders, batches (soonest expiry first, expired never sold), delivery tracking, transfers and adjustments.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addCustomer, addProduct, dayFromNow, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const ful = (await import('../src/controllers/wholesaleFulfilment.controller.js')).default;
const inv = (await import('../src/controllers/wholesaleInventory.controller.js')).default;

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const placeConfirmed = async (w, body, tenant) => {
  const o = (await w.call(orders.create, { body }, tenant)).body.data;
  const c = await w.call(orders.confirm, { params: { id: o.order_id } }, tenant);
  assert.equal(c.code, 200, JSON.stringify(c.body));
  return c.body.data;
};
const pickPackDispatch = async (w, orderId, dispatch = {}, tenant) => {
  const pl = await w.call(ful.createPick, { params: { id: orderId }, body: {} }, tenant);
  assert.equal(pl.code, 201, JSON.stringify(pl.body));
  const id = pl.body.data.pick_id;
  assert.equal((await w.call(ful.startPick, { params: { id } }, tenant)).code, 200);
  const picked = await w.call(ful.recordPick, { params: { id }, body: { all: true } }, tenant);
  assert.equal(picked.code, 200, JSON.stringify(picked.body));
  const packed = await w.call(ful.pack, { params: { id }, body: {} }, tenant);
  assert.equal(packed.code, 200, JSON.stringify(packed.body));
  const d = await w.call(ful.dispatch, { params: { id }, body: dispatch }, tenant);
  return { pickId: id, dispatch: d };
};

t('order → pick → pack → dispatch: invoice via the billing engine, stock leaves, reservation released', async () => {
  const w = await makeWholesaler(pool, 'f1');
  const p = await addProduct(pool, w, { name: 'Biscuit', price: 10, tax: 18, stock: 1000, units: [{ name: 'carton', factor: 288 }] });
  const c = await addCustomer(pool, w, { name: 'Sharma', terms: 30 });
  const o = await placeConfirmed(w, { customer_id: c, lines: [{ product_id: p, unit_name: 'carton', quantity: 2 }], shipping_charge: 100, shipping_tax_rate: 18 });
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 1000, reserved: 576 });

  const { dispatch } = await pickPackDispatch(w, o.order_id, { driver_name: 'Raju', vehicle_no: 'ts09ab1234', payment: { amount: 1000, method: 'UPI' } });
  assert.equal(dispatch.code, 201, JSON.stringify(dispatch.body));
  const d = dispatch.body.data;
  assert.equal(d.invoice_total, o.total);                        // the invoice equals the order
  assert.equal(d.order_status, 'DISPATCHED');
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 424, reserved: 0 });   // 2 cartons = 576 pcs left the shelf

  const invoice = (await pool.query(`SELECT i.*, m.due_date, m.kind, m.order_id FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id WHERE i.invoice_id = $1`, [d.invoice_id])).rows[0];
  assert.equal(Number(invoice.total_paise), Math.round(o.total * 100));
  assert.equal(Number(invoice.amount_paid_paise), 100000);
  assert.equal(Number(invoice.balance_due_paise), Math.round(o.total * 100) - 100000);
  assert.equal(invoice.payment_status, 'PARTIAL');
  assert.equal(invoice.order_id, o.order_id);
  const items = (await pool.query(`SELECT description, quantity, unit_name, unit_factor FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [d.invoice_id])).rows;
  assert.equal(Number(items[0].quantity), 2); assert.equal(items[0].unit_name, 'carton'); assert.equal(Number(items[0].unit_factor), 288);
  assert.equal(items[1].description, 'Shipping / freight');

  // delivery: assigned at dispatch; delivered only with who received it
  const del = (await pool.query(`SELECT * FROM wholesale_deliveries WHERE delivery_id = $1`, [d.delivery_id])).rows[0];
  assert.equal(del.status, 'ASSIGNED'); assert.equal(del.vehicle_no, 'TS09AB1234');
  assert.equal((await w.call(ful.setDeliveryStatus, { params: { id: d.delivery_id }, body: { status: 'DELIVERED', pod_received_by: 'X' } })).code, 409);   // not out yet
  await w.call(ful.setDeliveryStatus, { params: { id: d.delivery_id }, body: { status: 'OUT_FOR_DELIVERY' } });
  assert.equal((await w.call(ful.setDeliveryStatus, { params: { id: d.delivery_id }, body: { status: 'DELIVERED' } })).code, 400);   // who received it?
  const done = await w.call(ful.setDeliveryStatus, { params: { id: d.delivery_id }, body: { status: 'DELIVERED', pod_received_by: 'Mr Sharma', pod_note: 'All 2 cartons' } });
  assert.equal(done.body.data.order_status, 'DELIVERED');

  const ch = await w.call(ful.challan, { params: { id: d.delivery_id } });
  assert.equal(ch.body.data.lines[0].quantity, 2);
  assert.equal(ch.body.data.vehicle_no, 'TS09AB1234');
});

t('partial fulfilment: ship what is there, the rest stays a back-order; shipping and the order discount are not charged twice', async () => {
  const w = await makeWholesaler(pool, 'f2');
  const p = await addProduct(pool, w, { name: 'Oil', price: 100, tax: 0, stock: 30 });
  const c = await addCustomer(pool, w, {});
  const o = await placeConfirmed(w, { customer_id: c, lines: [{ product_id: p, quantity: 50 }], shipping_charge: 200, discount: 500 });
  assert.equal(o.total, 4700);
  const first = await pickPackDispatch(w, o.order_id);
  assert.equal(first.dispatch.code, 201, JSON.stringify(first.dispatch.body));
  assert.equal(first.dispatch.body.data.order_status, 'PARTIALLY_FULFILLED');
  const inv1 = Number(first.dispatch.body.data.invoice_total);
  assert.equal(inv1, 3000 + 200 - 300);                       // 30 × 100 + shipping − 30/50 of the ₹500 discount

  // stock arrives; the back-order is reserved, picked and shipped
  await pool.query(`UPDATE branch_stock SET quantity = quantity + 40 WHERE branch_id = $1 AND product_id = $2`, [w.branchId, p]);
  await w.call(orders.reserve, { params: { id: o.order_id } });
  const second = await pickPackDispatch(w, o.order_id);
  assert.equal(Number(second.dispatch.body.data.invoice_total), 2000 - 200);                // the rest; no shipping; the remaining discount
  assert.equal(inv1 + Number(second.dispatch.body.data.invoice_total), o.total);              // the two invoices add up to the order
  assert.equal(second.dispatch.body.data.order_status, 'DISPATCHED');
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 20, reserved: 0 });   // 30 + 40 arrived − 50 shipped
});

t('a short pick returns the difference to the order; closing the rest ends the order without a back-order', async () => {
  const w = await makeWholesaler(pool, 'f3');
  const p = await addProduct(pool, w, { name: 'X', price: 10, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, {});
  const o = await placeConfirmed(w, { customer_id: c, lines: [{ product_id: p, quantity: 40 }] });
  const pl = (await w.call(ful.createPick, { params: { id: o.order_id }, body: {} })).body.data;
  const again = await w.call(ful.createPick, { params: { id: o.order_id }, body: {} });
  assert.equal(again.code, 409);                              // everything reserved is already on a pick list
  await w.call(ful.recordPick, { params: { id: pl.pick_id }, body: { items: [{ pick_item_id: pl.items[0].pick_item_id, picked_base: 25 }] } });
  const fresh = (await w.call(orders.get, { params: { id: o.order_id } })).body.data;
  assert.equal(fresh.items[0].picked, 25);
  await w.call(ful.pack, { params: { id: pl.pick_id }, body: {} });
  const d = await w.call(ful.dispatch, { params: { id: pl.pick_id }, body: {} });
  assert.equal(d.body.data.order_status, 'PARTIALLY_FULFILLED');
  const closed = await w.call(orders.close, { params: { id: o.order_id }, body: { reason: 'Customer will reorder' } });
  assert.equal(closed.code, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.data.status, 'DISPATCHED');
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 75, reserved: 0 });
});

t('batches: soonest expiry first, expired batches are never picked or counted as available', async () => {
  const w = await makeWholesaler(pool, 'f4');
  const p = await addProduct(pool, w, { name: 'Milk', price: 50, tax: 0, expiry: true });
  await addBatch(pool, w, p, { batchNo: 'OLD', qty: 20, expiry: dayFromNow(-5) });       // expired
  await addBatch(pool, w, p, { batchNo: 'B2', qty: 30, expiry: dayFromNow(60) });
  await addBatch(pool, w, p, { batchNo: 'B1', qty: 30, expiry: dayFromNow(10) });
  const c = await addCustomer(pool, w, {});
  const view = await w.call(inv.productStock, { params: { id: p } });
  assert.equal(view.body.data.warehouses[0].available, 60);                                // 80 on hand − 20 expired
  const o = await placeConfirmed(w, { customer_id: c, lines: [{ product_id: p, quantity: 45 }] });
  const pl = (await w.call(ful.createPick, { params: { id: o.order_id }, body: {} })).body.data;
  assert.deepEqual(pl.items[0].batches.map((b) => [b.batch_no, b.qty_base]), [['B1', 30], ['B2', 15]]);
  await w.call(ful.recordPick, { params: { id: pl.pick_id }, body: { all: true } });
  await w.call(ful.pack, { params: { id: pl.pick_id }, body: {} });
  const d = await w.call(ful.dispatch, { params: { id: pl.pick_id }, body: {} });
  assert.equal(d.code, 201, JSON.stringify(d.body));
  const left = Object.fromEntries((await pool.query(`SELECT batch_no, qty_on_hand FROM wholesale_batches WHERE product_id = $1`, [p])).rows.map((r) => [r.batch_no, Number(r.qty_on_hand)]));
  assert.deepEqual(left, { OLD: 20, B1: 0, B2: 15 });
  // the challan names the batches that went out
  const ch = await w.call(ful.challan, { params: { id: d.body.data.delivery_id } });
  assert.match(ch.body.data.lines[0].batches, /B1/);
  // an order for more than the sellable stock is a back-order, never served from the expired batch
  const o2 = await placeConfirmed(w, { customer_id: c, lines: [{ product_id: p, quantity: 40 }] });
  assert.equal(o2.items[0].reserved, 15);
});

t('transfers: in transit, received with damage, batches carried; a cancelled transfer comes back', async () => {
  const w = await makeWholesaler(pool, 'f5', { branches: 2 });
  const [a, b] = w.branchIds;
  const p = await addProduct(pool, w, { name: 'Soap', price: 20, tax: 0, expiry: true });
  await addBatch(pool, w, p, { batchNo: 'S1', qty: 100, expiry: dayFromNow(90), branchId: a });
  const made = await w.call(inv.createTransfer, { body: { from_branch_id: a, to_branch_id: b, items: [{ product_id: p, quantity: 60 }], dispatch: true } });
  assert.equal(made.code, 200, JSON.stringify(made.body));
  assert.equal(made.body.data.status, 'IN_TRANSIT');
  assert.equal((await stockOf(pool, a, p)).on_hand, 40);
  assert.equal((await stockOf(pool, b, p)).on_hand, 0);                                     // on the road
  const stock = await w.call(inv.levels, { query: { branch_id: String(b) } });
  assert.equal(stock.body.data.find((x) => x.product_id === p).in_transit, 60);

  const id = made.body.data.transfer_id;
  const rec = await w.call(inv.receiveTransfer, { params: { id }, body: { items: [{ item_id: made.body.data.items[0].item_id, received_base: 55, damaged_base: 3 }] } });
  assert.equal(rec.code, 200, JSON.stringify(rec.body));
  assert.equal(rec.body.data.items[0].short_base, 2);                                       // 2 lost in transit
  assert.equal((await stockOf(pool, b, p)).on_hand, 55);
  assert.equal(Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE branch_id = $1 AND product_id = $2`, [b, p])).rows[0].qty_on_hand), 55);
  assert.equal((await w.call(inv.damaged, {})).body.data[0].qty, 3);
  assert.equal((await w.call(inv.receiveTransfer, { params: { id }, body: {} })).code, 409);   // only once

  const second = await w.call(inv.createTransfer, { body: { from_branch_id: a, to_branch_id: b, items: [{ product_id: p, quantity: 10 }], dispatch: true } });
  const back = await w.call(inv.cancelTransfer, { params: { id: second.body.data.transfer_id } });
  assert.equal(back.body.data.status, 'CANCELLED');
  assert.equal((await stockOf(pool, a, p)).on_hand, 40);
  const tooMany = await w.call(inv.createTransfer, { body: { from_branch_id: a, to_branch_id: b, items: [{ product_id: p, quantity: 500 }], dispatch: true } });
  assert.equal(tooMany.code, 409);
});

t('adjustments: count, damage (held as damaged goods), reserved stock is protected', async () => {
  const w = await makeWholesaler(pool, 'f6');
  const p = await addProduct(pool, w, { name: 'Pen', price: 10, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, {});
  await placeConfirmed(w, { customer_id: c, lines: [{ product_id: p, quantity: 60 }] });
  const adj = (body) => w.call(inv.adjust, { body: { branch_id: w.branchId, product_id: p, ...body } });
  assert.equal((await adj({ mode: 'COUNT', quantity: 50, reason: 'Stock take' })).code, 409);          // 60 are reserved
  assert.equal((await adj({ mode: 'COUNT', quantity: 90, reason: 'Stock take' })).body.data.change, -10);
  assert.equal((await adj({ mode: 'REMOVE', quantity: 40, reason: 'Lost' })).code, 409);                 // only 30 free
  const dmg = await adj({ mode: 'DAMAGE', quantity: 5, reason: 'Water damage' });
  assert.equal(dmg.code, 200, JSON.stringify(dmg.body));
  assert.equal((await w.call(inv.damaged, {})).body.data[0].qty, 5);
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 85);
  assert.equal((await w.call(inv.writeOffDamaged, { body: { branch_id: w.branchId, product_id: p, quantity: 5 } })).code, 200);
  assert.equal((await w.call(inv.damaged, {})).body.data.length, 0);
  assert.equal((await adj({ mode: 'ADD', quantity: 10 })).code, 400);                                    // a reason is required
  const hist = await w.call(inv.movements, { query: { product_id: String(p) } });
  assert.ok(hist.body.data.length >= 2);
});

t('warehouse staff see pick lists but a delivery person sees only their own runs; another wholesaler sees nothing', async () => {
  const a = await makeWholesaler(pool, 'f7');
  const b = await makeWholesaler(pool, 'f7b');
  const p = await addProduct(pool, a, { name: 'X', price: 10, tax: 0, stock: 100 });
  const c = await addCustomer(pool, a, {});
  const o = await placeConfirmed(a, { customer_id: c, lines: [{ product_id: p, quantity: 10 }] });
  const { pickId, dispatch } = await pickPackDispatch(a, o.order_id, { driver_user_id: a.userId });
  assert.equal(dispatch.code, 201);
  for (const fn of [ful.getPick, ful.cancelPick, ful.dispatch]) assert.equal((await b.call(fn, { params: { id: pickId }, body: {} })).code, 404);
  assert.equal((await b.call(ful.getDelivery, { params: { id: dispatch.body.data.delivery_id } })).code, 404);
  assert.equal((await b.call(ful.createPick, { params: { id: o.order_id }, body: {} })).code, 404);
  assert.equal((await a.call(ful.listDeliveries, {}, a.tenantFor('DELIVERY'))).body.data.length, 1);    // theirs
  const other = a.tenantFor('DELIVERY', { userId: a.userId + 9999 });
  assert.equal((await a.call(ful.listDeliveries, {}, other)).body.data.length, 0);
  assert.equal((await a.call(ful.getDelivery, { params: { id: dispatch.body.data.delivery_id } }, other)).code, 404);
});
