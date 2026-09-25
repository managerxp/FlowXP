/*
 * Purchase orders: draft -> ordered -> received (or cancelled), drafts straight
 * from the stock forecast, and the guarantees around them: nothing moves stock
 * or money before receipt, stock lands at the order's own outlet, and outlets
 * and businesses stay separate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = await import('../src/controllers/purchaseOrders.controller.js');
const purchases = await import('../src/controllers/purchases.controller.js');
const { overdueOrderAlerts } = await import('../src/modules/scans.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── pure ───────────────────────────────────────────────────────────────── */

test('an overdue order alert names the order, the supplier and how late', () => {
  const [a] = overdueOrderAlerts([{ po_id: 7, po_number: 'PO-0007', supplier_name: 'Halal Meats Co', expected_date: '2026-09-24', days_late: 2 }]);
  assert.equal(a.title, 'Order PO-0007 is 2 days late');
  assert.match(a.body, /Halal Meats Co was due to deliver by 2026-09-24/);
  assert.equal(a.category, 'stock');
  assert.equal(a.dedupeKey, 'po_overdue:7:2', 'one nudge per order per day late');
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let A; let B; let owner; let chicken; let rice; let supplier; let bare; let other;
const tenant = (branchId, extra = {}) => ({ businessId: biz, branchId, scopeBranchId: null, role: 'OWNER', permissions: {}, ...extra });
const call = async (fn, { branch = A, body = {}, params = {}, tenant: t = {} } = {}) => {
  const res = fakeRes();
  await fn({ tenant: tenant(branch, t), auth: { userId: owner }, body, params, query: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};
const stock = async (product) => Object.fromEntries((await pool.query(`SELECT branch_id, quantity FROM branch_stock WHERE product_id = $1`, [product])).rows.map((r) => [r.branch_id, Number(r.quantity)]));
const total = async (product) => Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [product])).rows[0].current_stock);
const row = async (id) => (await pool.query(`SELECT * FROM purchase_orders WHERE po_id = $1`, [id])).rows[0];

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@po.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Cafe',$1,'RESTAURANT') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'MG Road',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Indiranagar',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  supplier = (await pool.query(`INSERT INTO suppliers (business_id, name, phone, email) VALUES ($1,'Halal Meats Co','98765 43210','orders@halal.test') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  bare = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'No contact') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  const p = async (name, unit, cost, lead, supplierId, stockQty) => {
    const id = (await pool.query(`INSERT INTO products (business_id, name, kind, unit, track_inventory, current_stock, purchase_price_paise, lead_time_days, supplier_id) VALUES ($1,$2,'INGREDIENT',$3,TRUE,$4,$5,$6,$7) RETURNING product_id`, [biz, name, unit, stockQty, cost, lead, supplierId]))
      .rows[0].product_id;
    await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [A, id, stockQty]);
    return id;
  };
  chicken = await p('Chicken', 'kg', 22000, 2, supplier, 3);
  rice = await p('Rice', 'kg', 9000, 1, null, 500);
  other = (await pool.query(`INSERT INTO products (business_id, name, kind) VALUES ((SELECT business_id FROM businesses WHERE name = 'Cafe') + 0, 'Plain', 'DISH') RETURNING product_id`)).rows[0].product_id;
});

test('recording a purchase directly still receives it on the spot', { skip }, async () => {
  const res = await call(purchases.create, { body: { items: [{ product_id: rice, quantity: 10, unit_cost: 90 }] } });
  assert.equal(res.code, 201);
  assert.equal(res.body.data.status, 'RECEIVED');
  const po = await row(res.body.data.po_id);
  assert.ok(po.received_at);
  assert.equal(Number((await pool.query(`SELECT received_quantity FROM purchase_order_items WHERE po_id = $1`, [po.po_id])).rows[0].received_quantity), 10);
  assert.equal((await stock(rice))[A], 510);
});

test('a draft moves no stock and no money, and its lines are checked', { skip }, async () => {
  const before = { stock: await stock(chicken), payments: (await pool.query(`SELECT COUNT(*)::int AS n FROM payments`)).rows[0].n, txns: (await pool.query(`SELECT COUNT(*)::int AS n FROM inventory_transactions`)).rows[0].n };
  const res = await call(orders.createDraft, { body: { supplier_id: supplier, items: [{ product_id: chicken, quantity: 10, unit_cost: 220 }, { description: 'Ice', quantity: 2, unit_cost: 50 }], notes: 'Early please' } });
  assert.equal(res.code, 201);
  const d = res.body.data;
  assert.deepEqual([d.status, d.source, d.total, d.balance_due, d.payment_status], ['DRAFT', 'MANUAL', 2300, 2300, 'UNPAID']);
  assert.deepEqual(await stock(chicken), before.stock);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM payments`)).rows[0].n, before.payments);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM inventory_transactions`)).rows[0].n, before.txns);
  assert.equal((await row(d.po_id)).branch_id, A);

  const bad = async (body, code = 400) => assert.equal((await call(orders.createDraft, { body })).code, code);
  await bad({ items: [] });
  await bad({ items: [{ product_id: 999999, quantity: 1, unit_cost: 1 }] });
  await bad({ items: [{ quantity: 1, unit_cost: 1 }] });
  await bad({ supplier_id: 999999, items: [{ description: 'x', quantity: 1, unit_cost: 1 }] });
  await bad({ items: [{ description: 'x', quantity: 1, unit_cost: 1 }], expected_date: 'soon' });
  await bad({ items: [{ description: 'x', quantity: -3, unit_cost: 1 }] });
});

let po;
test('an open order can be edited, but not once it is received or cancelled', { skip }, async () => {
  const made = await call(orders.createDraft, { body: { supplier_id: supplier, items: [{ product_id: chicken, quantity: 10, unit_cost: 220 }] } });
  po = made.body.data.po_id;
  const edited = await call(orders.update, { params: { id: po }, body: { items: [{ product_id: chicken, quantity: 12, unit_cost: 225 }, { product_id: rice, quantity: 5, unit_cost: 90 }], expected_date: '2026-10-01', notes: 'Call first' } });
  assert.equal(edited.code, 200);
  assert.equal(edited.body.data.total, 12 * 225 + 5 * 90);
  const shown = (await call(purchases.get, { params: { id: po } })).body.data;
  assert.deepEqual(shown.items.map((i) => [i.description, i.quantity, i.received_quantity]), [['Chicken', 12, null], ['Rice', 5, null]]);
  assert.equal(shown.expected_date, '2026-10-01');

  const gone = (await call(orders.createDraft, { body: { items: [{ description: 'x', quantity: 1, unit_cost: 1 }] } })).body.data.po_id;
  assert.equal((await call(orders.cancel, { params: { id: gone } })).code, 200);
  assert.equal((await call(orders.update, { params: { id: gone }, body: { notes: 'late' } })).code, 409);
  assert.equal((await call(orders.cancel, { params: { id: gone } })).code, 409);
  assert.equal((await call(orders.receive, { params: { id: gone } })).code, 409);
});

test('sending needs a supplier, marks it ordered, and prepares the message', { skip }, async () => {
  const nobody = (await call(orders.createDraft, { body: { items: [{ description: 'x', quantity: 1, unit_cost: 1 }] } })).body.data.po_id;
  assert.equal((await call(orders.send, { params: { id: nobody } })).code, 400);

  await pool.query(`UPDATE purchase_orders SET expected_date = NULL WHERE po_id = $1`, [po]);   // let the lead time decide
  const sent = await call(orders.send, { params: { id: po }, body: {} });
  assert.equal(sent.code, 200);
  const s = sent.body.data;
  assert.equal(s.emailed, true, 'the supplier has an email');
  assert.match(s.message, /Order PO-\d+ from Cafe \(MG Road\)/);
  assert.match(s.message, /• 12 kg Chicken/);
  assert.match(s.message, /Please deliver by \d{4}-\d{2}-\d{2}/);
  assert.match(s.whatsapp_url, /^https:\/\/wa\.me\/919876543210\?text=/);
  const stored = await row(po);
  assert.equal(stored.status, 'ORDERED');
  assert.ok(stored.ordered_at);
  const days = Math.round((new Date(stored.expected_date) - new Date(stored.ordered_at)) / 86400000);
  assert.ok(days >= 1 && days <= 3, 'chicken has a two-day lead time');
  assert.deepEqual(await stock(chicken), { [A]: 3 }, 'still nothing in stock');

  // a supplier without contact details still gets a message to copy, and no email
  const plain = (await call(orders.createDraft, { body: { supplier_id: bare, items: [{ description: 'x', quantity: 1, unit_cost: 1 }] } })).body.data.po_id;
  const s2 = (await call(orders.send, { params: { id: plain } })).body.data;
  assert.deepEqual([s2.emailed, s2.whatsapp_url], [false, null]);
  await call(orders.cancel, { params: { id: plain } });
});

test('paying before the goods are received is refused', { skip }, async () => {
  const res = await call(purchases.addPayment, { params: { id: po }, body: { amount: 100 } });
  assert.equal(res.code, 409);
  assert.match(res.body.message, /Receive the order/);
});

test('receiving records what arrived, at the price charged, at the order’s own outlet', { skip }, async () => {
  const items = (await call(purchases.get, { params: { id: po } })).body.data.items;
  const chickenLine = items.find((i) => i.description === 'Chicken').item_id;
  // The buyer is looking at Indiranagar (a group user viewing another outlet); the delivery is still MG Road's.
  const res = await call(orders.receive, {
    branch: B, params: { id: po },
    body: { items: [{ item_id: chickenLine, received_quantity: 10, unit_cost: 230 }], payment: { amount: 1000, method: 'UPI' } }
  });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.data.short_delivered, ['Chicken'], '10 of 12 is a short delivery');
  assert.equal(res.body.data.status, 'RECEIVED');
  assert.equal(res.body.data.total, 10 * 230 + 5 * 90, 'the total follows what came, not what was ordered');
  assert.deepEqual([res.body.data.amount_paid, res.body.data.balance_due, res.body.data.payment_status], [1000, 1750, 'PARTIAL']);

  assert.deepEqual(await stock(chicken), { [A]: 13 }, 'MG Road got the chicken; Indiranagar did not');
  assert.equal((await stock(rice))[A], 515);
  assert.equal(await total(chicken), 13);
  assert.equal(Number((await pool.query(`SELECT purchase_price_paise FROM products WHERE product_id = $1`, [chicken])).rows[0].purchase_price_paise), 23000, 'cost follows the price paid');
  const ledger = (await pool.query(`SELECT branch_id, quantity FROM inventory_transactions WHERE reference_type = 'purchase_order' AND reference_id = $1 ORDER BY product_id`, [po])).rows;
  assert.deepEqual(ledger.map((l) => [l.branch_id, Number(l.quantity)]), [[A, 10], [A, 5]]);
  const stored = await row(po);
  assert.ok(stored.received_at);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE po_id = $1`, [po])).rows[0].n, 1);

  assert.equal((await call(orders.receive, { params: { id: po } })).code, 409, 'can’t be received twice');
  assert.equal((await call(orders.cancel, { params: { id: po } })).code, 409, 'or cancelled once received');
  // and now it can be paid
  assert.equal((await call(purchases.addPayment, { params: { id: po }, body: { amount: 1750 } })).code, 201);
});

