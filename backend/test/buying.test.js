/*
 * Buying: supplier price lists, back-orders (deliveries in parts), debit notes to suppliers, stock requests between outlets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const po = await import('../src/controllers/purchaseOrders.controller.js');
const purchases = await import('../src/controllers/purchases.controller.js');
const prices = await import('../src/controllers/supplierPrices.controller.js');
const debit = await import('../src/controllers/debitNotes.controller.js');
const requests = await import('../src/controllers/transferRequests.controller.js');
const inventory = await import('../src/controllers/inventory.controller.js');
const reports = await import('../src/controllers/reports.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let A; let B;
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@buy.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled) VALUES ($1,$2,'RESTAURANT',TRUE) RETURNING business_id`, [label, user.user_id])).rows[0];
  const mk = async (name, primary = false) => (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,$2,$3) RETURNING branch_id`, [biz.business_id, name, primary])).rows[0].branch_id;
  const main = await mk('Main', true); const second = await mk('Second'); const third = await mk('Third');
  const tenantAt = (branchId, extra = {}) => ({ businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {}, ...extra });
  const call = async (fn, { at = main, tenant, ...extra } = {}) => {
    const res = fakeRes();
    await fn({ tenant: tenant ?? tenantAt(at), auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res);
    return res;
  };
  const product = async (name, { stock = 0, cost = 0 } = {}) => {
    const id = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, purchase_price_paise, track_inventory, current_stock) VALUES ($1,$2,10000,$3,TRUE,$4) RETURNING product_id`, [biz.business_id, name, cost, stock * 3])).rows[0].product_id;
    for (const b of [main, second, third]) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [b, id, stock]);
    return id;
  };
  const supplier = async (name) => (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,$2) RETURNING supplier_id`, [biz.business_id, name])).rows[0].supplier_id;
  const stockAt = async (branch, id) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branch, id])).rows[0].quantity);
  const poRow = async (id) => (await pool.query(`SELECT * FROM purchase_orders WHERE po_id = $1`, [id])).rows[0];
  return { biz: biz.business_id, main, second, third, tenantAt, call, product, supplier, stockAt, poRow };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.oil = await A.product('Oil', { stock: 20, cost: 9000 });
  A.rice = await A.product('Rice', { stock: 50, cost: 5000 });
  A.s1 = await A.supplier('Cheap Traders'); A.s2 = await A.supplier('Pricey Co');
  B.item = await B.product('Salt'); B.sup = await B.supplier('Other');
});

/* ── supplier price lists ───────────────────────────────────────────────── */

test('a supplier price list is validated, listed and ranked per product', { skip }, async () => {
  const set = (id, list, who = A) => who.call(prices.setPrices, { params: { id }, body: { prices: list } });
  assert.equal((await set(A.s1, [])).code, 400);
  assert.equal((await set(A.s1, [{ product_id: A.oil, price: -1 }])).code, 400);
  assert.equal((await set(A.s1, [{ product_id: A.oil, price: 90 }, { product_id: A.oil, price: 91 }])).code, 400);   // twice
  assert.equal((await set(A.s1, [{ product_id: B.item, price: 5 }])).code, 404);                                      // another business's product
  assert.equal((await set(A.s1, [{ product_id: A.oil, price: 5 }], B)).code, 404);                                    // another business's supplier

  const ok = await set(A.s1, [{ product_id: A.oil, price: 85, min_qty: 5, lead_time_days: 2 }, { product_id: A.rice, price: 48 }]);
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.map((p) => [p.name, p.price]), [['Oil', 85], ['Rice', 48]]);
  await set(A.s2, [{ product_id: A.oil, price: 95 }]);
  await set(A.s1, [{ product_id: A.oil, price: 84 }]);                                                                // an update, not a duplicate
  assert.equal((await A.call(prices.forSupplier, { params: { id: A.s1 } })).body.data.find((p) => p.name === 'Oil').price, 84);

  const who = (await A.call(prices.forProduct, { params: { id: A.oil } })).body.data;
  assert.deepEqual(who.map((s) => [s.name, s.price, s.cheapest]), [['Cheap Traders', 84, true], ['Pricey Co', 95, false]]);
  assert.equal((await A.call(prices.removePrice, { params: { id: A.s2, productId: A.oil } })).code, 200);
  assert.equal((await A.call(prices.removePrice, { params: { id: A.s2, productId: A.oil } })).code, 404);
});

