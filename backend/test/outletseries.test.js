/*
 * Per-outlet invoice series, kitchen stations and recipes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const outlets = await import('../src/controllers/outlets.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const menu = await import('../src/controllers/menu.controller.js');
const { resolveStation } = await import('../src/modules/stations.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let A; let B;
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@series.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, invoice_prefix) VALUES ($1,$2,'RESTAURANT','INV') RETURNING business_id`, [label, user.user_id])).rows[0];
  const mk = async (name, primary = false) => (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,$2,$3) RETURNING branch_id`, [biz.business_id, name, primary])).rows[0].branch_id;
  const main = await mk('Main', true); const second = await mk('Second');
  const tenantAt = (branchId, extra = {}) => ({ businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {}, ...extra });
  const call = async (fn, { at = main, tenant, ...extra } = {}) => {
    const res = fakeRes();
    await fn({ tenant: tenant ?? tenantAt(at), auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res);
    return res;
  };
  const product = async (name, price, { stock = null, kind = 'DISH' } = {}) => {
    const id = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory, current_stock, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING product_id`,
      [biz.business_id, name, price, stock != null, (stock ?? 0) * 2, kind])).rows[0].product_id;
    if (stock != null) for (const b of [main, second]) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [b, id, stock]);
    return id;
  };
  const stockAt = async (branchId, id) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branchId, id])).rows[0].quantity);
  const bill = (at, extra = {}) => call(invoices.create, { at, body: { items: [{ product_id: A.dish, quantity: 1 }], ...extra } });
  return { biz: biz.business_id, main, second, tenantAt, call, product, stockAt, bill };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.dish = await A.product('Fried Rice', 20000);
  A.rice = await A.product('Rice', 0, { stock: 100, kind: 'INGREDIENT' });
  await pool.query(`UPDATE products SET track_inventory = FALSE WHERE product_id = $1`, [A.dish]);
});

/* ── invoice series ─────────────────────────────────────────────────────── */

test('an outlet can have its own invoice series; others stay on the business series', { skip }, async () => {
  const set = (body, at = A.second) => A.call(outlets.update, { params: { id: at }, body });
  const before = (await A.bill(A.second)).body.data;
  assert.match(before.invoice_number, /^INV-\d{4}$/);

  const ok = await set({ invoice_prefix: 'ind' });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.invoice_prefix, 'IND');
  assert.equal(ok.body.data.invoice_next_number, 1);

  assert.equal((await A.bill(A.second)).body.data.invoice_number, 'IND-0001');
  assert.equal((await A.bill(A.second)).body.data.invoice_number, 'IND-0002');
  assert.match((await A.bill(A.main)).body.data.invoice_number, /^INV-\d{4}$/);          // the other outlet is unchanged
  assert.equal((await pool.query(`SELECT invoice_next_number FROM branches WHERE branch_id = $1`, [A.second])).rows[0].invoice_next_number, 3);
});

test('prefixes are checked: format, the business one, another outlet, numbers already used', { skip }, async () => {
  const set = (body, at = A.main) => A.call(outlets.update, { params: { id: at }, body });
  assert.equal((await set({ invoice_prefix: 'no spaces' })).code, 400);
  assert.equal((await set({ invoice_prefix: 'WAYTOOLONGPREFIX' })).code, 400);
  assert.equal((await set({ invoice_prefix: 'inv' })).code, 409);                       // the business-wide prefix
  assert.equal((await set({ invoice_prefix: 'IND' })).code, 409);                       // Second already uses it
  assert.equal((await set({ invoice_next_number: 5 })).code, 400);                      // no prefix to number
  assert.equal((await A.call(outlets.update, { params: { id: A.second }, body: { invoice_next_number: 0 } })).code, 400);

  // numbers already issued under a prefix are never reused
  await pool.query(`INSERT INTO invoices (business_id, branch_id, invoice_number, invoice_date, total_paise) VALUES ($1,$2,'OLD-0007', CURRENT_DATE, 100)`, [A.biz, A.main]);
  const start = await set({ invoice_prefix: 'OLD' });
  assert.equal(start.body.data.invoice_next_number, 8);                                  // after the highest, not 1
  assert.equal((await set({ invoice_next_number: 5 })).code, 409);
  assert.equal((await set({ invoice_next_number: 100 })).body.data.invoice_next_number, 100);
  assert.equal((await A.bill(A.main)).body.data.invoice_number, 'OLD-0100');

  // clearing the prefix returns the outlet to the business series
  assert.equal((await set({ invoice_prefix: '' })).body.data.invoice_prefix, null);
  assert.match((await A.bill(A.main)).body.data.invoice_number, /^INV-\d{4}$/);
  assert.equal((await A.call(outlets.create, { body: { name: 'Third', invoice_prefix: 'INV' } })).code, 409);
  const third = await A.call(outlets.create, { body: { name: 'Third', invoice_prefix: 'thr', invoice_next_number: 50 } });
  assert.equal(third.body.data.invoice_prefix, 'THR');
  assert.equal(third.body.data.invoice_next_number, 50);
  assert.equal((await B.call(outlets.create, { body: { name: 'Other', invoice_prefix: 'IND' } })).code, 201);   // another business may reuse it
});

