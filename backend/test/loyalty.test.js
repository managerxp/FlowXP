/*
 * Loyalty (every Nth visit free, by mobile number) and coupons. Pure rules run
 * anywhere; the rest run against a throwaway Postgres and skip without one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { couponDiscount } = await import('../src/modules/coupons.js');
const { normalisePhone, describe } = await import('../src/modules/loyalty.js');
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

test('the card says what is left in plain words', () => {
  const program = { visits_required: 7, reward_quantity: 1, reward_name: 'Gulab Jamun' };
  assert.match(describe(program, { stamps: 2, reward_ready: false }).message, /4 more visits, then Gulab Jamun is free/);
  assert.match(describe(program, { stamps: 5, reward_ready: false }).message, /1 more visit,/);
  assert.match(describe(program, { stamps: 6, reward_ready: false }).message, /next visit/);
  assert.match(describe(program, { stamps: 6, reward_ready: true }).message, /Free Gulab Jamun on this visit/);
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
const card = async (customerId) => (await call(loyalty.customerCard, { params: { id: customerId } })).body.data.loyalty;
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

test('the owner sets the program, and it is validated', { skip }, async () => {
  const set = (body) => call(loyalty.putProgram, { body });
  assert.equal((await set({ is_enabled: true, visits_required: 7 })).code, 400, 'needs a free item before it can be switched on');
  assert.equal((await set({ is_enabled: true, visits_required: 1, reward_product_id: dessert })).code, 400);
  assert.equal((await set({ is_enabled: true, visits_required: 7, reward_product_id: 99999 })).code, 400, 'someone else’s or missing product');
  assert.equal((await set({ is_enabled: true, visits_required: 7, reward_product_id: dessert, reward_quantity: 1 })).code, 200);
  const got = (await call(loyalty.getProgramSettings)).body.data;
  assert.deepEqual([got.is_enabled, got.visits_required, got.reward_name], [true, 7, 'Gulab Jamun']);
});

test('six visits earn six stamps and the seventh visit gets the item free, then the card starts again', { skip }, async () => {
  const id = await newCustomer('Asha', '+91 90000 11111');
  for (let n = 1; n <= 6; n++) {
    const inv = await visit(id, { items: [{ product_id: dish, quantity: 1 }, { product_id: dessert, quantity: 1 }] });
    assert.equal(inv.loyalty_reward, null, `visit ${n} is paid`);
    assert.equal((await card(id)).stamps, n);
  }
  assert.equal((await card(id)).reward_ready, true);

  const seventh = await visit(id, { items: [{ product_id: dish, quantity: 1 }, { product_id: dessert, quantity: 2 }] });
  assert.deepEqual(seventh.loyalty_reward, { item: 'Gulab Jamun', amount: 80 }, 'one dessert free, the second is charged');
  assert.equal(seventh.loyalty_discount, 80);
  // 300 + 2×80 = 460, less the free 80 = 380 (this business has GST switched off)
  assert.equal(seventh.subtotal, 380);
  assert.equal(seventh.total, 380);
  const after = await card(id);
  assert.deepEqual([after.stamps, after.rewards_redeemed, after.reward_ready], [0, 1, false]);

  // and the next cycle needs six new stamps
  await visit(id);
  assert.equal((await card(id)).stamps, 1);
});

test('the reward waits until the item is on the bill, and only applies once', { skip }, async () => {
  const id = await newCustomer('Bala', '9000022222');
  for (let n = 0; n < 6; n++) await visit(id);
  const plain = await visit(id, { items: [{ product_id: dish, quantity: 1 }] });   // seventh visit, no dessert
  assert.equal(plain.loyalty_reward, null);
  assert.equal((await card(id)).reward_ready, true, 'still owed: it applies on the next visit that includes the item');
  const next = await visit(id, { items: [{ product_id: dessert, quantity: 3 }] });
  assert.equal(next.loyalty_reward.amount, 80, 'only the reward quantity is free');
});

test('a second bill on the same day is the same visit; a reward can still be taken on it', { skip }, async () => {
  const id = await newCustomer('Chitra', '9000033333');
  await visit(id, { date: '2026-04-01' });
  await visit(id, { date: '2026-04-01' });    // the table split its bill
  assert.equal((await card(id)).stamps, 1);

  for (let n = 2; n <= 6; n++) await visit(id, { date: `2026-04-${String(n).padStart(2, '0')}` });
  assert.equal((await card(id)).stamps, 6);
  await visit(id, { date: '2026-04-07' });                                        // 7th day, no dessert: stamp only
  const later = await visit(id, { date: '2026-04-07', items: [{ product_id: dessert, quantity: 1 }] });
  assert.equal(later.loyalty_reward.amount, 80, 'the seventh day’s earlier stamp becomes the reward visit');
  const c = await card(id);
  assert.deepEqual([c.stamps, c.rewards_redeemed], [0, 1]);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM loyalty_events WHERE customer_id = $1 AND visit_date = '2026-04-07' AND voided_at IS NULL`, [id])).rows[0].n, 1, 'still one event that day');
});

test('cancelling the reward bill gives the reward back; cancelling a stamp bill takes the stamp away', { skip }, async () => {
  const id = await newCustomer('Dev', '9000044444');
  const bills = [];
  for (let n = 0; n < 6; n++) bills.push(await visit(id));
  const reward = await visit(id, { items: [{ product_id: dessert, quantity: 1 }] });
  assert.equal(reward.loyalty_reward.amount, 80);
  assert.equal((await card(id)).rewards_redeemed, 1);

  const cancel = (inv) => call(invoices.cancel, { params: { id: inv.invoice_id } });
  assert.equal((await cancel(reward)).code, 200);
  let c = await card(id);
  assert.deepEqual([c.stamps, c.rewards_redeemed], [6, 0]);
  assert.equal(c.reward_ready, true, 'still owed');

  assert.equal((await cancel(bills[5])).code, 200);
  c = await card(id);
  assert.equal(c.stamps, 5);
});

test('walk-ins and customers of a switched-off program are never counted', { skip }, async () => {
  const walkIn = await visit(undefined);
  assert.equal(walkIn.loyalty_reward, null);
  const id = await newCustomer('Esha', '9000055555');
  await call(loyalty.putProgram, { body: { is_enabled: false, visits_required: 7, reward_product_id: dessert } });
  await visit(id);
  assert.equal((await card(id)), null);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM loyalty_events WHERE customer_id = $1`, [id])).rows[0].n, 0);
  await call(loyalty.putProgram, { body: { is_enabled: true, visits_required: 7, reward_product_id: dessert } });
});

test('a minimum bill decides whether a visit counts', { skip }, async () => {
  await call(loyalty.putProgram, { body: { is_enabled: true, visits_required: 7, reward_product_id: dessert, min_bill: 200 } });
  const id = await newCustomer('Farah', '9000066666');
  await visit(id, { items: [{ product_id: dessert, quantity: 1 }] });    // ₹84 — too small
  assert.equal((await card(id)).stamps, 0);
  await visit(id, { items: [{ product_id: dish, quantity: 1 }] });       // ₹315
  assert.equal((await card(id)).stamps, 1);
  await call(loyalty.putProgram, { body: { is_enabled: true, visits_required: 7, reward_product_id: dessert, min_bill: 0 } });
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
  // Twenty-five bills by Ravi, each with a ₹250 coupon; everyone else's bills carry no discount.
  for (let n = 0; n < 25; n++) await visit(undefined, { by: ravi, coupon: 'BIG', date: '2026-05-01' });
  const withCoupons = await collect(B, '2026-01-01', '2026-12-31');
  assert.equal(withCoupons.findings.some((f) => f.type === 'discount_outlier'), false, 'coupons are policy, not a person’s discretion');

  for (let n = 0; n < 25; n++) await visit(undefined, { by: ravi, discount: 250, date: '2026-05-02' });
  const byHand = await collect(B, '2026-01-01', '2026-12-31');
  assert.equal(byHand.findings.some((f) => f.type === 'discount_outlier'), true, 'the same amount given by hand is still noticed');
});

/* ── QR menu ────────────────────────────────────────────────────────────── */