test('a purchase order line with no price takes the supplier list, else the last price paid', { skip }, async () => {
  const draft = await A.call(po.createDraft, { body: { supplier_id: A.s1, items: [
    { product_id: A.oil, quantity: 2 },                                // on the list: 84
    { product_id: A.rice, quantity: 1, unit_cost: 60 },                // an explicit price wins over the list (48)
    { description: 'Custom', quantity: 1, unit_cost: 10 }
  ] } });
  assert.equal(draft.code, 201, JSON.stringify(draft.body));
  const detail = (await A.call(purchases.get, { params: { id: draft.body.data.po_id } })).body.data;
  assert.deepEqual(detail.items.map((i) => i.unit_cost), [84, 60, 10]);

  const other = await A.call(po.createDraft, { body: { supplier_id: A.s2, items: [{ product_id: A.oil, quantity: 1 }] } });
  assert.equal((await A.call(purchases.get, { params: { id: other.body.data.po_id } })).body.data.items[0].unit_cost, 90);   // Pricey Co has no list price for oil now: last paid (Rs 90)
});

/* ── back-orders ────────────────────────────────────────────────────────── */

const newPo = async (items, supplier = A.s1, at = A.main) => (await A.call(po.createDraft, { at, body: { supplier_id: supplier, items } })).body.data.po_id;

test('an order can arrive in parts: what is owed stays open and stock follows each delivery', { skip }, async () => {
  const id = await newPo([{ product_id: A.oil, quantity: 10, unit_cost: 100, tax_rate: 5 }, { product_id: A.rice, quantity: 4, unit_cost: 50, tax_rate: 0 }]);
  await A.call(po.send, { params: { id }, body: { email: false } });
  const lines = (await A.call(purchases.get, { params: { id } })).body.data.items;
  const oilLine = lines[0].item_id;
  const oilBefore = await A.stockAt(A.main, A.oil);

  const first = await A.call(po.receive, { params: { id }, body: { items: [{ item_id: oilLine, received_quantity: 6 }], backorder: true } });
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.status, 'PARTIAL');
  assert.deepEqual(first.body.data.back_order.map((b) => [b.description, b.outstanding]), [['Oil', 4]]);   // rice (unmentioned) came in full
  assert.equal(await A.stockAt(A.main, A.oil), oilBefore + 6);
  assert.equal(first.body.data.total, 6 * 100 * 1.05 + 4 * 50);                                          // only what has arrived is owed: 630 + 200

  // still open: it can't be edited or cancelled, but it can be paid
  assert.match((await A.call(po.cancel, { params: { id } })).body.message, /Part of this order has arrived/);
  assert.equal((await A.call(po.update, { params: { id }, body: { notes: 'x' } })).code, 409);
  const bo = (await A.call(po.backorders)).body.data;
  assert.equal(bo.length, 1);
  assert.deepEqual(bo[0].outstanding.map((o) => [o.description, o.ordered, o.received, o.owed]), [['Oil', 10, 6, 4]]);
  assert.equal((await A.call(purchases.addPayment, { params: { id }, body: { amount: 100 } })).code, 201);

  // the rest arrives, at a different price: each delivery is valued at its own price
  const second = await A.call(po.receive, { params: { id }, body: { items: [{ item_id: oilLine, received_quantity: 4, unit_cost: 110 }] } });
  assert.equal(second.body.data.status, 'RECEIVED');
  assert.equal(second.body.data.total, 630 + 200 + 4 * 110 * 1.05);
  assert.equal(second.body.data.amount_paid, 100);
  assert.equal(second.body.data.balance_due, 630 + 200 + 462 - 100);
  assert.equal(await A.stockAt(A.main, A.oil), oilBefore + 10);
  assert.deepEqual(second.body.data.back_order, []);
  assert.equal((await A.call(po.backorders)).body.data.length, 0);
  assert.equal((await A.call(po.receive, { params: { id }, body: {} })).code, 409);                       // already complete
});

