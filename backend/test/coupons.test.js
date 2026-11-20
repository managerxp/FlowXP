/*
 * Mobile-number lookup and coupons. Pure rules run
 * anywhere; the rest run against a throwaway Postgres and skip without one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { couponDiscount } = await import('../src/modules/coupons.js');
const { normalisePhone } = await import('../src/modules/phone.js');
const loyalty = await import('../src/controllers/loyalty.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const publicOrdering = await import('../src/controllers/publicOrdering.controller.js');
const orders = await import('../src/controllers/orders.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── pure rules ─────────────────────────────────────────────────────────── */

test('mobile numbers are compared by their last ten digits', () => {
  assert.equal(normalisePhone('+91 98765-43210'), '9876543210');
  assert.equal(normalisePhone('098765 43210'), '9876543210');
  assert.equal(normalisePhone('12345'), null);
  assert.equal(normalisePhone(null), null);
});

test('coupon discount: percent with a cap, flat, never more than the bill', () => {
  assert.equal(couponDiscount({ kind: 'PERCENT', value: 10, max_discount_paise: null }, 50000), 5000);
  assert.equal(couponDiscount({ kind: 'PERCENT', value: 10, max_discount_paise: 3000 }, 50000), 3000);
  assert.equal(couponDiscount({ kind: 'FLAT', value: 5000, max_discount_paise: null }, 50000), 5000);
  assert.equal(couponDiscount({ kind: 'FLAT', value: 5000, max_discount_paise: null }, 2000), 2000);
});

/* ── database ───────────────────────────────────────────────────────────── */

let B; let dish; let dessert; let branchId; let owner; let ravi; let guest;
const tenantFor = (person, extra = {}) => ({ businessId: B, branchId, role: 'OWNER', permissions: {}, scopeBranchId: null, ...extra, person });
const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant: { businessId: B, branchId, role: 'OWNER', permissions: {} }, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

/** Bill one visit on a given day (defaults to a new day each call). */
let day = 0;
const visit = async (customerId, { items = [{ product_id: dish, quantity: 1 }], coupon, date, discount, by } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = date ?? new Date(Date.UTC(2025, 0, 1) + ++day * 86400000).toISOString().slice(0, 10);
    const inv = await createInvoiceInTransaction(client, { businessId: B, branchId }, by ?? owner, { customerId, items, couponCode: coupon, invoiceDate: d, discount, payment: { amount: 'FULL' } });
    await client.query('COMMIT');
    return inv;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};