test('bills at one outlet never share or skip a number, even at the same moment', { skip }, async () => {
  const set = await A.call(outlets.update, { params: { id: A.main }, body: { invoice_prefix: 'MAIN' } });
  assert.equal(set.code, 200);
  const results = await Promise.all(Array.from({ length: 6 }, () => A.bill(A.main)));
  const numbers = results.map((r) => r.body.data.invoice_number).sort();
  assert.deepEqual(numbers, ['MAIN-0001', 'MAIN-0002', 'MAIN-0003', 'MAIN-0004', 'MAIN-0005', 'MAIN-0006']);
});

test('billing a table uses the series of the outlet the order belongs to', { skip }, async () => {
  const table = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'S1','series-s1') RETURNING table_id`, [A.biz, A.second])).rows[0].table_id;
  const order = (await A.call(orders.create, { at: A.second, body: { order_type: 'DINE_IN', table_id: table } })).body.data.order_id;
  await A.call(orders.addItems, { at: A.second, params: { id: order }, body: { items: [{ product_id: A.dish, quantity: 1 }] } });
  const billed = await A.call(orders.bill, { at: A.second, params: { id: order }, body: {} });
  assert.equal(billed.code, 201, JSON.stringify(billed.body));
  assert.match(billed.body.data.invoice_number, /^IND-\d{4}$/);
});

/* ── kitchen stations ───────────────────────────────────────────────────── */

test('stations can belong to one outlet or to all, and names only clash within an outlet', { skip }, async () => {
  const add = (name, at, outlet_only) => A.call(kitchen.createStation, { at, body: { name, outlet_only } });
  const shared = await add('Chaat', A.main, false);
  assert.equal(shared.body.data.branch_id, null);
  const mainGrill = (await add('Grill', A.main, true)).body.data;
  const secondGrill = await add('grill', A.second, true);                    // same name at another outlet is fine
  assert.equal(secondGrill.code, 201, JSON.stringify(secondGrill.body));
  assert.equal((await add('Grill', A.main, true)).code, 409);                // twice at one outlet is not
  assert.equal((await A.call(kitchen.createStation, { tenant: { ...A.tenantAt(A.main), scopeBranchId: null }, body: { name: 'Bar', outlet_only: true } })).code, 400);   // all-outlets view must pick one

  const names = async (at) => (await A.call(kitchen.listStations, { at })).body.data.map((s) => s.name);
  assert.deepEqual(await names(A.main), ['Chaat', 'Grill']);
  assert.deepEqual(await names(A.second), ['Chaat', 'grill']);
  const all = (await A.call(kitchen.listStations, { tenant: { ...A.tenantAt(A.main), scopeBranchId: null } })).body.data;
  assert.equal(all.length, 3);
  assert.equal(all.find((s) => s.name === 'Grill').outlet_name, 'Main');

  A.mainGrill = mainGrill.station_id; A.secondGrill = secondGrill.body.data.station_id; A.shared = shared.body.data.station_id;
  // a person at the second outlet cannot rename the main outlet's station, but can the shared one? no: shared ones are business-wide
  assert.equal((await A.call(kitchen.updateStation, { at: A.second, params: { id: A.mainGrill }, body: { name: 'Hijack' } })).code, 404);
});

test('a dish goes to the station of the outlet it is ordered at', { skip }, async () => {
  assert.equal(await resolveStation(pool, A.biz, A.second, A.mainGrill), A.secondGrill);   // routed to Main's Grill, cooked at Second's Grill
  assert.equal(await resolveStation(pool, A.biz, A.main, A.mainGrill), A.mainGrill);
  assert.equal(await resolveStation(pool, A.biz, A.second, A.shared), A.shared);           // a shared station applies everywhere
  assert.equal(await resolveStation(pool, A.biz, A.second, null), null);

  const tandoor = (await A.call(kitchen.createStation, { at: A.main, body: { name: 'Tandoor', outlet_only: true } })).body.data.station_id;
  assert.equal(await resolveStation(pool, A.biz, A.second, tandoor), null);               // Second has no Tandoor: general kitchen

  await pool.query(`UPDATE products SET station_id = $1 WHERE product_id = $2`, [A.mainGrill, A.dish]);
  const mk = async (at, name) => {
    const table = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,$3,$4) RETURNING table_id`, [A.biz, at, name, `st-${name}`])).rows[0].table_id;
    const order = (await A.call(orders.create, { at, body: { order_type: 'DINE_IN', table_id: table } })).body.data.order_id;
    await A.call(orders.addItems, { at, params: { id: order }, body: { items: [{ product_id: A.dish, quantity: 1 }] } });
    return (await pool.query(`SELECT station_id FROM order_items WHERE order_id = $1`, [order])).rows[0].station_id;
  };
  assert.equal(await mk(A.main, 'M1'), A.mainGrill);
  assert.equal(await mk(A.second, 'S9'), A.secondGrill);
});

