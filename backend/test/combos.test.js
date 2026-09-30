/*
 * Combos (stock, recipes and cost taken from the parts; kitchen sees what is inside)
 * and waiter assignment (table default, per-order override, per-waiter sales).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const menu = await import('../src/controllers/menu.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const tables = await import('../src/controllers/tables.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const reports = await import('../src/controllers/reports.controller.js');
const { createInvoiceInTransaction, BillingError } = await import('../src/modules/billing.js');
const { comboConsumption } = await import('../src/modules/combos.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── pure ───────────────────────────────────────────────────────────────── */

test('a combo uses its tracked parts directly and the recipes of the rest', () => {
  const parts = [
    { component_id: 1, quantity: 1, track_inventory: false },   // burger: recipe only
    { component_id: 2, quantity: 2, track_inventory: true }     // two bottled drinks: own stock
  ];
  const recipes = new Map([[1, [{ ingredient_id: 10, quantity: 1, wastage_pct: 0 }, { ingredient_id: 11, quantity: 0.5, wastage_pct: 10 }]]]);
  const used = Object.fromEntries(comboConsumption(parts, recipes).map((c) => [c.ingredient_id, Math.round(c.qty_per_unit * 1000) / 1000]));
  assert.deepEqual(used, { 2: 2, 10: 1, 11: 0.55 });
});

/* ── database ───────────────────────────────────────────────────────────── */

let A; let B;
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@combo.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz.business_id, user.user_id]);
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}, t = tenant, userId = user.user_id) => ({ tenant: t, auth: { userId }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const product = async (name, price, { stock = null, cost = 0, tax = 0 } = {}) => {
    const id = (await pool.query(
      `INSERT INTO products (business_id, name, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING product_id`,
      [biz.business_id, name, price, cost, tax, stock != null, stock ?? 0])).rows[0].product_id;
    if (stock != null) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [branchId, id, stock]);
    return id;
  };
  const stockOf = async (id) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branchId, id])).rows[0]?.quantity ?? 0);
  const table = async (name) => (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,$3,$4) RETURNING table_id`, [biz.business_id, branchId, name, `${label}-${name}-${Math.random()}`])).rows[0].table_id;
  const member = async (name, role, branch = null) => {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}-${label}@combo.test`])).rows[0].user_id;
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [biz.business_id, u, role, branch]);
    return u;
  };
  const call = async (fn, extra, t, userId) => { const res = fakeRes(); await fn(req(extra, t, userId), res); return res; };
  const bill = async (items) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const inv = await createInvoiceInTransaction(client, tenant, user.user_id, { items }); await client.query('COMMIT'); return inv; }
    catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  };
  return { tenant, biz: biz.business_id, branchId, userId: user.user_id, req, product, stockOf, table, member, call, bill };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.patty = await A.product('Patty', 0, { stock: 50, cost: 3000 });
  A.bun = await A.product('Bun', 0, { stock: 50, cost: 1000 });
  A.potato = await A.product('Potato', 0, { stock: 10, cost: 4000 });
  A.burger = await A.product('Burger', 15000);
  A.fries = await A.product('Fries', 8000);
  A.coke = await A.product('Coke', 6000, { stock: 5, cost: 2500 });
  A.meal = await A.product('Meal Combo', 22000, { tax: 5 });
  for (const [dish, ing, qty] of [[A.burger, A.patty, 1], [A.burger, A.bun, 1], [A.fries, A.potato, 0.2]]) {
    await pool.query(`INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity) VALUES ($1,$2,$3,$4)`, [A.biz, dish, ing, qty]);
  }
  await pool.query(`UPDATE businesses SET gst_enabled = TRUE WHERE business_id = $1`, [A.biz]);
  B.dish = await B.product('Other', 1000);
});

test('making a combo validates its parts', { skip }, async () => {
  const put = (id, components, who = A) => who.call(menu.setCombo, { params: { id }, body: { components } });
  const parts = [{ product_id: A.burger, quantity: 1 }, { product_id: A.fries, quantity: 1 }, { product_id: A.coke, quantity: 1 }];
  assert.equal((await put(A.meal, [parts[0]])).code, 400);                                        // needs two
  assert.equal((await put(A.meal, [parts[0], parts[0]])).code, 400);                              // twice
  assert.equal((await put(A.meal, [parts[0], { product_id: A.meal, quantity: 1 }])).code, 400);   // itself
  assert.equal((await put(A.meal, [parts[0], { product_id: A.fries, quantity: 0 }])).code, 400);
  assert.equal((await put(A.meal, [parts[0], { product_id: B.dish, quantity: 1 }])).code, 404);   // another business

  const ok = await put(A.meal, parts);
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.is_combo, true);
  assert.equal(ok.body.data.separate_value, 290);   // 150 + 80 + 60
  assert.equal(ok.body.data.saving, 70);            // versus the 220 combo price
  assert.equal(ok.body.data.components.length, 3);

  // no nesting, either way
  assert.equal((await put(A.fries, [{ product_id: A.burger, quantity: 1 }, { product_id: A.coke, quantity: 1 }])).code, 409);  // fries is inside a combo
  const meal2 = await A.product('Party Combo', 50000);
  assert.equal((await put(meal2, [{ product_id: A.meal, quantity: 1 }, { product_id: A.burger, quantity: 1 }])).code, 400);   // a combo inside a combo
});