const newCustomer = async (name, phone) => (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [B, name, phone])).rows[0].customer_id;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@l.test','x') RETURNING user_id`)).rows[0].user_id;
  ravi = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('ravi','r@l.test','x') RETURNING user_id`)).rows[0].user_id;
  B = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Cafe',$1,'RESTAURANT') RETURNING business_id`, [owner])).rows[0].business_id;
  branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [B])).rows[0].branch_id;
  const p = async (name, price) => (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,$2,'DISH',$3,5,FALSE) RETURNING product_id`, [B, name, price])).rows[0].product_id;
  dish = await p('Biryani', 30000); dessert = await p('Gulab Jamun', 8000);
  guest = await newCustomer('Guest', '9876543210');
});

test('the till finds a customer by mobile number however it was typed, and never across businesses', { skip }, async () => {
  const found = await call(loyalty.lookup, { query: { phone: '098765-43210' } });
  assert.equal(found.body.data.customer.name, 'Guest');
  assert.equal((await call(loyalty.lookup, { query: { phone: '9999999999' } })).body.data.customer, null);
  assert.equal((await call(loyalty.lookup, { query: { phone: '123' } })).code, 400);

  const otherUser = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('x','x@l.test','x') RETURNING user_id`)).rows[0].user_id;
  const other = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('Other',$1) RETURNING business_id`, [otherUser])).rows[0].business_id;
  const res = fakeRes();
  await loyalty.lookup({ tenant: { businessId: other }, query: { phone: '9876543210' } }, res);
  assert.equal(res.body.data.customer, null, 'another business does not know this customer');
  const card2 = fakeRes();
  await loyalty.customerCard({ tenant: { businessId: other }, params: { id: guest } }, card2);
  assert.equal(card2.code, 404);
});

/* ── coupons ────────────────────────────────────────────────────────────── */

test('coupons: create, validate input, and codes are unique regardless of case', { skip }, async () => {
  const make = (body) => call(loyalty.createCoupon, { body });
  assert.equal((await make({ code: 'x', kind: 'PERCENT', value: 10 })).code, 400);
  assert.equal((await make({ code: 'BIG', kind: 'PERCENT', value: 150 })).code, 400);
  assert.equal((await make({ code: 'BAD DATE', kind: 'FLAT', value: 10 })).code, 400);
  assert.equal((await make({ code: 'WELCOME10', kind: 'PERCENT', value: 10, min_bill: 200, max_discount: 50 })).code, 201);
  assert.equal((await make({ code: 'welcome10', kind: 'FLAT', value: 20 })).code, 409);
  assert.equal((await make({ code: 'FLAT50', kind: 'FLAT', value: 50, min_bill: 100 })).code, 201);
  assert.equal((await make({ code: 'ONCE', kind: 'FLAT', value: 30, max_uses_per_customer: 1 })).code, 201);
  assert.equal((await make({ code: 'TWICE', kind: 'FLAT', value: 30, max_uses: 2 })).code, 201);
  assert.equal((await make({ code: 'OLD', kind: 'FLAT', value: 30, valid_to: '2020-01-01' })).code, 201);
  assert.equal((await make({ code: 'LATER', kind: 'FLAT', value: 30, valid_from: '2999-01-01' })).code, 201);
  assert.equal((await make({ code: 'BACKWARDS', kind: 'FLAT', value: 30, valid_from: '2026-05-01', valid_to: '2026-04-01' })).code, 400);
});

test('a coupon comes off the bill, and is refused for every reason it should be', { skip }, async () => {
  const id = await newCustomer('Gita', '9000077777');
  const pct = await visit(id, { items: [{ product_id: dish, quantity: 1 }], coupon: 'welcome10' });    // case-insensitive
  // ₹300; 10% = ₹30, under the ₹50 cap
  assert.equal(pct.coupon_code, 'WELCOME10');
  assert.equal(pct.coupon_discount, 30);
  assert.equal(pct.total, 270);

  const big = await visit(await newCustomer('Hari', '9000088888'), { items: [{ product_id: dish, quantity: 4 }], coupon: 'WELCOME10' });
  assert.equal(big.coupon_discount, 50, 'capped');

  const refused = async (body, pattern) => {
    await assert.rejects(visit(body.customer, { items: body.items ?? [{ product_id: dish, quantity: 1 }], coupon: body.coupon }), pattern);
  };
  await refused({ coupon: 'NOPE' }, /isn’t valid/);
  await refused({ coupon: 'OLD' }, /expired/);
  await refused({ coupon: 'LATER' }, /isn’t active yet/);
  await refused({ coupon: 'WELCOME10', items: [{ product_id: dessert, quantity: 1 }] }, /at least ₹200/);
  await refused({ coupon: 'ONCE' }, /mobile number/);
  const inactive = await call(loyalty.updateCoupon, { params: { id: (await pool.query(`SELECT coupon_id FROM coupons WHERE code = 'FLAT50'`)).rows[0].coupon_id }, body: { is_active: false } });
  assert.equal(inactive.code, 200);
  await refused({ coupon: 'FLAT50' }, /isn’t valid/);
});

test('usage limits: per customer and in total, and a cancelled bill frees its use', { skip }, async () => {
  const id = await newCustomer('Isha', '9000099999');
  const first = await visit(id, { coupon: 'ONCE' });
  await assert.rejects(visit(id, { coupon: 'ONCE' }), /already used/);
  await call(invoices.cancel, { params: { id: first.invoice_id } });
  await visit(id, { coupon: 'ONCE' });                                    // available again

  const a = await newCustomer('J1', '9111100001'); const b = await newCustomer('J2', '9111100002'); const c = await newCustomer('J3', '9111100003');
  await visit(a, { coupon: 'TWICE' }); await visit(b, { coupon: 'TWICE' });
  await assert.rejects(visit(c, { coupon: 'TWICE' }), /fully used/);

  const list = (await call(loyalty.listCoupons)).body.data;
  assert.equal(list.find((x) => x.code === 'TWICE').used, 2);
  assert.ok(list.find((x) => x.code === 'ONCE').discount_given > 0);
});

test('checking a coupon previews the discount without using it', { skip }, async () => {
  const check = (body) => call(loyalty.checkCoupon, { body });
  const ok = await check({ code: 'WELCOME10', total: 315 });
  assert.equal(ok.body.data.discount, 31.5, 'the preview works from the total it is sent');
  assert.equal((await check({ code: 'WELCOME10', total: 100 })).code, 400);
  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE voided_at IS NULL`)).rows[0].n;
  await check({ code: 'WELCOME10', total: 315 });
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE voided_at IS NULL`)).rows[0].n, before);
});

test('coupons are not counted as hand-given discounts, but a hand-given discount of the same size is', { skip }, async () => {
  const { collect } = await import('../src/modules/leakage.js');
  await call(loyalty.createCoupon, { body: { code: 'BIG', kind: 'FLAT', value: 250 } });
  for (let n = 0; n < 30; n++) await visit(undefined, { date: '2026-04-01' });   // the usual undiscounted bills by the owner, for comparison
  // Twenty-five bills by Ravi, each with a ₹250 coupon; everyone else's bills carry no discount.
  for (let n = 0; n < 25; n++) await visit(undefined, { by: ravi, coupon: 'BIG', date: '2026-05-01' });
  const withCoupons = await collect(B, '2026-01-01', '2026-12-31');
  assert.equal(withCoupons.findings.some((f) => f.type === 'discount_outlier'), false, 'coupons are policy, not a person’s discretion');

  for (let n = 0; n < 25; n++) await visit(undefined, { by: ravi, discount: 250, date: '2026-05-02' });
  const byHand = await collect(B, '2026-01-01', '2026-12-31');
  assert.equal(byHand.findings.some((f) => f.type === 'discount_outlier'), true, 'the same amount given by hand is still noticed');
});

/* ── QR menu ────────────────────────────────────────────────────────────── */

test('staff can attach a customer to an open tab, only within their own business and outlet', { skip }, async () => {
  const table = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'T9','set-cust') RETURNING table_id`, [B, branchId])).rows[0].table_id;
  const created = await call(orders.create, { body: { order_type: 'DINE_IN', table_id: table } });
  const orderId = created.body.data.order_id;
  const who = await newCustomer('Latha', '9333300000');
  assert.equal((await call(orders.setCustomer, { params: { id: orderId }, body: { customer_id: who } })).code, 200);
  assert.equal((await pool.query(`SELECT customer_id FROM orders WHERE order_id = $1`, [orderId])).rows[0].customer_id, who);
  assert.equal((await call(orders.setCustomer, { params: { id: orderId }, body: { customer_id: 999999 } })).code, 400, 'not one of this business’s customers');
  assert.equal((await call(orders.setCustomer, { params: { id: orderId }, body: { customer_id: null } })).code, 200, 'and it can be cleared');
  assert.equal((await call(orders.setCustomer, { params: { id: 999999 }, body: { customer_id: who } })).code, 404);
  // another outlet's user (pinned elsewhere) can't reach it
  assert.equal((await call(orders.setCustomer, { tenant: { businessId: B, branchId: branchId + 1000, scopeBranchId: branchId + 1000, role: 'OWNER', permissions: {} }, params: { id: orderId }, body: { customer_id: who } })).code, 404);
});