test('without the back-order flag a short delivery is closed short, as before; a part-delivered order can be closed', { skip }, async () => {
  const id = await newPo([{ product_id: A.oil, quantity: 10, unit_cost: 100 }]);
  const item = (await A.call(purchases.get, { params: { id } })).body.data.items[0].item_id;
  const done = await A.call(po.receive, { params: { id }, body: { items: [{ item_id: item, received_quantity: 7 }] } });
  assert.equal(done.body.data.status, 'RECEIVED');
  assert.deepEqual(done.body.data.short_delivered, ['Oil']);

  const id2 = await newPo([{ product_id: A.oil, quantity: 10, unit_cost: 100 }]);
  const item2 = (await A.call(purchases.get, { params: { id: id2 } })).body.data.items[0].item_id;
  await A.call(po.receive, { params: { id: id2 }, body: { items: [{ item_id: item2, received_quantity: 3 }], backorder: true } });
  assert.equal((await A.call(po.closeShort, { params: { id: id2 } })).code, 200);
  assert.equal((await A.poRow(id2)).status, 'RECEIVED');
  assert.equal((await A.call(po.closeShort, { params: { id: id2 } })).code, 409);                          // not part-delivered any more
  assert.equal((await A.call(po.receive, { params: { id: await newPo([{ product_id: A.oil, quantity: 1, unit_cost: 1 }]) }, body: { items: [{ item_id: 999999, received_quantity: 1 }] } })).code, 400);
  assert.equal((await B.call(po.backorders)).body.data.length, 0);
});

test('a delivery billed above the supplier list is flagged', { skip }, async () => {
  const id = await newPo([{ product_id: A.oil, quantity: 5, unit_cost: 84 }]);            // Cheap Traders lists oil at 84
  const item = (await A.call(purchases.get, { params: { id } })).body.data.items[0].item_id;
  const r = await A.call(po.receive, { params: { id }, body: { items: [{ item_id: item, unit_cost: 92 }] } });
  assert.deepEqual(r.body.data.price_alerts.map((a) => [a.description, a.list_price, a.charged, a.extra_per_unit, a.quantity]), [['Oil', 84, 92, 8, 5]]);
  const fine = await newPo([{ product_id: A.oil, quantity: 5, unit_cost: 84 }]);
  const item2 = (await A.call(purchases.get, { params: { id: fine } })).body.data.items[0].item_id;
  assert.deepEqual((await A.call(po.receive, { params: { id: fine }, body: { items: [{ item_id: item2 }] } })).body.data.price_alerts, []);
});

/* ── debit notes ────────────────────────────────────────────────────────── */

const receivedPo = async (qty = 10, cost = 100, tax = 5, paid = 0, product = A.oil) => {
  const id = await newPo([{ product_id: product, quantity: qty, unit_cost: cost, tax_rate: tax }]);
  const r = await A.call(po.receive, { params: { id }, body: paid ? { payment: { amount: paid, method: 'CASH' } } : {} });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const item = (await A.call(purchases.get, { params: { id } })).body.data.items[0].item_id;
  return { id, item, total: r.body.data.total };
};
const note = (id, body, who = A) => who.call(debit.create, { params: { id }, body });

test('goods sent back: stock leaves, tax is reversed at the line rate and the payable falls', { skip }, async () => {
  const p = await receivedPo(10, 100, 5);                                  // 1050 owed
  const before = await A.stockAt(A.main, A.oil);
  assert.equal((await note(p.id, { kind: 'RETURN', items: [{ item_id: p.item, quantity: 3 }] })).code, 400);   // no reason
  assert.equal((await note(p.id, { kind: 'MAYBE', reason: 'x', items: [{ item_id: p.item, quantity: 3 }] })).code, 400);

  const dn = await note(p.id, { kind: 'RETURN', reason: 'Spoiled on arrival', items: [{ item_id: p.item, quantity: 3 }] });
  assert.equal(dn.code, 201, JSON.stringify(dn.body));
  assert.match(dn.body.data.dn_number, /^DN-\d{4}$/);
  assert.equal(dn.body.data.subtotal, 300);
  assert.equal(dn.body.data.tax, 15);
  assert.equal(dn.body.data.total, 315);
  assert.equal(dn.body.data.applied, 315);                                 // all of it comes off what we owed
  assert.equal(dn.body.data.credit, 0);
  assert.equal(await A.stockAt(A.main, A.oil), before - 3);
  const row = await A.poRow(p.id);
  assert.equal(Number(row.balance_due_paise), (1050 - 315) * 100);
  assert.equal(Number(row.debited_paise), 315 * 100);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE reference_type = 'debit_note' AND transaction_type = 'PURCHASE_RETURN' AND quantity < 0`)).rows[0].n >= 1, true);

  // only what is left can go back
  const opts = (await A.call(debit.options, { params: { id: p.id } })).body.data.items[0];
  assert.deepEqual([opts.received, opts.returned, opts.returnable], [10, 3, 7]);
  assert.equal((await note(p.id, { kind: 'RETURN', reason: 'more', items: [{ item_id: p.item, quantity: 8 }] })).code, 409);
  assert.equal((await note(p.id, { kind: 'RETURN', reason: 'rest', items: [{ item_id: p.item, quantity: 7 }] })).body.data.total, 735);
  assert.equal(Number((await A.poRow(p.id)).balance_due_paise), 0);
  assert.equal((await A.poRow(p.id)).payment_status, 'PAID');            // nothing left to pay
  assert.equal((await note(p.id, { kind: 'RETURN', reason: 'again', items: [{ item_id: p.item, quantity: 1 }] })).code, 409);
});

test('a return is refused when the stock is no longer there, and nothing changes', { skip }, async () => {
  const p = await receivedPo(4, 100, 0, 0, A.rice);
  await pool.query(`UPDATE branch_stock SET quantity = 1 WHERE branch_id = $1 AND product_id = $2`, [A.main, A.rice]);
  const refused = await note(p.id, { kind: 'RETURN', reason: 'wrong item', items: [{ item_id: p.item, quantity: 3 }] });
  assert.equal(refused.code, 409);
  assert.match(refused.body.message, /Only 1 of Rice/);
  assert.equal(Number((await A.poRow(p.id)).debited_paise), 0);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM debit_notes WHERE po_id = $1`, [p.id])).rows[0].n, 0);
});