test('a delivery that brought nothing, or a line that is not on the order, is refused', { skip }, async () => {
  const id = (await call(orders.createDraft, { body: { supplier_id: supplier, items: [{ product_id: rice, quantity: 4, unit_cost: 90 }] } })).body.data.po_id;
  const line = (await call(purchases.get, { params: { id } })).body.data.items[0].item_id;
  assert.equal((await call(orders.receive, { params: { id }, body: { items: [{ item_id: line, received_quantity: 0 }] } })).code, 400);
  assert.equal((await call(orders.receive, { params: { id }, body: { items: [{ item_id: 999999, received_quantity: 1 }] } })).code, 400);
  assert.equal((await call(orders.receive, { params: { id }, body: { items: [{ item_id: line, received_quantity: -2 }] } })).code, 400);
  assert.equal((await row(id)).status, 'DRAFT', 'nothing was half-applied');
  assert.equal((await stock(rice))[A], 515);
  // no body = delivered in full, straight from a draft
  const ok = await call(orders.receive, { params: { id } });
  assert.equal(ok.code, 200);
  assert.equal((await stock(rice))[A], 519);
});

test('outlets and businesses stay separate', { skip }, async () => {
  const id = (await call(orders.createDraft, { body: { supplier_id: supplier, items: [{ product_id: rice, quantity: 1, unit_cost: 90 }] } })).body.data.po_id;
  const pinnedB = { scopeBranchId: B, pinned: true, role: 'MANAGER' };
  for (const [name, fn, extra] of [['update', orders.update, { notes: 'x' }], ['send', orders.send, {}], ['cancel', orders.cancel, {}], ['receive', orders.receive, {}]]) {
    const res = await call(fn, { branch: B, tenant: pinnedB, params: { id }, body: extra });
    assert.equal(res.code, 404, `${name} at another outlet`);
  }
  const foreign = fakeRes();
  await orders.cancel({ tenant: { businessId: biz + 999, branchId: A, scopeBranchId: null }, auth: { userId: owner }, params: { id }, body: {}, ip: '127.0.0.1', headers: {} }, foreign);
  assert.equal(foreign.code, 404);
  assert.equal((await row(id)).status, 'DRAFT');
  await call(orders.cancel, { params: { id } });
  void other;
});