test('billing a combo takes stock, recipes and cost from its parts', { skip }, async () => {
  const inv = await A.bill([{ product_id: A.meal, quantity: 2 }]);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].n, 1);   // one line on the bill

  assert.equal(inv.subtotal, 440);                       // 2 x 220, and the combo's own 5% tax applies
  assert.equal(inv.tax, 22);

  assert.equal(await A.stockOf(A.patty), 48);
  assert.equal(await A.stockOf(A.bun), 48);
  assert.ok(Math.abs((await A.stockOf(A.potato)) - 9.6) < 1e-9);
  assert.equal(await A.stockOf(A.coke), 3);              // the bottled drink is its own stock

  // cost of one combo: patty 30 + bun 10 + 0.2 kg potato 8 + coke 25 = 73
  const cost = (await pool.query(`SELECT unit_cost_paise FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].unit_cost_paise;
  assert.equal(Number(cost), 3000 + 1000 + 800 + 2500);
});

test('a combo cannot be sold when a stocked part has run out here', { skip }, async () => {
  await assert.rejects(A.bill([{ product_id: A.meal, quantity: 4 }]), (e) => e instanceof BillingError && e.status === 409 && /Not enough Coke/.test(e.message));
  assert.equal(await A.stockOf(A.coke), 3);              // nothing was taken
});

test('a part switched off at the outlet or archived blocks the combo, on orders and bills', { skip }, async () => {
  await pool.query(`INSERT INTO product_branch_settings (product_id, branch_id, price_paise, is_available) VALUES ($1,$2,NULL,FALSE)`, [A.fries, A.branchId]);
  await assert.rejects(A.bill([{ product_id: A.meal, quantity: 1 }]), /Fries, which is not available/);

  const t = await A.table('C1');
  const order = (await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t } })).body.data.order_id;
  const add = await A.call(orders.addItems, { params: { id: order }, body: { items: [{ product_id: A.meal, quantity: 1 }] } });
  assert.equal(add.code, 400);
  assert.match(add.body.message, /Fries/);
  await pool.query(`DELETE FROM product_branch_settings WHERE product_id = $1`, [A.fries]);

  await pool.query(`UPDATE products SET status = 'ARCHIVED' WHERE product_id = $1`, [A.burger]);
  await assert.rejects(A.bill([{ product_id: A.meal, quantity: 1 }]), /Burger, which is archived/);
  await pool.query(`UPDATE products SET status = 'ACTIVE' WHERE product_id = $1`, [A.burger]);
  await pool.query(`DELETE FROM orders WHERE order_id = $1`, [order]);
});

test('the kitchen sees what is inside a combo', { skip }, async () => {
  const t = await A.table('C2');
  const order = (await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t } })).body.data.order_id;
  assert.equal((await A.call(orders.addItems, { params: { id: order }, body: { items: [{ product_id: A.meal, quantity: 1 }, { product_id: A.burger, quantity: 1 }] } })).code, 201);
  const sent = await A.call(orders.sendKot, { params: { id: order }, body: {} });
  assert.equal(sent.code, 201, JSON.stringify(sent.body));

  const ticket = (await A.call(kitchen.tickets)).body.data.tickets.find((x) => x.order_id === order);
  const line = ticket.items.find((i) => i.description === 'Meal Combo');
  assert.deepEqual(line.combo, ['1 × Burger', '1 × Fries', '1 × Coke']);
  assert.deepEqual(ticket.items.find((i) => i.description === 'Burger').combo, []);

  const kotId = sent.body.data.kot?.kot_id ?? (await pool.query(`SELECT kot_id FROM kot_tickets WHERE order_id = $1`, [order])).rows[0].kot_id;
  const slip = await A.call(kitchen.printableKot, { params: { id: kotId } });
  assert.deepEqual(slip.body.data.stations[0].items.find((i) => i.description === 'Meal Combo').combo, ['1 × Burger', '1 × Fries', '1 × Coke']);
});

test('clearing a combo makes it a plain item again', { skip }, async () => {
  const cleared = await A.call(menu.clearCombo, { params: { id: A.meal } });
  assert.equal(cleared.body.data.is_combo, false);
  assert.equal(cleared.body.data.components.length, 0);
  const inv = await A.bill([{ product_id: A.meal, quantity: 1 }]);   // sells without touching stock now
  assert.equal(await A.stockOf(A.patty), 48);

});

/* ── waiters ────────────────────────────────────────────────────────────── */

test('only floor staff of this outlet can be picked as a waiter', { skip }, async () => {
  const second = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Second') RETURNING branch_id`, [A.biz])).rows[0].branch_id;
  A.ravi = await A.member('ravi', 'WAITER', A.branchId);
  A.sita = await A.member('sita', 'WAITER');                 // works anywhere
  A.chef = await A.member('chef', 'KITCHEN');
  A.other = await A.member('other', 'WAITER', second);       // pinned to another outlet

  const names = (await A.call(tables.waiters)).body.data.map((w) => w.name);
  assert.ok(names.includes('ravi') && names.includes('sita'));
  assert.ok(!names.includes('chef') && !names.includes('other'));
  assert.equal(names[0] === 'ravi' || names[0] === 'sita', true);   // waiters listed first
});