test('a price correction reduces what is owed without touching stock; an already paid order becomes a credit', { skip }, async () => {
  const p = await receivedPo(10, 100, 5, 1050);                           // paid in full
  const before = await A.stockAt(A.main, A.oil);
  assert.equal((await note(p.id, { kind: 'PRICE', reason: 'Overcharged', items: [{ item_id: p.item, quantity: 10 }] })).code, 400);          // no per-unit amount
  assert.equal((await note(p.id, { kind: 'PRICE', reason: 'Overcharged', items: [{ item_id: p.item, quantity: 10, unit_cost: 150 }] })).code, 409);   // more than the price paid
  assert.equal((await note(p.id, { kind: 'PRICE', reason: 'Overcharged', items: [{ item_id: p.item, quantity: 11, unit_cost: 10 }] })).code, 409);    // more than arrived
  const dn = await note(p.id, { kind: 'PRICE', reason: 'Overcharged against the agreed rate', items: [{ item_id: p.item, quantity: 10, unit_cost: 10 }] });
  assert.equal(dn.code, 201, JSON.stringify(dn.body));
  assert.equal(dn.body.data.total, 105);                                    // 100 + 5% tax
  assert.equal(dn.body.data.applied, 0);                                    // nothing was left to pay
  assert.equal(dn.body.data.credit, 105);                                   // so the supplier owes us
  assert.equal(await A.stockAt(A.main, A.oil), before);
  assert.equal(Number((await A.poRow(p.id)).balance_due_paise), 0);
});

test('only an order that has arrived can have a debit note, and debit notes are per business', { skip }, async () => {
  const draft = await newPo([{ product_id: A.oil, quantity: 1, unit_cost: 1 }]);
  assert.equal((await note(draft, { kind: 'RETURN', reason: 'x', items: [{ item_id: 1, quantity: 1 }] })).code, 409);
  const p = await receivedPo(2, 100, 0);
  assert.equal((await note(p.id, { kind: 'RETURN', reason: 'x', items: [{ item_id: p.item, quantity: 1 }] }, B)).code, 404);
  assert.equal((await B.call(debit.options, { params: { id: p.id } })).code, 404);
  const mine = await note(p.id, { kind: 'RETURN', reason: 'x', items: [{ item_id: p.item, quantity: 1 }] });
  assert.equal((await B.call(debit.get, { params: { id: mine.body.data.dn_id } })).code, 404);
  assert.equal((await B.call(debit.list)).body.data.length, 0);
  const detail = (await A.call(debit.get, { params: { id: mine.body.data.dn_id } })).body.data;
  assert.equal(detail.items[0].description, 'Oil');
  assert.ok((await A.call(debit.list, { query: { supplier_id: String(A.s1) } })).body.data.length >= 3);
});

test('another outlet cannot see or credit an order it does not own', { skip }, async () => {
  const p = await receivedPo(2, 100, 0);
  assert.equal((await A.call(debit.options, { params: { id: p.id }, at: A.second })).code, 404);
  assert.equal((await note(p.id, { kind: 'RETURN', reason: 'x', items: [{ item_id: p.item, quantity: 1 }] }, { call: (fn, o) => A.call(fn, { ...o, at: A.second }) })).code, 404);
});