test('a customer sees their card on the QR menu, and ordering with a number links the visit to them', { skip }, async () => {
  const token = 'loyalty-token';
  await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'T1',$3)`, [B, branchId, token]);

  const menu = fakeRes();
  await publicOrdering.getMenu({ params: { token } }, menu);
  assert.deepEqual([menu.body.data.loyalty.visits_required, menu.body.data.loyalty.reward_item], [7, 'Gulab Jamun']);

  const lookup = async (phone) => { const res = fakeRes(); await publicOrdering.loyaltyCard({ params: { token }, body: { phone } }, res); return res; };
  const unknown = await lookup('9222200000');
  assert.equal(unknown.code, 200);
  assert.deepEqual([unknown.body.data.member, unknown.body.data.stamps], [false, 0]);
  assert.equal(Object.keys(unknown.body.data).includes('name'), false, 'no personal details are returned');
  assert.equal((await lookup('12')).code, 400);
  const bad = fakeRes();
  await publicOrdering.loyaltyCard({ params: { token: 'nope' }, body: { phone: '9222200000' } }, bad);
  assert.equal(bad.code, 404);

  // place an order with a mobile number: the customer is created and attached to the order
  const placed = fakeRes();
  await publicOrdering.placeOrder({ params: { token }, body: { customer_phone: '92222 00000', customer_name: 'Kabir', items: [{ product_id: dish, quantity: 1 }] }, ip: '127.0.0.1', headers: {} }, placed);
  assert.equal(placed.code, 201);
  const linked = (await pool.query(`SELECT c.name, c.phone FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_number = $1`, [placed.body.data.order_number])).rows[0];
  assert.deepEqual(linked, { name: 'Kabir', phone: '9222200000' });

  // staff bill that order: the visit lands on the card without anyone typing the number again
  const orderId = (await pool.query(`SELECT order_id FROM orders WHERE order_number = $1`, [placed.body.data.order_number])).rows[0].order_id;
  const billed = fakeRes();
  await orders.bill({ tenant: { businessId: B, branchId, role: 'OWNER', permissions: {} }, auth: { userId: owner }, params: { id: orderId }, body: { payment: { amount: 'FULL' } }, query: {}, headers: {}, ip: '127.0.0.1' }, billed);
  assert.equal(billed.code, 201);
  assert.equal((await lookup('9222200000')).body.data.stamps, 1);
  assert.equal((await lookup('+91 92222 00000')).body.data.member, true);

  // ordering again with the same number reuses the customer
  const again = fakeRes();
  await publicOrdering.placeOrder({ params: { token }, body: { customer_phone: '9222200000', items: [{ product_id: dish, quantity: 1 }] }, ip: '127.0.0.1', headers: {} }, again);
  assert.equal(again.code, 201);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND phone = '9222200000'`, [B])).rows[0].n, 1);
});

test('the summary counts members, rewards and coupon use', { skip }, async () => {
  const s = (await call(loyalty.summary)).body.data;
  assert.ok(s.members >= 5);
  assert.ok(s.rewards_redeemed >= 1);
  assert.ok(s.coupon_uses_30d >= 0);
  assert.ok(Array.isArray(s.regulars) && s.regulars.length > 0);
  void tenantFor; void ravi;
});

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