test('the kitchen screen only offers the stations of its outlet', { skip }, async () => {
  const table = (await pool.query(`SELECT table_id FROM dining_tables WHERE business_id = $1 AND branch_id = $2 LIMIT 1`, [A.biz, A.second])).rows[0].table_id;
  const order = (await pool.query(`SELECT order_id FROM orders WHERE table_id = $1 ORDER BY order_id DESC LIMIT 1`, [table])).rows[0].order_id;
  await A.call(orders.sendKot, { at: A.second, params: { id: order }, body: {} });
  const tabs = (await A.call(kitchen.tickets, { at: A.second })).body.data.stations.map((s) => s.name);
  assert.ok(tabs.includes('grill') && tabs.includes('Chaat'));
  assert.ok(!tabs.includes('Tandoor') && !tabs.includes('Grill'));
});

/* ── recipes ────────────────────────────────────────────────────────────── */

test('an outlet can have its own recipe; without one it uses the default', { skip }, async () => {
  const put = (branch_id, ingredients, at = A.main) => A.call(menu.setRecipe, { at, params: { id: A.dish }, body: { branch_id, ingredients } });
  assert.equal((await put(null, [{ ingredient_id: A.rice, quantity: 1 }])).code, 200);
  assert.equal((await put(A.second, [])).code, 400);                                                // an override needs an ingredient
  assert.equal((await put(A.second, [{ ingredient_id: A.rice, quantity: 2 }])).code, 200);
  assert.equal((await put(99999, [{ ingredient_id: A.rice, quantity: 2 }])).code, 404);            // not an outlet of this business

  const get = async (branch) => (await A.call(menu.getRecipe, { params: { id: A.dish }, query: branch ? { branch_id: branch } : {} })).body.data;
  const d = await get(null); const s = await get(A.second); const m = await get(A.main);
  assert.equal(d.ingredients[0].quantity, 1);
  assert.equal(s.ingredients[0].quantity, 2); assert.equal(s.outlet_specific, true);
  assert.equal(m.ingredients[0].quantity, 1); assert.equal(m.outlet_specific, false);              // Main has no override: it shows the default

  const dishAt = async (at) => {
    const before = await A.stockAt(at, A.rice);
    assert.equal((await A.bill(at)).code, 201);
    return before - await A.stockAt(at, A.rice);
  };
  assert.equal(await dishAt(A.main), 1);                                                            // the default recipe
  assert.equal(await dishAt(A.second), 2);                                                          // the outlet's own

  // editing the default does not touch the outlet's own recipe, and removing it returns to the default
  await put(null, [{ ingredient_id: A.rice, quantity: 3 }]);
  assert.equal(await dishAt(A.main), 3);
  assert.equal(await dishAt(A.second), 2);
  const cleared = await A.call(menu.clearOutletRecipe, { params: { id: A.dish }, query: { branch_id: A.second } });
  assert.equal(cleared.body.data.outlet_specific, false);
  assert.equal(await dishAt(A.second), 3);
  assert.equal((await A.call(menu.clearOutletRecipe, { params: { id: A.dish }, query: {} })).code, 400);
});

test('a person pinned to one outlet can only change their own outlet recipe; other businesses see nothing', { skip }, async () => {
  const pinned = A.tenantAt(A.main, { pinned: true, role: 'MANAGER' });
  const put = (branch) => A.call(menu.setRecipe, { tenant: pinned, params: { id: A.dish }, body: { branch_id: branch, ingredients: [{ ingredient_id: A.rice, quantity: 1 }] } });
  assert.equal((await put(A.second)).code, 403);
  assert.equal((await put(A.main)).code, 200);
  assert.equal((await B.call(menu.getRecipe, { params: { id: A.dish }, query: {} })).code, 404);
  assert.equal((await B.call(menu.setRecipe, { params: { id: A.dish }, body: { branch_id: A.main, ingredients: [] } })).code, 404);
});
