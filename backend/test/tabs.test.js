/*
 * Split bills, table transfer, merge and moving items between tables.
 * Runs the real controllers against a throwaway Postgres.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = await import('../src/controllers/orders.controller.js');
const tabs = await import('../src/controllers/tabs.controller.js');
const tables = await import('../src/controllers/tables.controller.js');
const { cleanSelection, earlierStage } = await import('../src/modules/tabs.js');

test.after(cleanup);

/* ── pure ───────────────────────────────────────────────────────────────── */

test('a selection must name real items once each, with sensible quantities', () => {
  assert.deepEqual(cleanSelection([{ order_item_id: 3, quantity: 1.5 }, { order_item_id: 4 }]), [{ order_item_id: 3, quantity: 1.5 }, { order_item_id: 4, quantity: null }]);
  assert.throws(() => cleanSelection([]), /at least one/);
  assert.throws(() => cleanSelection([{ order_item_id: 3 }, { order_item_id: 3 }]), /twice/);
  assert.throws(() => cleanSelection([{ order_item_id: 3, quantity: 0 }]), /more than zero/);
  assert.throws(() => cleanSelection([{ order_item_id: 'x' }]), /Unknown item/);
});

test('a merged tab takes the earlier stage', () => {
  assert.equal(earlierStage('SERVED', 'PREPARING'), 'PREPARING');
  assert.equal(earlierStage('OPEN', 'READY'), 'OPEN');
});

/* ── database ───────────────────────────────────────────────────────────── */

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let A; let B;