test('a table has a regular waiter and orders inherit it', { skip }, async () => {
  const t1 = await A.table('W1'); const t2 = await A.table('W2'); const t3 = await A.table('W3');
  assert.equal((await A.call(tables.update, { params: { id: t1 }, body: { waiter_user_id: A.chef } })).code, 400);
  assert.equal((await A.call(tables.update, { params: { id: t1 }, body: { waiter_user_id: A.other } })).code, 400);
  assert.equal((await A.call(tables.update, { params: { id: t1 }, body: { waiter_user_id: A.ravi } })).body.data.waiter_name, 'ravi');
  assert.equal((await B.call(tables.update, { params: { id: t1 }, body: { waiter_user_id: A.ravi } })).code, 404);   // not another business's table

  const inherited = await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t1 } });
  assert.equal(inherited.body.data.waiter_user_id, A.ravi);

  const picked = await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t2, waiter_user_id: A.sita } });
  assert.equal(picked.body.data.waiter_user_id, A.sita);
  assert.equal((await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t3, waiter_user_id: A.chef } })).code, 400);

  // a waiter opening an unassigned table takes it
  const own = await A.call(orders.create, { body: { order_type: 'TAKEAWAY' } }, { ...A.tenant, role: 'WAITER' }, A.ravi);
  assert.equal(own.body.data.waiter_user_id, A.ravi);

  A.orderRavi = inherited.body.data.order_id; A.orderSita = picked.body.data.order_id;
  const floor = (await A.call(tables.list)).body.data.find((x) => x.table_id === t1);
  assert.equal(floor.waiter_name, 'ravi');
});

test('an order can be handed to another waiter and filtered by waiter', { skip }, async () => {
  const moved = await A.call(orders.setWaiter, { params: { id: A.orderSita }, body: { waiter_user_id: A.ravi } });
  assert.equal(moved.code, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.data.waiter_name, 'ravi');
  assert.equal((await A.call(orders.setWaiter, { params: { id: A.orderSita }, body: { waiter_user_id: A.chef } })).code, 400);
  assert.equal((await B.call(orders.setWaiter, { params: { id: A.orderSita }, body: { waiter_user_id: null } })).code, 404);

  const mine = (await A.call(orders.list, { query: { waiter: 'me' } }, A.tenant, A.ravi)).body.data;
  assert.ok(mine.length >= 2 && mine.every((o) => o.waiter_user_id === A.ravi));
});

test('sales are reported per waiter', { skip }, async () => {
  await pool.query(`INSERT INTO orders (business_id, branch_id, order_number, order_type, status) VALUES ($1,$2,'X-1','TAKEAWAY','OPEN')`, [A.biz, A.branchId]);
  await A.call(orders.addItems, { params: { id: A.orderRavi }, body: { items: [{ product_id: A.fries, quantity: 2 }] } });
  await A.call(orders.addItems, { params: { id: A.orderSita }, body: { items: [{ product_id: A.burger, quantity: 1 }] } });
  assert.equal((await A.call(orders.bill, { params: { id: A.orderRavi }, body: { payment: { amount: 'FULL', method: 'CASH' } } })).code, 201);
  await A.call(orders.setWaiter, { params: { id: A.orderSita }, body: { waiter_user_id: A.sita } });
  assert.equal((await A.call(orders.bill, { params: { id: A.orderSita }, body: { payment: { amount: 'FULL', method: 'CASH' } } })).code, 201);

  const report = (await A.call(reports.waiters)).body.data;
  const byName = Object.fromEntries(report.waiters.map((w) => [w.name, w]));
  assert.equal(byName.ravi.revenue, 160);
  assert.equal(byName.sita.revenue, 150);
  assert.equal(byName.ravi.bills, 1);
  assert.equal(report.total, 310);
  assert.deepEqual((await B.call(reports.waiters)).body.data.waiters, []);   // other business sees nothing
});
