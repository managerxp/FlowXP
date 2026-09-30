/*
 * Split payments at the till, and bills put on hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const held = await import('../src/controllers/heldBills.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let T;
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@split.test`])).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RETAIL') RETURNING business_id`, [label, user])).rows[0].business_id;
  const main = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const second = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Second') RETURNING branch_id`, [biz])).rows[0].branch_id;
  const call = async (fn, extra = {}, branchId = main) => {
    const res = fakeRes();
    await fn({ tenant: { businessId: biz, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} }, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res);
    return res;
  };
  const item = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Shirt',99900,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const customer = (await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1,'Asha') RETURNING customer_id`, [biz])).rows[0].customer_id;
  return { biz, main, second, call, item, customer };
};
const pays = async (invoiceId) => (await pool.query(`SELECT payment_method AS m, amount_paise::bigint AS a FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [invoiceId])).rows.map((r) => [r.m, Number(r.a)]);
const bill = (t, body) => t.call(invoices.create, { body: { items: [{ product_id: t.item, quantity: 2 }], ...body } });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  T = await makeBusiness('shop'); T.other = await makeBusiness('rival');
});

/* ── split payments ─────────────────────────────────────────────────────── */

test('a bill split between cash and "the rest" by UPI is paid in full, as two payments', { skip }, async () => {
  const res = await bill(T, { payments: [{ method: 'CASH', amount: 500 }, { method: 'UPI', amount: 'REST' }] });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const inv = res.body.data;
  const total = Math.round(inv.total * 100);
  assert.equal(inv.payment_status, 'PAID');
  assert.deepEqual(await pays(inv.invoice_id), [['CASH', 50000], ['UPI', total - 50000]], 'the UPI part is exactly what the cash left');
  assert.deepEqual(inv.payments_taken.map((p) => p.method), ['CASH', 'UPI']);
});

test('split parts that leave something over make a part-paid bill', { skip }, async () => {
  const inv = (await bill(T, { payments: [{ method: 'CASH', amount: 300 }, { method: 'CARD', amount: 200 }] })).body.data;
  assert.equal(inv.payment_status, 'PARTIAL');
  assert.equal(Math.round(inv.balance_due * 100), Math.round(inv.total * 100) - 50000);
  assert.deepEqual(await pays(inv.invoice_id), [['CASH', 30000], ['CARD', 20000]]);
});

test('payments that add up to more than the bill are refused, and nothing is billed', { skip }, async () => {
  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [T.biz])).rows[0].n;
  const res = await bill(T, { payments: [{ method: 'CASH', amount: 2000 }, { method: 'UPI', amount: 500 }] });
  assert.equal(res.code, 400);
  assert.match(res.body.message, /more than the bill/);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [T.biz])).rows[0].n, before);
});

test('cash handed over above the bill records the bill, not the note (the rest is change)', { skip }, async () => {
  const inv = (await bill(T, { payment: { method: 'CASH', amount: 5000 } })).body.data;
  const total = Math.round(inv.total * 100);
  assert.equal(inv.payment_status, 'PAID');
  assert.equal(Math.round(inv.balance_due * 100), 0);
  assert.deepEqual(await pays(inv.invoice_id), [['CASH', total]]);
});

test('a split needs sensible parts: one "rest" at most, known methods, amounts above zero', { skip }, async () => {
  assert.match((await bill(T, { payments: [{ method: 'CASH', amount: 'REST' }, { method: 'UPI', amount: 'REST' }] })).body.message, /Only one part/);
  assert.match((await bill(T, { payments: [{ method: 'BITCOIN', amount: 'REST' }] })).body.message, /Unknown payment method/);
  assert.match((await bill(T, { payments: [{ method: 'CASH', amount: 0 }, { method: 'UPI', amount: 'REST' }] })).body.message, /above zero/);
  const seven = Array.from({ length: 7 }, () => ({ method: 'CASH', amount: 1 }));
  assert.match((await bill(T, { payments: seven })).body.message, /at most 6/);
});

test('one payment still works as before, "FULL" included', { skip }, async () => {
  const inv = (await bill(T, { payment: { method: 'CARD', amount: 'FULL' } })).body.data;
  assert.equal(inv.payment_status, 'PAID');
  assert.deepEqual(await pays(inv.invoice_id), [['CARD', Math.round(inv.total * 100)]]);
  const none = (await bill(T, {})).body.data;
  assert.equal(none.payment_status, 'UNPAID');
  assert.deepEqual(await pays(none.invoice_id), []);
});

/* ── held bills ─────────────────────────────────────────────────────────── */

const sample = (t) => ({ lines: [{ product_id: t.item, name: 'Shirt', unit_price: 999, quantity: 2, discount: 50, tax_rate: 5 }, { custom: true, name: 'Alteration', unit_price: 150, quantity: 1 }], customer_id: t.customer, customer_name: 'Asha', coupon_code: 'DIWALI', notes: 'Gift wrap' });

test('a held bill is kept for its outlet, comes back as it was, and goes when resumed', { skip }, async () => {
  const res = await T.call(held.hold, { body: { label: 'Blue shirt lady', bill: sample(T), estimate: 2098.5 } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const h = res.body.data;
  assert.equal(h.label, 'Blue shirt lady');
  assert.equal(h.item_count, 3);
  assert.equal(h.estimate, 2098.5);

  const here = (await T.call(held.list)).body.data;
  assert.deepEqual(here.map((x) => x.hold_id), [h.hold_id]);
  assert.equal(here[0].bill.lines[0].discount, 50);
  assert.equal(here[0].bill.lines[1].custom, true);
  assert.equal(here[0].bill.coupon_code, 'DIWALI');
  assert.equal(here[0].held_by, 'shop');

  assert.deepEqual((await T.call(held.list, {}, T.second)).body.data, [], 'another outlet does not see it');
  assert.equal((await T.call(held.remove, { params: { id: h.hold_id } }, T.second)).code, 404, 'or resume it');
  assert.equal((await T.other.call(held.remove, { params: { id: h.hold_id } })).code, 404, 'nor does another business');

  assert.equal((await T.call(held.remove, { params: { id: h.hold_id } })).code, 200);
  assert.equal((await T.call(held.remove, { params: { id: h.hold_id } })).code, 404, 'resumed once, it is gone');
  assert.deepEqual((await T.call(held.list)).body.data, []);
});

test('holding needs something on the bill and a customer of this business', { skip }, async () => {
  assert.equal((await T.call(held.hold, { body: { bill: { lines: [] } } })).code, 400);
  const foreign = { ...sample(T), customer_id: T.other.customer };
  assert.equal((await T.call(held.hold, { body: { bill: foreign } })).code, 404);
  const walkIn = await T.call(held.hold, { body: { bill: { lines: sample(T).lines } } });
  assert.equal(walkIn.code, 201);
  assert.equal(walkIn.body.data.label, null);
  await T.call(held.remove, { params: { id: walkIn.body.data.hold_id } });
});