const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@tab.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const product = async (name, price, stock = null) => {
    const id = (await pool.query(
      `INSERT INTO products (business_id, name, selling_price_paise, track_inventory, current_stock) VALUES ($1,$2,$3,$4,$5) RETURNING product_id`,
      [biz.business_id, name, price, stock != null, stock ?? 0])).rows[0].product_id;
    if (stock != null) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [branchId, id, stock]);
    return id;
  };
  const table = async (name, status = 'FREE') => (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, status, qr_token) VALUES ($1,$2,$3,$4,$5) RETURNING table_id`, [biz.business_id, branchId, name, status, `${label}-${name}-${Math.random()}`])).rows[0].table_id;
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const open = async (tableId, items) => {
    const created = await call(orders.create, { body: { order_type: 'DINE_IN', table_id: tableId } });
    assert.equal(created.code, 201, JSON.stringify(created.body));
    const id = created.body.data.order_id;
    if (items) assert.equal((await call(orders.addItems, { params: { id }, body: { items } })).code, 201);
    return id;
  };
  const detail = async (id) => (await call(orders.get, { params: { id } })).body.data;
  return { tenant, biz: biz.business_id, userId: user.user_id, req, product, table, call, open, detail };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.dosa = await A.product('Dosa', 10000, 10); A.curry = await A.product('Curry', 20000); A.tea = await A.product('Tea', 5000);
  [A.t1, A.t2, A.t3] = [await A.table('T1'), await A.table('T2'), await A.table('T3')];
  A.closed = await A.table('Closed', 'CLOSED');
});

test('the bill can be split by items, part of a line, and each guest pays separately', { skip }, async () => {
  const id = await A.open(A.t1, [{ product_id: A.dosa, quantity: 2 }, { product_id: A.curry, quantity: 1 }, { product_id: A.tea, quantity: 1 }]);
  const items = (await A.detail(id)).items;
  const dosaLine = items.find((i) => i.description === 'Dosa'); const curryLine = items.find((i) => i.description === 'Curry');

  // Guest 1 pays for one of the two dosas, in full, by cash.
  let res = await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: dosaLine.order_item_id, quantity: 1 }], payment: { method: 'CASH', amount: 'FULL' } } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.total, 100);
  assert.equal(res.body.data.payment_status, 'PAID');
  assert.equal(res.body.data.order_closed, false);
  assert.equal(res.body.data.remaining_items, 3);

  // Guest 2 pays for the curry.
  res = await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: curryLine.order_item_id }], payment: { method: 'UPI', amount: 'FULL' } } });
  assert.equal(res.body.data.total, 200);
  assert.equal(res.body.data.remaining_items, 2);
  assert.equal((await A.detail(id)).status, 'OPEN');                               // still open for whoever is left

  // The rest: one dosa and a tea, billed the ordinary way, left unpaid.
  res = await A.call(orders.bill, { params: { id }, body: {} });
  assert.equal(res.body.data.total, 150);
  assert.equal(res.body.data.order_closed, true);

  const order = await A.detail(id);
  assert.equal(order.status, 'BILLED');
  assert.ok(order.items.every((i) => i.billed));
  const inv = (await pool.query(`SELECT COUNT(*)::int AS n, SUM(total_paise)::int AS total, COUNT(DISTINCT order_id)::int AS orders FROM invoices WHERE order_id = $1`, [id])).rows[0];
  assert.deepEqual(inv, { n: 3, total: 45000, orders: 1 });
  const stock = Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [A.dosa])).rows[0].current_stock);
  assert.equal(stock, 8);                                                          // two dosas left the shelf across two invoices

  const list = await A.call(tables.list);
  assert.equal(list.body.data.find((t) => t.table_id === A.t1).open_order_id, null); // the table is free again
});

test('an item cannot be billed twice, and quantities are checked', { skip }, async () => {
  const id = await A.open(A.t1, [{ product_id: A.dosa, quantity: 2 }, { product_id: A.tea, quantity: 1 }]);
  const [dosa, tea] = (await A.detail(id)).items;
  assert.equal((await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: dosa.order_item_id, quantity: 3 }] } })).code, 400);
  assert.equal((await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: dosa.order_item_id, quantity: 0 }] } })).code, 400);
  assert.equal((await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: tea.order_item_id }] } })).code, 201);
  assert.equal((await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: tea.order_item_id }] } })).code, 400);   // already billed

  // A billed line is on an invoice: its quantity and existence are no longer editable.
  const edit = await A.call(orders.updateItem, { params: { id, itemId: tea.order_item_id }, body: { status: 'CANCELLED' } });
  assert.equal(edit.code, 404);

  // Cancelling the rest of a part-billed tab closes it as billed, not cancelled.
  assert.equal((await A.call(orders.cancelOrder, { params: { id } })).code, 200);
  const order = await A.detail(id);
  assert.equal(order.status, 'BILLED');
  assert.equal(order.items.find((i) => i.description === 'Dosa').status, 'CANCELLED');
});

test('an order moves to a free table, but not onto an occupied, closed or missing one', { skip }, async () => {
  const id = await A.open(A.t1, [{ product_id: A.tea, quantity: 1 }]);
  const other = await A.open(A.t2, [{ product_id: A.tea, quantity: 1 }]);

  assert.equal((await A.call(tabs.transfer, { params: { id }, body: { table_id: A.t2 } })).code, 409);          // T2 is running its own order
  assert.equal((await A.call(tabs.transfer, { params: { id }, body: { table_id: A.closed } })).code, 400);
  assert.equal((await A.call(tabs.transfer, { params: { id }, body: { table_id: 999999 } })).code, 400);
  assert.equal((await A.call(tabs.transfer, { params: { id }, body: { table_id: A.t1 } })).code, 400);          // already there

  const moved = await A.call(tabs.transfer, { params: { id }, body: { table_id: A.t3 } });
  assert.equal(moved.code, 200);
  assert.equal(moved.body.data.table_name, 'T3');
  const list = (await A.call(tables.list)).body.data;
  assert.equal(list.find((t) => t.table_id === A.t1).open_order_id, null);
  assert.equal(list.find((t) => t.table_id === A.t3).open_order_id, id);

  A.mergeA = id; A.mergeB = other;
});

test('two tabs merge into one: items and tickets move, the emptied table frees up', { skip }, async () => {
  await A.call(orders.addItems, { params: { id: A.mergeA }, body: { items: [{ product_id: A.curry, quantity: 1 }] } });
  await A.call(orders.sendKot, { params: { id: A.mergeB } });                                  // B already has a ticket, A does not
  const before = (await A.detail(A.mergeB)).kots.length;
  assert.equal(before, 1);

  assert.equal((await A.call(tabs.merge, { params: { id: A.mergeA }, body: { from_order_id: A.mergeA } })).code, 400);
  const res = await A.call(tabs.merge, { params: { id: A.mergeA }, body: { from_order_id: A.mergeB } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.item_count, 3);                                                    // tea + curry + B's tea

  const kept = await A.detail(A.mergeA);
  assert.equal(kept.kots.length, 1);                                                            // the ticket followed its items
  assert.equal((await A.detail(A.mergeB)).status, 'MERGED');
  assert.equal((await A.detail(A.mergeB)).merged_into_order_id, A.mergeA);

  const list = (await A.call(tables.list)).body.data;
  assert.equal(list.find((t) => t.table_id === A.t2).open_order_id, null);                       // T2 is free
  assert.equal((await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: A.t2 } })).code, 201);   // and can seat someone new

  // A merged tab cannot be merged again or billed.
  assert.equal((await A.call(tabs.merge, { params: { id: A.mergeA }, body: { from_order_id: A.mergeB } })).code, 400);
  assert.equal((await A.call(orders.bill, { params: { id: A.mergeB }, body: {} })).code, 400);
});

test('part of a party can move to another table, taking only what they ordered', { skip }, async () => {
  const t4 = await A.table('T4');
  const id = await A.open(A.t1, [{ product_id: A.dosa, quantity: 3 }, { product_id: A.tea, quantity: 1 }]);
  const [dosa, tea] = (await A.detail(id)).items;

  // One dosa goes to a free table, which opens a new tab for it.
  let res = await A.call(tabs.split, { params: { id }, body: { table_id: t4, items: [{ order_item_id: dosa.order_item_id, quantity: 1 }] } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.moved, 1);
  assert.equal(res.body.data.target.table_name, 'T4');
  const newTab = await A.detail(res.body.data.target.order_id);
  assert.deepEqual(newTab.items.map((i) => [i.description, i.quantity]), [['Dosa', 1]]);
  assert.equal(Number((await A.detail(id)).items.find((i) => i.description === 'Dosa').quantity), 2);

  // Sending them to a table that is already running a tab adds to that tab.
  res = await A.call(tabs.split, { params: { id }, body: { table_id: A.t3, items: [{ order_item_id: tea.order_item_id }] } });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.target.order_id, A.mergeA);
  assert.ok((await A.detail(A.mergeA)).items.some((i) => i.description === 'Tea'));

  // A billed item cannot be moved: it is on someone's invoice.
  const dosaNow = (await A.detail(id)).items.find((i) => i.description === 'Dosa');
  assert.equal((await A.call(orders.bill, { params: { id }, body: { items: [{ order_item_id: dosaNow.order_item_id }] } })).code, 201);   // the whole line
  res = await A.call(tabs.split, { params: { id }, body: { table_id: t4, items: [{ order_item_id: dosaNow.order_item_id }] } });
  assert.equal(res.code, 400);
  assert.equal((await A.call(tabs.split, { params: { id }, body: { items: [{ order_item_id: dosaNow.order_item_id }] } })).code, 400);   // no destination
});

test('another business cannot move, merge or split this business tabs, or use its tables', { skip }, async () => {
  const mine = await A.open(await A.table('T5'), [{ product_id: A.tea, quantity: 1 }]);
  const itemId = (await A.detail(mine)).items[0].order_item_id;
  const bTable = await B.table('B1');
  const bOrder = await B.open(bTable, null);

  assert.equal((await B.call(tabs.transfer, { params: { id: mine }, body: { table_id: bTable } })).code, 404);
  assert.equal((await B.call(tabs.merge, { params: { id: bOrder }, body: { from_order_id: mine } })).code, 404);
  assert.equal((await B.call(tabs.split, { params: { id: mine }, body: { table_id: bTable, items: [{ order_item_id: itemId }] } })).code, 404);
  assert.equal((await B.call(orders.bill, { params: { id: mine }, body: {} })).code, 404);

  // And its own order cannot be pointed at a table it does not own.
  assert.equal((await A.call(tabs.transfer, { params: { id: mine }, body: { table_id: bTable } })).code, 400);
});

test('an invoice knows its order, so channel reporting survives a split bill', { skip }, async () => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND order_id IS NOT NULL', [A.biz]);
  assert.ok(rows[0].n >= 5);
});
