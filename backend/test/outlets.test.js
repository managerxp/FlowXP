/*
 * Multi-outlet: who sees which outlet, per-outlet stock and prices, transfers,
 * the comparison report, staff rules, plan limits, and the legacy backfill.
 * Runs against a throwaway Postgres (helpers/db.js) and skips without one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { withBusiness, requireOutlet, requireGroupUser } = await import('../src/middleware/auth.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const tabs = await import('../src/controllers/tabs.controller.js');
const tables = await import('../src/controllers/tables.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const inventory = await import('../src/controllers/inventory.controller.js');
const purchases = await import('../src/controllers/purchases.controller.js');
const expenses = await import('../src/controllers/expenses.controller.js');
const payments = await import('../src/controllers/payments.controller.js');
const reports = await import('../src/controllers/reports.controller.js');
const products = await import('../src/controllers/products.controller.js');
const outlets = await import('../src/controllers/outlets.controller.js');
const staff = await import('../src/controllers/staff.controller.js');
const publicOrdering = await import('../src/controllers/publicOrdering.controller.js');
const dashboard = await import('../src/controllers/dashboard.controller.js');
const { recipientsFor } = await import('../src/modules/notifications.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/* ── the legacy backfill: data from before outlets, then migration 0015 ─── */

test('migration 0015 gives legacy records an outlet, splits stock into the main outlet, and frees owners', { skip }, async () => {
  // A sibling of migrations/ so the baseline's relative imports still resolve.
  const older = fs.mkdtempSync(path.join(migrationsDir, '..', 'migrations-before-0015-'));
  test.after(() => fs.rmSync(older, { recursive: true, force: true }));
  for (const f of fs.readdirSync(migrationsDir).filter((n) => n < '0015')) fs.copyFileSync(path.join(migrationsDir, f), path.join(older, f));
  await runMigrations(pool, older);

  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Old','old@o.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Legacy',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,'OWNER',$3)`, [biz, user, branch]);
  const product = (await pool.query(`INSERT INTO products (business_id, name, track_inventory, current_stock) VALUES ($1,'Flour',TRUE,7) RETURNING product_id`, [biz])).rows[0].product_id;
  await pool.query(`INSERT INTO products (business_id, name, track_inventory, current_stock) VALUES ($1,'Untracked',FALSE,0)`, [biz]);
  await pool.query(`INSERT INTO invoices (business_id, invoice_number, invoice_date, total_paise) VALUES ($1,'L-1',CURRENT_DATE,100)`, [biz]);
  await pool.query(`INSERT INTO orders (business_id, order_number) VALUES ($1,'O-1')`, [biz]);
  await pool.query(`INSERT INTO expenses (business_id, category, amount_paise) VALUES ($1,'Rent',5)`, [biz]);
  await pool.query(`INSERT INTO dining_tables (business_id, name, qr_token) VALUES ($1,'T1','legacy-token')`, [biz]);

  const ran = await runMigrations(pool);
  assert.ok(ran.includes('0015_outlets.js'));

  for (const table of ['invoices', 'orders', 'expenses', 'dining_tables']) {
    const { rows } = await pool.query(`SELECT DISTINCT branch_id FROM ${table} WHERE business_id = $1`, [biz]);
    assert.deepEqual(rows.map((r) => r.branch_id), [branch], `${table} moved to the main outlet`);
  }
  const bs = (await pool.query(`SELECT branch_id, quantity FROM branch_stock WHERE product_id = $1`, [product])).rows;
  assert.deepEqual(bs.map((r) => [r.branch_id, Number(r.quantity)]), [[branch, 7]]);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM branch_stock WHERE branch_id = $1`, [branch])).rows[0].n, 1, 'untracked products get no stock row');
  assert.equal((await pool.query(`SELECT branch_id FROM business_users WHERE business_id = $1`, [biz])).rows[0].branch_id, null, 'the owner now covers every outlet');
});

/* ── fixtures ───────────────────────────────────────────────────────────── */

let G;   // the group: three outlets, several people
const membershipsFor = async (userId) => (await pool.query(
  `SELECT bu.business_id, bu.role, bu.branch_id, bu.permissions, b.name, b.business_type, b.status AS business_status, b.subscription_status,
          b.plan_code, b.billing_cycle, b.trial_started_at, b.trial_ends_at, b.next_billing_date, b.currency, b.onboarding_step, b.gst_enabled
   FROM business_users bu JOIN businesses b ON b.business_id = bu.business_id WHERE bu.user_id = $1 AND bu.status = 'ACTIVE'`, [userId])).rows;

/** Run a request through the real tenant middleware, then (optionally) a controller. */
const request = async (person, { headers = {}, ...extra } = {}) => {
  const req = { auth: { userId: person.id, user: { user_id: person.id } }, memberships: await membershipsFor(person.id), headers, body: {}, query: {}, params: {}, ip: '127.0.0.1', ...extra };
  const res = fakeRes(); let passed = false;
  await withBusiness()(req, res, () => { passed = true; });
  return { req, res, passed };
};
const call = async (fn, person, opts = {}) => {
  const { req, res, passed } = await request(person, opts);
  if (!passed) return res;
  const out = fakeRes();
  await fn(req, out);
  return out;
};
const gate = async (person, mw, opts = {}) => {   // does this middleware let the request through?
  const { req, res, passed } = await request(person, opts);
  if (!passed) return { ok: false, res };
  let ok = false; const out = fakeRes();
  mw(req, out, () => { ok = true; });
  return { ok, res: out };
};
const as = (outlet) => ({ headers: { 'x-branch-id': String(outlet) } });

const stockRows = async (product) => Object.fromEntries((await pool.query(`SELECT branch_id, quantity FROM branch_stock WHERE product_id = $1`, [product])).rows.map((r) => [r.branch_id, Number(r.quantity)]));
const total = async (product) => Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [product])).rows[0].current_stock);
const invariant = async (product) => assert.equal(Object.values(await stockRows(product)).reduce((s, n) => s + n, 0), await total(product), 'outlet stock adds up to the business total');

test('setup: a group with three outlets and people at each', { skip }, async () => {
  const mkUser = async (name, role, branch) => {
    const id = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@g.test`])).rows[0].user_id;
    return { id, name, role, branch };
  };
  const owner = await mkUser('owner', 'OWNER', null);
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status) VALUES ('Group',$1,'RESTAURANT','BUSINESS','ACTIVE') RETURNING business_id`, [owner.id])).rows[0].business_id;
  const branch = async (name, primary, state = null) => (await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,$2,$3,$4) RETURNING branch_id`, [biz, name, primary, state])).rows[0].branch_id;
  const A = await branch('MG Road', true); const B = await branch('Indiranagar', false); const C = await branch('Koramangala', false);

  const people = { owner };
  for (const [name, role, b] of [['cashA', 'CASHIER', A], ['cashB', 'CASHIER', B], ['stockA', 'INVENTORY_MANAGER', A], ['stockB', 'INVENTORY_MANAGER', B], ['adminG', 'ADMIN', null], ['mgrB', 'MANAGER', B]]) people[name] = await mkUser(name, role, b);
  for (const p of Object.values(people)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [biz, p.id, p.role, p.branch]);

  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, purchase_price_paise, track_inventory, current_stock, kind) VALUES ($1,'Biryani',10000,4000,TRUE,20,'DISH') RETURNING product_id`, [biz])).rows[0].product_id;
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$3,10),($2,$3,10)`, [A, B, dish]);
  const table = async (name, b) => (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,$3,$4) RETURNING table_id`, [biz, b, name, `g-${name}-${Math.random()}`])).rows[0].table_id;
  G = { biz, A, B, C, people, dish, tA: await table('A1', A), tB: await table('B1', B), tC: await table('C1', C) };
});

/* ── who sees which outlet ──────────────────────────────────────────────── */

test('the active outlet is a claim: verified, and forced for people pinned to one outlet', { skip }, async () => {
  const { A, B, C, people } = G;
  const tenant = async (person, headers) => (await request(person, { headers })).req.tenant;

  let t = await tenant(people.owner, {});
  assert.deepEqual([t.branchId, t.scopeBranchId, t.viewAll, t.pinned], [A, null, false, false], 'no header: writes go to the main outlet, reads see everything');
  t = await tenant(people.owner, { 'x-branch-id': String(B) });
  assert.deepEqual([t.branchId, t.scopeBranchId], [B, B]);
  t = await tenant(people.owner, { 'x-branch-id': 'all' });
  assert.deepEqual([t.viewAll, t.scopeBranchId], [true, null]);

  // Someone else's outlet, or nonsense, is "not found" — same as an outlet that doesn't exist.
  const other = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('Elsewhere',$1) RETURNING business_id`, [people.owner.id])).rows[0].business_id;
  const foreign = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'X',TRUE) RETURNING branch_id`, [other])).rows[0].branch_id;
  for (const bad of [String(foreign), 'abc', '99999', '-1']) assert.equal((await request(people.owner, { headers: { 'x-branch-id': bad } })).res.code, 404, `header ${bad}`);

  // A cashier pinned to MG Road can't pick another outlet, or "all".
  for (const claim of [String(B), 'all', String(foreign)]) {
    t = await tenant(people.cashA, { 'x-branch-id': claim });
    assert.deepEqual([t.branchId, t.scopeBranchId, t.pinned, t.viewAll], [A, A, true, false], `claim ${claim}`);
  }
  // A closed outlet locks its pinned staff out.
  await pool.query(`UPDATE branches SET status = 'CLOSED' WHERE branch_id = $1`, [C]);
  const pinnedC = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('cashC','cashC@g.test','x') RETURNING user_id`)).rows[0].user_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,'CASHIER',$3)`, [G.biz, pinnedC, C]);
  assert.equal((await request({ id: pinnedC })).res.code, 403);
  await pool.query(`UPDATE branches SET status = 'ACTIVE' WHERE branch_id = $1`, [C]);
  await pool.query(`DELETE FROM business_users WHERE user_id = $1`, [pinnedC]);
});

test('writes need a real outlet: "all outlets" is read-only, and only group users can see group-wide pages', { skip }, async () => {
  const { people } = G;
  assert.equal((await gate(people.owner, requireOutlet, { headers: { 'x-branch-id': 'all' } })).ok, false);
  assert.equal((await gate(people.owner, requireOutlet, as(G.B))).ok, true);
  assert.equal((await gate(people.owner, requireGroupUser)).ok, true);
  assert.equal((await gate(people.mgrB, requireGroupUser)).ok, false, 'a manager pinned to one outlet does not get the group-wide view');
});

/* ── stock is per outlet ────────────────────────────────────────────────── */

let saleB;
test('a sale at one outlet moves only that outlet’s stock, and each outlet is checked separately', { skip }, async () => {
  const { dish, A, B } = G;
  const sold = await call(invoices.create, G.people.cashB, { body: { items: [{ product_id: dish, quantity: 4 }], payment: { amount: 'FULL' } } });
  assert.equal(sold.code, 201);
  saleB = sold.body.data;
  assert.deepEqual(await stockRows(dish), { [A]: 10, [B]: 6 });
  assert.equal(await total(dish), 16);
  await invariant(dish);
  assert.equal((await pool.query(`SELECT branch_id FROM invoices WHERE invoice_id = $1`, [saleB.invoice_id])).rows[0].branch_id, B);

  // Indiranagar has 6 left; MG Road's 10 doesn't help it.
  const over = await call(invoices.create, G.people.cashB, { body: { items: [{ product_id: dish, quantity: 7 }] } });
  assert.equal(over.code, 409);
  assert.match(over.body.message, /6 left here/);
  assert.equal((await call(invoices.create, G.people.cashA, { body: { items: [{ product_id: dish, quantity: 7 }] } })).code, 201);
  await invariant(dish);
});

test('cancelling puts stock back at the outlet that sold it, whoever cancels', { skip }, async () => {
  const { dish, A, B } = G;
  const before = await stockRows(dish);
  const res = await call(invoices.cancel, G.people.owner, { ...as('all'), params: { id: saleB.invoice_id } });
  assert.equal(res.code, 200);
  const after = await stockRows(dish);
  assert.equal(after[B], before[B] + 4);
  assert.equal(after[A], before[A]);
  await invariant(dish);
});

test('adjust, wastage, purchases and opening stock all keep outlet and total in step', { skip }, async () => {
  const { dish, A, B, biz } = G;
  const owner = G.people.owner;
  const adj = await call(inventory.adjust, owner, { ...as(A), body: { product_id: dish, quantity: -2, reason: 'count' } });
  assert.equal(adj.code, 200);
  assert.equal((await call(inventory.adjust, owner, { ...as(B), body: { product_id: dish, quantity: -999, reason: 'oops' } })).code, 400, 'can’t go below zero at the outlet');
  assert.equal((await call(inventory.recordWastage, owner, { ...as(B), body: { product_id: dish, quantity: 1, reason_code: 'SPOILAGE' } })).code, 201);
  const po = await call(purchases.create, owner, { ...as(B), body: { items: [{ product_id: dish, quantity: 5, unit_cost: 40 }] } });
  assert.equal(po.code, 201);
  const created = await call(products.create, owner, { ...as(A), body: { name: 'Naan', selling_price: 30, opening_stock: 12 } });
  assert.equal(created.code, 201);
  const naan = created.body.data.product_id;
  assert.deepEqual(await stockRows(naan), { [A]: 12 });
  await invariant(dish); await invariant(naan);
});

test('a transfer moves stock between outlets, never more than the sender has, and the total does not change', { skip }, async () => {
  const { dish, A, B, C, people } = G;
  await call(inventory.adjust, people.owner, { ...as(A), body: { product_id: dish, quantity: 20, reason: 'restock' } });
  const before = await stockRows(dish); const totalBefore = await total(dish);
  const send = (from, to, quantity, who = people.owner) => call(inventory.transfer, who, { body: { product_id: dish, from_branch_id: from, to_branch_id: to, quantity } });

  assert.equal((await send(A, B, 3)).code, 201);
  const after = await stockRows(dish);
  assert.equal(after[A], before[A] - 3); assert.equal(after[B], before[B] + 3);
  assert.equal(await total(dish), totalBefore);
  assert.equal((await send(A, C, 2)).code, 201, 'an outlet with no stock row yet can receive');
  assert.equal((await stockRows(dish))[C], 2);

  assert.equal((await send(A, B, 9999)).code, 409, 'more than the sender holds');
  assert.equal((await send(A, A, 1)).code, 400, 'same outlet');
  assert.equal((await send(B, A, 1, people.cashA)).code, 403, 'a cashier pinned to MG Road cannot send from Indiranagar');
  await invariant(dish);

  const ledger = (await pool.query(`SELECT branch_id, quantity FROM inventory_transactions WHERE transaction_type = 'TRANSFER' AND product_id = $1 ORDER BY txn_id`, [dish])).rows;
  assert.equal(ledger.length, 4, 'each transfer writes an outflow and an inflow');
  assert.equal(ledger.reduce((s, r) => s + Number(r.quantity), 0), 0);

  const history = await call(inventory.transfers, people.cashA);
  assert.equal(history.body.data.length, 2, 'a pinned user sees transfers touching their outlet');
});

test('inventory reads follow the outlet being viewed', { skip }, async () => {
  const { dish, A, B } = G;
  const at = async (headers) => (await call(inventory.levels, G.people.owner, { headers, query: {} })).body.data.find((p) => p.product_id === dish).current_stock;
  const rows = await stockRows(dish);
  assert.equal(await at({ 'x-branch-id': String(A) }), rows[A]);
  assert.equal(await at({ 'x-branch-id': String(B) }), rows[B]);
  assert.equal(await at({ 'x-branch-id': 'all' }), await total(dish));
  // A pinned user sees their own outlet whatever they ask for.
  assert.equal(await at.call(null, { 'x-branch-id': String(B) }), rows[B]);
  const pinned = (await call(inventory.levels, G.people.cashA, { headers: { 'x-branch-id': String(B) }, query: {} })).body.data.find((p) => p.product_id === dish).current_stock;
  assert.equal(pinned, rows[A]);
});

/* ── isolation ──────────────────────────────────────────────────────────── */

test('a user pinned to one outlet cannot list, open or change another outlet’s records', { skip }, async () => {
  const { A, B, people, dish, tA, tB } = G;
  const owner = people.owner;

  // Records at Indiranagar (B).
  const inv = (await call(invoices.create, owner, { ...as(B), body: { items: [{ product_id: dish, quantity: 1 }], payment: { amount: 'FULL' } } })).body.data;
  const order = (await call(orders.create, owner, { ...as(B), body: { order_type: 'DINE_IN', table_id: tB } })).body.data;
  assert.equal((await call(orders.addItems, owner, { ...as(B), params: { id: order.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } })).code, 201);
  assert.equal((await call(orders.sendKot, owner, { ...as(B), params: { id: order.order_id } })).code, 201);
  const expense = (await call(expenses.create, owner, { ...as(B), body: { category: 'Rent', amount: 500 } })).body.data;
  const po = (await call(purchases.create, owner, { ...as(B), body: { items: [{ product_id: dish, quantity: 1, unit_cost: 40 }] } })).body.data;

  const cash = people.cashA;                 // pinned to A; may even send X-Branch-Id: B
  const spy = { headers: { 'x-branch-id': String(B) } };

  // lists never include B's rows
  const ids = async (fn, key, extra = {}) => (await call(fn, cash, { ...spy, query: {}, ...extra })).body.data.map((r) => r[key]);
  assert.ok(!(await ids(invoices.list, 'invoice_id')).includes(inv.invoice_id));
  assert.ok(!(await ids(orders.list, 'order_id')).includes(order.order_id));
  assert.ok(!(await ids(expenses.list, 'expense_id')).includes(expense.expense_id));
  assert.ok(!(await ids(purchases.list, 'po_id')).includes(po.po_id));
  assert.ok(!(await ids(payments.list, 'payment_id')).some(async () => false));
  assert.deepEqual(await ids(tables.list, 'table_id'), [tA], 'only MG Road’s table');
  assert.equal((await call(kitchen.tickets, cash, spy)).body.data.tickets.length, 0, 'B’s ticket is not on A’s screen');
  assert.equal((await call(kitchen.tickets, owner, as(B))).body.data.tickets.length, 1);

  // by id: same answer as "does not exist"
  const not404 = async (label, res) => assert.equal(res.code, 404, label);
  await not404('invoice', await call(invoices.get, cash, { ...spy, params: { id: inv.invoice_id } }));
  await not404('order', await call(orders.get, cash, { ...spy, params: { id: order.order_id } }));
  await not404('purchase', await call(purchases.get, cash, { ...spy, params: { id: po.po_id } }));
  await not404('cancel invoice', await call(invoices.cancel, cash, { ...spy, params: { id: inv.invoice_id } }));
  await not404('refund', await call(invoices.refund, cash, { ...spy, params: { id: inv.invoice_id }, body: { amount: 10, reason: 'x' } }));
  await not404('pay invoice', await call(invoices.addPayment, cash, { ...spy, params: { id: inv.invoice_id }, body: { amount: 10 } }));
  await not404('order items', await call(orders.addItems, cash, { ...spy, params: { id: order.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } }));
  await not404('send kot', await call(orders.sendKot, cash, { ...spy, params: { id: order.order_id } }));
  await not404('cancel order', await call(orders.cancelOrder, cash, { ...spy, params: { id: order.order_id } }));
  await not404('bill order', await call(orders.bill, cash, { ...spy, params: { id: order.order_id }, body: {} }));
  await not404('order status', await call(orders.updateStatus, cash, { ...spy, params: { id: order.order_id }, body: { status: 'READY' } }));
  await not404('transfer tab', await call(tabs.transfer, cash, { ...spy, params: { id: order.order_id }, body: { table_id: tA } }));
  await not404('table edit', await call(tables.update, cash, { ...spy, params: { id: tB }, body: { name: 'hijacked' } }));
  await not404('expense edit', await call(expenses.update, cash, { ...spy, params: { id: expense.expense_id }, body: { amount: 1 } }));
  await not404('expense delete', await call(expenses.remove, cash, { ...spy, params: { id: expense.expense_id } }));
  assert.equal((await call(kitchen.advance, cash, { ...spy, body: { item_ids: (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1`, [order.order_id])).rows.map((r) => r.order_item_id), status: 'READY' } })).code, 404);
  assert.equal((await call(kitchen.rush, cash, { ...spy, params: { id: order.order_id } })).code, 404);
  assert.equal((await pool.query(`SELECT name FROM dining_tables WHERE table_id = $1`, [tB])).rows[0].name, 'B1', 'nothing was changed');
  assert.equal((await pool.query(`SELECT status FROM invoices WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].status, 'ISSUED');

  // reports and the dashboard only add up the pinned outlet
  const soldA = (await pool.query(`SELECT COALESCE(SUM(total_paise),0) AS s FROM invoices WHERE business_id = $1 AND branch_id = $2 AND status = 'ISSUED'`, [G.biz, A])).rows[0].s;
  const report = await call(reports.sales, cash, { ...spy, query: {} });
  assert.equal(report.body.data.total_sales, Number(soldA) / 100);
  const dash = await call(dashboard.getDashboard, cash, spy);
  const dueA = (await pool.query(`SELECT COALESCE(SUM(balance_due_paise),0) AS s FROM invoices WHERE business_id = $1 AND branch_id = $2 AND status = 'ISSUED'`, [G.biz, A])).rows[0].s;
  assert.equal(dash.body.data.metrics.outstanding, Number(dueA) / 100, 'the dashboard shows only this outlet’s dues');

  // and the owner still sees each outlet, and all of them
  const sum = async (h) => (await call(reports.sales, owner, { headers: h, query: {} })).body.data.total_sales;
  assert.equal(Math.round((await sum({ 'x-branch-id': String(A) }) + await sum({ 'x-branch-id': String(B) }) + await sum({ 'x-branch-id': String(G.C) })) * 100), Math.round((await sum({ 'x-branch-id': 'all' })) * 100));
});

test('another business sees none of it', { skip }, async () => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Rival','rival@g.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Rival',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, user]);
  const rival = { id: user };
  assert.equal((await call(invoices.list, rival, { query: {} })).body.data.length, 0);
  assert.equal((await call(tables.list, rival)).body.data.length, 0);
  assert.equal((await call(outlets.list, rival, { query: {} })).body.data.length, 1);
  // naming an outlet of the group is "not found"
  assert.equal((await request(rival, as(G.A))).res.code, 404);
  // their transfer can't touch our product or outlets
  assert.equal((await call(inventory.transfer, rival, { body: { product_id: G.dish, from_branch_id: G.A, to_branch_id: G.B, quantity: 1 } })).code, 404);
  void branch;
});

test('a tab can’t be merged, moved or split across outlets', { skip }, async () => {
  const { A, B, people, dish, tA, tB } = G;
  const owner = people.owner;
  const open = async (outlet, table) => {
    const o = (await call(orders.create, owner, { ...as(outlet), body: { order_type: 'DINE_IN', table_id: table } })).body.data;
    await call(orders.addItems, owner, { ...as(outlet), params: { id: o.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } });
    return o.order_id;
  };
  const a = await open(A, tA);
  const b = (await pool.query(`SELECT order_id FROM orders WHERE table_id = $1 AND status NOT IN ('BILLED','CANCELLED','MERGED')`, [tB])).rows[0].order_id;

  const merge = await call(tabs.merge, owner, { ...as('all'), params: { id: a }, body: { from_order_id: b } });
  assert.equal(merge.code, 400);
  assert.match(merge.body.message, /different outlets/);
  const move = await call(tabs.transfer, owner, { ...as('all'), params: { id: a }, body: { table_id: tB } });
  assert.equal(move.code, 400, 'a table at another outlet does not exist for this order');
  const split = await call(tabs.split, owner, { ...as('all'), params: { id: a }, body: { table_id: tB, items: [{ order_item_id: (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1`, [a])).rows[0].order_item_id }] } });
  assert.equal(split.code, 400);

  // Opening an order for a table at another outlet is refused too.
  const wrong = await call(orders.create, owner, { ...as(A), body: { order_type: 'DINE_IN', table_id: tB } });
  assert.equal(wrong.code, 400);
});