test('purchases reports count part-delivered orders and are net of debit notes', { skip }, async () => {
  const r = (await A.call(reports.purchases)).body.data;
  const orders = (await pool.query(`SELECT COALESCE(SUM(total_paise - debited_paise),0) AS n FROM purchase_orders WHERE business_id = $1 AND status IN ('RECEIVED','PARTIAL')`, [A.biz])).rows[0].n;
  assert.equal(r.total_purchases, Number(orders) / 100);
  assert.ok(Number((await pool.query(`SELECT SUM(debited_paise) AS n FROM purchase_orders WHERE business_id = $1`, [A.biz])).rows[0].n) > 0);
});

/* ── stock requests between outlets ─────────────────────────────────────── */

test('an outlet can ask another for stock, and both can see it', { skip }, async () => {
  const ask = (body, at = A.second) => A.call(requests.create, { at, body });
  assert.equal((await ask({ from_branch_id: A.second, items: [{ product_id: A.oil, quantity: 5 }] })).code, 400);           // itself
  assert.equal((await ask({ from_branch_id: A.main, items: [] })).code, 400);
  assert.equal((await ask({ from_branch_id: A.main, items: [{ product_id: A.oil, quantity: 5 }, { product_id: A.oil, quantity: 1 }] })).code, 400);
  assert.equal((await ask({ from_branch_id: A.main, items: [{ product_id: A.oil, quantity: 0 }] })).code, 400);
  assert.equal((await ask({ from_branch_id: 999999, items: [{ product_id: A.oil, quantity: 1 }] })).code, 404);
  const service = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Service',100,FALSE) RETURNING product_id`, [A.biz])).rows[0].product_id;
  assert.equal((await ask({ from_branch_id: A.main, items: [{ product_id: service, quantity: 1 }] })).code, 400);           // does not track stock

  const made = await ask({ from_branch_id: A.main, notes: 'Weekend rush', items: [{ product_id: A.oil, quantity: 5 }, { product_id: A.rice, quantity: 10 }] });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.status, 'PENDING');
  assert.equal(made.body.data.from_name, 'Main'); assert.equal(made.body.data.to_name, 'Second');
  A.req1 = made.body.data;

  const incoming = (await A.call(requests.list, { at: A.main, query: { box: 'incoming' } })).body.data;
  const outgoing = (await A.call(requests.list, { at: A.second, query: { box: 'outgoing' } })).body.data;
  assert.equal(incoming.length, 1); assert.equal(outgoing.length, 1);
  assert.equal((await A.call(requests.list, { at: A.main, query: { box: 'outgoing' } })).body.data.length, 0);
  assert.equal((await A.call(requests.get, { at: A.third, params: { id: A.req1.request_id } })).code, 404);                  // an outlet that is not part of it
  assert.equal((await B.call(requests.get, { params: { id: A.req1.request_id } })).code, 404);
});

test('the asked outlet sends it in parts; stock moves with each part', { skip }, async () => {
  const id = A.req1.request_id;
  const [oilLine, riceLine] = A.req1.items.map((i) => i.item_id);
  const send = (items, tenant) => A.call(requests.fulfil, { at: A.main, tenant, params: { id }, body: { items } });

  const mainOil = await A.stockAt(A.main, A.oil); const secondOil = await A.stockAt(A.second, A.oil);
  assert.equal((await send([])).code, 400);
  assert.equal((await send([{ item_id: oilLine, quantity: 6 }])).code, 409);                                                 // more than asked
  assert.equal((await send([{ item_id: 999999, quantity: 1 }])).code, 400);
  const pinnedSecond = A.tenantAt(A.second, { pinned: true, role: 'MANAGER' });
  assert.equal((await send([{ item_id: oilLine, quantity: 1 }], pinnedSecond)).code, 403);                                   // the asking outlet cannot send

  const part = await send([{ item_id: oilLine, quantity: 3 }], A.tenantAt(A.main, { pinned: true, role: 'MANAGER' }));
  assert.equal(part.code, 200, JSON.stringify(part.body));
  assert.equal(part.body.data.status, 'PARTIAL');
  assert.deepEqual(part.body.data.items.map((i) => [i.sent, i.remaining]), [[3, 2], [0, 10]]);
  assert.equal(await A.stockAt(A.main, A.oil), mainOil - 3);
  assert.equal(await A.stockAt(A.second, A.oil), secondOil + 3);

  // not enough at the sending outlet: the whole send is refused, nothing moves
  await pool.query(`UPDATE branch_stock SET quantity = 4 WHERE branch_id = $1 AND product_id = $2`, [A.main, A.rice]);
  const rest = await send([{ item_id: oilLine, quantity: 2 }, { item_id: riceLine, quantity: 10 }]);
  assert.equal(rest.code, 409);
  assert.match(rest.body.message, /Only 4 of Rice/);
  assert.equal(await A.stockAt(A.main, A.oil), mainOil - 3);                                                                 // the oil in the same send did not move either

  const done = await send([{ item_id: oilLine, quantity: 2 }, { item_id: riceLine, quantity: 4 }]);
  assert.equal(done.body.data.status, 'PARTIAL');                                                                            // rice: 6 still asked for
  await pool.query(`UPDATE branch_stock SET quantity = 50 WHERE branch_id = $1 AND product_id = $2`, [A.main, A.rice]);
  const full = await send([{ item_id: riceLine, quantity: 6 }]);
  assert.equal(full.body.data.status, 'FULFILLED');
  assert.equal((await send([{ item_id: riceLine, quantity: 1 }])).code, 409);                                                // already complete
  assert.equal((await A.call(requests.cancel, { at: A.second, params: { id } })).code, 409);
  // business totals unchanged by transfers
  assert.equal(Number((await pool.query(`SELECT SUM(quantity) AS n FROM branch_stock WHERE product_id = $1 AND branch_id = ANY($2::int[])`, [A.oil, [A.main, A.second]])).rows[0].n), mainOil + secondOil);
});