/* ── from the forecast ──────────────────────────────────────────────────── */

test('the forecast becomes one draft per supplier, and pressing it twice does not order twice', { skip }, async () => {
  // Ten weeks of sales at MG Road; chicken usage is high against 13 kg on hand (rice is plentiful).
  const base = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
  await pool.query(
    `INSERT INTO invoices (business_id, branch_id, invoice_number, invoice_date, total_paise, created_at)
     SELECT $1, $2, 'F-' || d::text || '-' || n, d, 10000, d + time '13:00'
     FROM generate_series(${base} - 70, ${base} - 1, interval '1 day') d, generate_series(1, 12) n WHERE n <= 5 + EXTRACT(DOW FROM d)`, [biz, A]);
  for (const [id, per] of [[chicken, 2], [rice, 0.5]]) {
    await pool.query(
      `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_at)
       SELECT $1, $2, $3, 'SALE', -$4::numeric * (5 + EXTRACT(DOW FROM d)), 'invoice', 1, d + time '13:00' FROM generate_series(${base} - 70, ${base} - 1, interval '1 day') d`, [biz, A, id, per]);
  }

  const first = await call(orders.fromForecast);
  assert.equal(first.code, 201);
  const made = first.body.data.orders;
  assert.equal(made.length, 1, 'only chicken needs ordering, and it has one supplier');
  assert.deepEqual([made[0].status, made[0].source, made[0].supplier_name], ['DRAFT', 'FORECAST', 'Halal Meats Co']);
  const lines = (await call(purchases.get, { params: { id: made[0].po_id } })).body.data.items;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, 'Chicken');
  assert.ok(lines[0].quantity > 0);
  assert.equal(lines[0].unit_cost, 230, 'at the latest price paid');
  assert.deepEqual(await stock(chicken), { [A]: 13 }, 'still only a draft');

  const again = await call(orders.fromForecast);
  assert.equal(again.body.data.orders.length, 0, 'what is already on order is not ordered again');
  assert.deepEqual(again.body.data.already_on_order, ['Chicken']);

  // Indiranagar has no history and no stock: nothing to suggest there.
  assert.equal((await call(orders.fromForecast, { branch: B })).body.data.orders.length, 0);
  // Cancelling the draft frees the need again.
  await call(orders.cancel, { params: { id: made[0].po_id } });
  assert.equal((await call(orders.fromForecast)).body.data.orders.length, 1);
});

test('open orders are listed by status', { skip }, async () => {
  await call(orders.createDraft, { body: { supplier_id: supplier, items: [{ description: 'x', quantity: 1, unit_cost: 1 }] } });
  const open = (await call(purchases.list, { tenant: {} })).body.data;
  assert.ok(open.length > 0);
  const onlyOpen = fakeRes();
  await purchases.list({ tenant: tenant(A), query: { status: 'DRAFT,ORDERED' } }, onlyOpen);
  assert.ok(onlyOpen.body.data.every((p) => ['DRAFT', 'ORDERED'].includes(p.status)));
  assert.ok(onlyOpen.body.data.length >= 1);
});