test('billing a tab from "all outlets" bills it at the outlet the order belongs to', { skip }, async () => {
  const { A, B, people, dish } = G;
  const before = await stockRows(dish);
  const { order_id } = (await pool.query(`SELECT order_id FROM orders WHERE branch_id = $1 AND status = 'PREPARING' LIMIT 1`, [B])).rows[0];
  const res = await call(orders.bill, people.owner, { ...as('all'), params: { id: order_id }, body: { payment: { amount: 'FULL' } } });
  assert.equal(res.code, 201);
  const inv = (await pool.query(`SELECT branch_id FROM invoices WHERE invoice_id = $1`, [res.body.data.invoice_id])).rows[0];
  assert.equal(inv.branch_id, B);
  const after = await stockRows(dish);
  assert.equal(after[B], before[B] - 1); assert.equal(after[A], before[A]);
  await invariant(dish);
});

/* ── price and availability ─────────────────────────────────────────────── */

test('a dish can cost more at one outlet, or be switched off there, without duplicating the menu', { skip }, async () => {
  const { A, B, C, dish, people } = G;
  const owner = people.owner;
  const set = (branch, body) => call(products.setOutletSettings, owner, { params: { id: dish }, body: { branch_id: branch, ...body } });

  assert.equal((await set(B, { price: 150 })).code, 200);
  const priceAt = async (outlet) => (await call(products.get, owner, { ...as(outlet), params: { id: dish } })).body.data;
  assert.equal((await priceAt(A)).selling_price, 100);
  assert.equal((await priceAt(B)).selling_price, 150);
  assert.equal((await priceAt(B)).price_overridden, true);
  assert.equal((await priceAt('all')).selling_price, 100, 'the shared price is the group view');

  // billing and orders use the outlet's price
  const line = async (outlet) => (await call(invoices.create, owner, { ...as(outlet), body: { items: [{ product_id: dish, quantity: 1 }] } })).body.data;
  assert.equal((await line(B)).subtotal, 150);
  assert.equal((await line(A)).subtotal, 100);
  const tb = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'B9','p-b9') RETURNING table_id`, [G.biz, B])).rows[0].table_id;
  const o = (await call(orders.create, owner, { ...as(B), body: { order_type: 'DINE_IN', table_id: tb } })).body.data;
  const added = await call(orders.addItems, owner, { ...as(B), params: { id: o.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } });
  assert.equal(added.body.data[0].unit_price, 150);

  // unavailable at C: refused by billing and orders, hidden from its QR menu, still sold elsewhere
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,5) ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = branch_stock.quantity + 5`, [C, dish]);
  await pool.query(`UPDATE products SET current_stock = current_stock + 5 WHERE product_id = $1`, [dish]);
  assert.equal((await set(C, { is_available: false })).code, 200);
  const blocked = await call(invoices.create, owner, { ...as(C), body: { items: [{ product_id: dish, quantity: 1 }] } });
  assert.equal(blocked.code, 409); assert.match(blocked.body.message, /not available at this outlet/);
  const tc = (await pool.query(`SELECT table_id FROM dining_tables WHERE branch_id = $1`, [C])).rows[0].table_id;
  const oc = (await call(orders.create, owner, { ...as(C), body: { order_type: 'DINE_IN', table_id: tc } })).body.data;
  assert.equal((await call(orders.addItems, owner, { ...as(C), params: { id: oc.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } })).code, 400);

  const qr = async (token) => { const res = fakeRes(); await publicOrdering.getMenu({ params: { token } }, res); return res.body.data.categories.flatMap((c) => c.products); };
  const tokenOf = async (t) => (await pool.query(`SELECT qr_token FROM dining_tables WHERE table_id = $1`, [t])).rows[0].qr_token;
  assert.ok(!(await qr(await tokenOf(tc))).some((p) => p.product_id === dish), 'not on Koramangala’s menu');
  const priceOn = async (t) => (await qr(await tokenOf(t))).find((p) => p.product_id === dish).price;
  assert.equal(await priceOn(tb), 150, 'Indiranagar’s QR menu shows its own price');
  assert.equal(await priceOn(G.tA), 100);

  // customers ordering from a table land on that table's outlet
  const res = fakeRes();
  await publicOrdering.placeOrder({ params: { token: await tokenOf(G.tA) }, body: { items: [{ product_id: dish, quantity: 1 }] }, ip: '127.0.0.1', headers: {} }, res);
  assert.equal(res.code, 201);
  const placed = (await pool.query(`SELECT branch_id FROM orders WHERE order_number = $1`, [res.body.data.order_number])).rows[0];
  assert.equal(placed.branch_id, A);

  // switching both overrides off returns to shared behaviour
  await set(B, {}); await set(C, {});
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM product_branch_settings WHERE product_id = $1`, [dish])).rows[0].n, 0);
  // a pinned user can only touch their own outlet
  assert.equal((await call(products.setOutletSettings, people.mgrB, { params: { id: dish }, body: { branch_id: A, price: 1 } })).code, 403);
  await invariant(dish);
});

/* ── comparison ─────────────────────────────────────────────────────────── */

test('the outlet comparison adds up to the business total', { skip }, async () => {
  const { biz } = G;
  const { profitability, periodCosts } = await import('../src/modules/profitability.js');
  const res = await call(outlets.compare, G.people.owner, { query: { from: '2020-01-01', to: '2099-01-01' } });
  assert.equal(res.code, 200);
  const rows = res.body.data.outlets;
  assert.deepEqual(rows.map((r) => r.name), ['MG Road', 'Indiranagar', 'Koramangala']);
  const whole = await profitability(biz, '2020-01-01', '2099-01-01');
  const costs = await periodCosts(biz, '2020-01-01', '2099-01-01');
  const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.05, `${what}: ${a} vs ${b}`);
  assert.equal(rows.reduce((s, r) => s + r.orders, 0), whole.totals.invoices);
  close(rows.reduce((s, r) => s + r.net_revenue, 0), whole.totals.net_revenue / 100, 'revenue');
  close(rows.reduce((s, r) => s + r.contribution, 0), whole.totals.contribution / 100, 'contribution');
  close(rows.reduce((s, r) => s + r.expenses, 0), costs.expenses_total / 100, 'expenses');
  assert.ok(rows.filter((r) => r.orders > 0).length >= 2, 'more than one outlet actually traded');
  // pinned users don't get the group comparison
  assert.equal((await gate(G.people.mgrB, requireGroupUser)).ok, false);
});

/* ── outlets and staff ──────────────────────────────────────────────────── */

test('outlets: create, edit, plan limit, and closing rules', { skip }, async () => {
  const owner = G.people.owner;
  const act = (fn, body, params = {}) => call(fn, owner, { body, params });

  const made = await act(outlets.create, { name: 'Whitefield', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' });
  assert.equal(made.code, 201);
  const id = made.body.data.branch_id;
  assert.equal((await act(outlets.create, { name: 'whitefield' })).code, 409, 'names are unique, ignoring case');
  assert.equal((await act(outlets.create, { name: 'Bad GST', gstin: 'nope' })).code, 400);
  assert.equal((await act(outlets.update, { city: 'Bengaluru' }, { id })).body.data.city, 'Bengaluru');
  assert.equal((await act(outlets.update, { name: 'Valid Name' }, { id: 999999 })).code, 404);

  // BUSINESS plan allows 5 active outlets: 3 + Whitefield = 4, one more is fine, then the limit bites.
  assert.equal((await act(outlets.create, { name: 'Jayanagar' })).code, 201);
  const limit = await act(outlets.create, { name: 'One too many' });
  assert.equal(limit.code, 402); assert.equal(limit.body.code, 'OUTLET_LIMIT');

  // closing: not the main outlet, not with stock, not with open orders
  assert.equal((await act(outlets.update, { status: 'CLOSED' }, { id: G.A })).code, 400);
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,3)`, [id, G.dish]);
  await pool.query(`UPDATE products SET current_stock = current_stock + 3 WHERE product_id = $1`, [G.dish]);
  assert.equal((await act(outlets.update, { status: 'CLOSED' }, { id })).code, 409);
  await call(inventory.transfer, owner, { body: { product_id: G.dish, from_branch_id: id, to_branch_id: G.A, quantity: 3 } });
  assert.equal((await act(outlets.update, { status: 'CLOSED' }, { id })).code, 200);
  assert.ok(!(await call(outlets.list, owner, { query: {} })).body.data.some((o) => o.branch_id === id), 'closed outlets leave the list');
  assert.equal((await act(outlets.update, { status: 'ACTIVE' }, { id })).code, 200, 'and can be reopened');

  // the list for a pinned user is just their outlet
  assert.deepEqual((await call(outlets.list, G.people.cashB, { query: {} })).body.data.map((o) => o.branch_id), [G.B]);
  await invariant(G.dish);
});