test('a request can be turned down with a reason, or called off by the outlet that asked', { skip }, async () => {
  const mk = async () => (await A.call(requests.create, { at: A.third, body: { from_branch_id: A.main, items: [{ product_id: A.oil, quantity: 2 }] } })).body.data.request_id;
  const a = await mk();
  assert.equal((await A.call(requests.reject, { at: A.main, params: { id: a }, body: {} })).code, 400);                      // needs a reason
  assert.equal((await A.call(requests.reject, { at: A.third, tenant: A.tenantAt(A.third, { pinned: true }), params: { id: a }, body: { reason: 'no' } })).code, 403);
  assert.equal((await A.call(requests.reject, { at: A.main, params: { id: a }, body: { reason: 'We are short too' } })).code, 200);
  const seen = (await A.call(requests.get, { at: A.third, params: { id: a } })).body.data;
  assert.equal(seen.status, 'REJECTED'); assert.equal(seen.decision_note, 'We are short too');
  assert.equal((await A.call(requests.fulfil, { at: A.main, params: { id: a }, body: { items: [{ item_id: seen.items[0].item_id, quantity: 1 }] } })).code, 409);

  const b = await mk();
  assert.equal((await A.call(requests.cancel, { at: A.main, tenant: A.tenantAt(A.main, { pinned: true }), params: { id: b } })).code, 403);   // the asked outlet cannot call it off
  assert.equal((await A.call(requests.cancel, { at: A.third, params: { id: b } })).code, 200);
  assert.equal((await A.call(requests.get, { at: A.third, params: { id: b } })).body.data.status, 'CANCELLED');

  // after part was sent, calling off closes the request with what arrived
  const c = (await A.call(requests.create, { at: A.third, body: { from_branch_id: A.main, items: [{ product_id: A.oil, quantity: 4 }] } })).body.data;
  await A.call(requests.fulfil, { at: A.main, params: { id: c.request_id }, body: { items: [{ item_id: c.items[0].item_id, quantity: 1 }] } });
  assert.equal((await A.call(requests.reject, { at: A.main, params: { id: c.request_id }, body: { reason: 'x' } })).code, 409);   // part already sent
  await A.call(requests.cancel, { at: A.third, params: { id: c.request_id } });
  assert.equal((await A.call(requests.get, { at: A.third, params: { id: c.request_id } })).body.data.status, 'CLOSED');
});

test('a direct transfer still works and shares the same stock rules', { skip }, async () => {
  const before = await A.stockAt(A.main, A.oil);
  const ok = await A.call(inventory.transfer, { body: { from_branch_id: A.main, to_branch_id: A.third, product_id: A.oil, quantity: 1 } });
  assert.equal(ok.code, 201, JSON.stringify(ok.body));
  assert.equal(await A.stockAt(A.main, A.oil), before - 1);
  assert.equal((await A.call(inventory.transfer, { body: { from_branch_id: A.main, to_branch_id: A.third, product_id: A.oil, quantity: 100000 } })).code, 409);
});