test('staff: who can add whom, and to which outlet', { skip }, async () => {
  const { people, A, B, biz } = G;
  const add = (who, body) => call(staff.invite, who, { body: { name: 'New Person', ...body } });

  const cashier = await add(people.owner, { email: 'new.cashier@g.test', role: 'CASHIER', branch_id: B });
  assert.equal(cashier.code, 201); assert.equal(cashier.body.data.invited, true);
  const m = (email) => pool.query(`SELECT bu.role, bu.branch_id, bu.status FROM business_users bu JOIN users u ON u.user_id = bu.user_id WHERE u.email = $1 AND bu.business_id = $2`, [email, biz]).then((r) => r.rows[0]);
  assert.deepEqual(await m('new.cashier@g.test'), { role: 'CASHIER', branch_id: B, status: 'ACTIVE' });
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM password_resets pr JOIN users u ON u.user_id = pr.user_id WHERE u.email = 'new.cashier@g.test'`)).rows[0].n, 1, 'a set-your-password link was created');

  assert.equal((await add(people.owner, { email: 'new.cashier@g.test', role: 'CASHIER', branch_id: B })).code, 409, 'already on the team');
  assert.equal((await add(people.owner, { email: 'bad', role: 'CASHIER' })).code, 400);
  assert.equal((await add(people.owner, { email: 'r@g.test', role: 'WIZARD' })).code, 400);
  assert.equal((await add(people.owner, { email: 'f@g.test', role: 'CASHIER', branch_id: 999999 })).code, 400, 'not one of your outlets');

  // floor roles are always pinned; owners/admins always cover the group; managers may be either
  await add(people.owner, { email: 'nopin@g.test', role: 'WAITER' });
  assert.equal((await m('nopin@g.test')).branch_id, A, 'defaults to the main outlet rather than every outlet');
  await add(people.owner, { email: 'adm@g.test', role: 'ADMIN', branch_id: B });
  assert.equal((await m('adm@g.test')).branch_id, null);
  await add(people.owner, { email: 'mgr@g.test', role: 'MANAGER' });
  assert.equal((await m('mgr@g.test')).branch_id, null);

  // only an owner adds or changes owners and admins
  assert.equal((await add(people.adminG, { email: 'x1@g.test', role: 'OWNER' })).code, 403);
  assert.equal((await add(people.adminG, { email: 'x2@g.test', role: 'ADMIN' })).code, 403);
  assert.equal((await add(people.adminG, { email: 'x3@g.test', role: 'MANAGER', branch_id: A })).code, 201);

  const uid = async (email) => (await pool.query(`SELECT user_id FROM users WHERE email = $1`, [email])).rows[0].user_id;
  const edit = (who, email, body) => uid(email).then((id) => call(staff.update, who, { params: { userId: id }, body }));
  assert.equal((await edit(people.adminG, 'adm@g.test', { status: 'DISABLED' })).code, 403, 'an admin can’t touch another admin');
  assert.equal((await edit(people.adminG, 'new.cashier@g.test', { role: 'ADMIN' })).code, 403, 'or promote someone to admin');
  assert.equal((await edit(people.owner, 'new.cashier@g.test', { branch_id: A })).code, 200);
  assert.equal((await m('new.cashier@g.test')).branch_id, A);
  assert.equal((await edit(people.owner, 'new.cashier@g.test', { status: 'DISABLED' })).code, 200);
  assert.equal((await request({ id: await uid('new.cashier@g.test') })).res.code, 409, 'a disabled person has no business to sign in to');

  // nobody edits themselves; the last owner stays
  assert.equal((await call(staff.update, people.owner, { params: { userId: people.owner.id }, body: { role: 'MANAGER' } })).code, 403);
  assert.equal((await call(staff.update, people.adminG, { params: { userId: people.owner.id }, body: { status: 'DISABLED' } })).code, 403);
  const second = await add(people.owner, { email: 'owner2@g.test', role: 'OWNER' });
  assert.equal(second.code, 201);
  assert.equal((await edit(people.owner, 'owner2@g.test', { status: 'DISABLED' })).code, 200, 'with two owners one can be disabled');
  const list = (await call(staff.list, people.owner)).body.data;
  assert.ok(list.find((p) => p.email === 'owner@g.test').is_you);
  assert.equal(list.find((p) => p.email === 'cashB@g.test').branch_name, 'Indiranagar');

  // the last active owner can't be demoted, even by another owner who is then the only one
  const other = { id: await uid('owner2@g.test'), name: 'owner2' };
  await pool.query(`UPDATE business_users SET status = 'ACTIVE' WHERE user_id = $1 AND business_id = $2`, [other.id, biz]);
  assert.equal((await call(staff.update, other, { params: { userId: people.owner.id }, body: { role: 'MANAGER' } })).code, 200, 'two owners: one may step down');
  assert.equal((await call(staff.update, people.owner, { params: { userId: other.id }, body: { role: 'MANAGER' } })).code, 403, 'a manager can’t change roles');
  await pool.query(`UPDATE business_users SET role = 'OWNER' WHERE business_id = $1 AND user_id = $2`, [biz, people.owner.id]);   // leave the fixture as it was
});

test('a plan’s outlet and user allowance is enforced', { skip }, async () => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Solo','solo@g.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status) VALUES ('Solo',$1,'RESTAURANT','STARTER','ACTIVE') RETURNING business_id`, [user])).rows[0].business_id;
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz]);
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, user]);
  const solo = { id: user };
  const second = await call(outlets.create, solo, { body: { name: 'Second' } });
  assert.equal(second.code, 402);
  // STARTER allows 2 users: the owner plus one.
  assert.equal((await call(staff.invite, solo, { body: { name: 'One', email: 'one@s.test', role: 'STAFF' } })).code, 201);
  assert.equal((await call(staff.invite, solo, { body: { name: 'Two', email: 'two@s.test', role: 'STAFF' } })).code, 402);
});

/* ── notifications ──────────────────────────────────────────────────────── */

test('outlet alerts reach the group and that outlet’s people, business-wide ones only the group', { skip }, async () => {
  const { A, B, biz } = G;
  const original = ['owner', 'adminG', 'mgrB', 'stockA', 'stockB', 'cashA', 'cashB'];   // earlier tests add more people
  const who = async (category, branch) => (await recipientsFor(biz, category, pool, branch)).map((r) => r.email.split('@')[0]).filter((n) => original.includes(n)).sort();
  assert.deepEqual(await who('stock', A), ['adminG', 'owner', 'stockA']);
  const b = await who('stock', B);
  assert.deepEqual(b, ['adminG', 'mgrB', 'owner', 'stockB'], 'Indiranagar’s stock alert skips MG Road’s stock manager');
  const wide = await who('leakage', null);
  assert.deepEqual(wide, ['adminG', 'owner']);
  const summary = await who('sales', null);
  assert.ok(!summary.includes('mgrB'), 'a manager pinned to one outlet is not sent the group summary');
});

/* ── forecast follows the outlet ────────────────────────────────────────── */

test('the stock forecast uses the outlet’s own stock', { skip }, async () => {
  const { buildInventoryForecast } = await import('../src/modules/forecast.js');
  const { A, B, biz } = G;
  const a = await buildInventoryForecast(biz, pool, A);
  const b = await buildInventoryForecast(biz, pool, B);
  const all = await buildInventoryForecast(biz, pool);
  assert.ok(Array.isArray(a.items) && Array.isArray(b.items) && Array.isArray(all.items));
  // With little history there may be no rows; the point is that the outlet call runs and never mixes outlets.
  for (const out of [a, b]) for (const item of out.items) assert.equal(item.current_stock, Number((await stockRows(item.product_id))[out === a ? A : B] ?? 0));
});
