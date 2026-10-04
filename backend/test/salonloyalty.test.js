/*
 * Salon loyalty: earning by kind of sale, redemption rules, expiry, manual adjustment and reversal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addClient, addService, addStaff, addStock, fakeRes, makeSalon, sell } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createSalonInvoice } = await import('../src/modules/salon/pos.js');
const { expirePoints, expiringPoints, earnedPoints } = await import('../src/modules/salon/loyalty.js');
const loyalty = (await import('../src/controllers/salonLoyalty.controller.js')).default;
const points = await import('../src/controllers/points.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const creditNotes = await import('../src/controllers/creditNotes.controller.js');

test.after(cleanup);

let S; let st; let haircut; let shampoo;
const go = (input, opts) => sell(pool, createSalonInvoice, S, input, opts);
const balance = async (id) => Number((await pool.query(`SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE business_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [S.businessId, id])).rows[0].n);
const give = (id, pts, kind = 'EARN', daysAgo = 0) => pool.query(
  `INSERT INTO points_ledger (business_id, customer_id, kind, points, created_at) VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval)`, [S.businessId, id, kind, pts, String(daysAgo)]);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeSalon(pool, 'loy');
  st = await addStaff(pool, S, { name: 'Ravi' });
  haircut = await addService(pool, S, { name: 'Haircut', price: 500, tax: 18 });
  shampoo = await addStock(pool, S, { name: 'Shampoo', price: 400, cost: 200, tax: 18, stock: 50 });
  await pool.query(`INSERT INTO points_programs (business_id, is_enabled, earn_per_100, point_value_paise, min_redeem_points, max_redeem_pct, expiry_days) VALUES ($1,TRUE,5,100,50,50,365)`, [S.businessId]);
});

test('the earning rules are configured, validated and audited', { skip }, async () => {
  const bad = await S.call(loyalty.put, { body: { rules: { SERVICE: { earn_per_100: 500 } } } });
  assert.equal(bad.code, 400);
  const unknown = await S.call(loyalty.put, { body: { rules: { FOOD: { earn_per_100: 1 } } } });
  assert.equal(unknown.code, 400);
  const short = await S.call(loyalty.put, { body: { expiry_days: 5 } });
  assert.equal(short.code, 400);
  const ok = await S.call(loyalty.put, { body: { expiry_days: 180, rules: { SERVICE: { earn_per_100: 10 }, PRODUCT: { earn_per_100: 2 }, PACKAGE: { earn_per_100: 1, is_enabled: false } } } });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.expiry_days, 180);
  assert.equal(ok.body.data.rules.SERVICE.earn_per_100, 10);
  assert.equal(ok.body.data.rules.MEMBERSHIP.earn_per_100, null, 'no rule: the program\'s own rate applies');
  assert.equal((await pool.query(`SELECT COUNT(*) AS n FROM audit_log WHERE business_id = $1 AND action = 'salon.loyalty_rules_changed'`, [S.businessId])).rows[0].n === '0', false);
  await pool.query(`UPDATE points_programs SET expiry_days = 365 WHERE business_id = $1`, [S.businessId]);
});

test('points are earned at a different rate for services and products', { skip }, async () => {
  const c = await addClient(pool, S, 'Earner');
  const out = await go({ customer_id: c, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }, { type: 'PRODUCT', product_id: shampoo, quantity: 1 }] });
  // service ₹590 at 10 per ₹100 = 59; product ₹472 at 2 per ₹100 = 9.44; together 68.44 -> 68
  assert.equal(out.invoice.points_earned, 68);
  assert.equal(await balance(c), 68);
});

test('a kind of sale switched off earns nothing; gift cards never earn', { skip }, async () => {
  const c = await addClient(pool, S, 'Gifter');
  const out = await go({ customer_id: c, items: [{ type: 'GIFT_CARD', amount: 1000 }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal(out.invoice.points_earned, 0);
  const fn = earnedPoints({
    lines: [{ line_total_paise: 10000, type: 'PACKAGE' }], finalTotalPaise: 10000, state: null, cfg: { program: { earn_per_100: 5 } },
    rules: new Map([['PACKAGE', { earn_per_100: 1, is_enabled: false }]])
  });
  assert.equal(fn, 0);
});

test('invoice-level discounts reduce what points are earned on', { skip }, async () => {
  const pure = earnedPoints({ lines: [{ line_total_paise: 59000, type: 'SERVICE' }], finalTotalPaise: 29500, state: null, cfg: { program: { earn_per_100: 5 } }, rules: new Map([['SERVICE', { earn_per_100: 10, is_enabled: true }]]) });
  assert.equal(pure, 29, '10 per ₹100 on the ₹295 actually paid');
  const tier = earnedPoints({ lines: [{ line_total_paise: 10000, type: 'SERVICE' }], finalTotalPaise: 10000, state: { tier: { multiplier: 2 } }, cfg: { program: { earn_per_100: 5 } }, rules: new Map() });
  assert.equal(tier, 10, 'a tier multiplier doubles 5 per ₹100');
});

test('redeeming: a discount against services and products, capped and checked', { skip }, async () => {
  const c = await addClient(pool, S, 'Spender');
  await give(c, 300);
  const out = await go({ customer_id: c, redeem_points: 100, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }] });
  assert.equal(out.invoice.points_redeemed, 100);
  assert.equal(out.invoice.points_discount, 100);
  assert.equal(out.invoice.total, 490);
  const after = await balance(c);
  assert.equal(after, 300 - 100 + out.invoice.points_earned);

  await assert.rejects(() => go({ customer_id: c, redeem_points: 10, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }] }), /least you can use/);
  await assert.rejects(() => go({ customer_id: c, redeem_points: 100000, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }] }), /available|at most|can pay/i);
  await assert.rejects(() => go({ redeem_points: 100, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }] }), /Choose a customer/);
  // more than half the eligible bill
  await give(c, 1000);
  await assert.rejects(() => go({ customer_id: c, redeem_points: 400, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }] }), /at most 50%/);
});

test('an item marked not redeemable cannot be paid for with points', { skip }, async () => {
  const c = await addClient(pool, S, 'Picky');
  await give(c, 500);
  const promo = await addService(pool, S, { name: 'Promo service', price: 300, tax: 0 });
  await pool.query(`UPDATE salon_item_details SET points_redeemable = FALSE WHERE product_id = $1`, [promo]);
  await assert.rejects(() => go({ customer_id: c, redeem_points: 50, items: [{ type: 'SERVICE', service_id: promo, staff_id: st }] }), /cannot be used on the items/);
  const both = await go({ customer_id: c, redeem_points: 50, items: [{ type: 'SERVICE', service_id: promo, staff_id: st }, { type: 'SERVICE', service_id: haircut, staff_id: st }] });
  assert.equal(both.invoice.points_redeemed, 50, 'the haircut is eligible');
});

test('a service marked not earnable earns no points', { skip }, async () => {
  const c = await addClient(pool, S, 'NoEarn');
  const free = await addService(pool, S, { name: 'Consult', price: 200, tax: 0 });
  await pool.query(`UPDATE salon_item_details SET points_earnable = FALSE WHERE product_id = $1`, [free]);
  const out = await go({ customer_id: c, items: [{ type: 'SERVICE', service_id: free, staff_id: st }] });
  assert.equal(out.invoice.points_earned, 0);
});

test('cancelling a bill gives back redeemed points and removes earned ones', { skip }, async () => {
  const c = await addClient(pool, S, 'Canceller');
  await give(c, 200);
  const out = await go({ customer_id: c, redeem_points: 60, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }] });
  const res = fakeRes();
  await invoices.cancel(S.req({ params: { id: out.invoice.invoice_id } }), res);
  assert.equal(res.code, 200);
  assert.equal(await balance(c), 200);
});

test('a credit note takes back the points the bill earned', { skip }, async () => {
  const c = await addClient(pool, S, 'Returner');
  const out = await go({ customer_id: c, items: [{ type: 'SERVICE', service_id: haircut, staff_id: st }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal(await balance(c), 59);
  const item = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [out.invoice.invoice_id])).rows[0];
  const res = fakeRes();
  await creditNotes.create(S.req({ params: { id: out.invoice.invoice_id }, body: { items: [{ item_id: item.item_id, quantity: 1 }], reason: 'Refund', refund: { method: 'CASH' } } }), res);
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(await balance(c), 0);
  assert.equal((await pool.query(`SELECT COUNT(*) AS n FROM points_ledger WHERE customer_id = $1 AND kind = 'REVERSAL'`, [c])).rows[0].n, '1');
});

test('manual adjustment is a ledger entry with a reason, never below zero', { skip }, async () => {
  const c = await addClient(pool, S, 'Goodwill');
  const up = await S.call(points.adjust, { params: { id: c }, body: { points: 100, note: 'Sorry for the wait' } });
  assert.equal(up.code, 200);
  const down = await S.call(points.adjust, { params: { id: c }, body: { points: -500, note: 'fix' } });
  assert.equal(down.code, 409);
  const noReason = await S.call(points.adjust, { params: { id: c }, body: { points: 10 } });
  assert.equal(noReason.code, 400);
  assert.equal(await balance(c), 100);
});

test('expiry: old points lapse, what was spent counts against the oldest, and running it twice changes nothing', { skip }, async () => {
  const c = await addClient(pool, S, 'Expirer');
  await give(c, 100, 'EARN', 400);   // a year and a bit ago
  await give(c, 50, 'EARN', 10);
  await give(c, -30, 'REDEEM', 5);
  const first = await expirePoints(pool, S.businessId, 365);
  assert.deepEqual(first, { customers: 1, points: 70 }, '100 old - 30 spent against the oldest');
  assert.equal(await balance(c), 50);
  const second = await expirePoints(pool, S.businessId, 365);
  assert.equal(second.points, 0);
  assert.equal(await balance(c), 50);
  assert.equal((await pool.query(`SELECT COUNT(*) AS n FROM points_ledger WHERE customer_id = $1 AND kind = 'EXPIRE'`, [c])).rows[0].n, '1');

  const spender = await addClient(pool, S, 'Spent it');
  await give(spender, 100, 'EARN', 400);
  await give(spender, 100, 'EARN', 10);
  await give(spender, -120, 'REDEEM', 5);
  assert.equal((await expirePoints(pool, S.businessId, 365)).points, 0, 'the old points were spent first, so nothing lapses');
  assert.equal(await balance(spender), 80);
});

test('points that are about to expire are reported', { skip }, async () => {
  const c = await addClient(pool, S, 'Soon');
  await give(c, 80, 'EARN', 350);   // expires in 15 days of a 365-day life
  await give(c, 40, 'EARN', 20);
  assert.equal(await expiringPoints(pool, S.businessId, c, 365, 30), 80);
  assert.equal(await expiringPoints(pool, S.businessId, c, 365, 10), 0);
});

test('the loyalty summary adds up issued, redeemed, expired and what is owed', { skip }, async () => {
  const res = await S.call(loyalty.summary, { query: { days: 365 } });
  assert.equal(res.code, 200);
  const d = res.body.data;
  assert.ok(d.issued > 0 && d.redeemed > 0 && d.expired >= 70);
  assert.equal(d.outstanding_points, Number((await pool.query(`SELECT SUM(points) AS n FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL`, [S.businessId])).rows[0].n));
  assert.equal(d.liability, d.outstanding_points, 'a point is worth ₹1 here');
});

test('expiring on demand needs an expiry period', { skip }, async () => {
  await pool.query(`UPDATE points_programs SET expiry_days = NULL WHERE business_id = $1`, [S.businessId]);
  const res = await S.call(loyalty.expireNow);
  assert.equal(res.code, 409);
  await pool.query(`UPDATE points_programs SET expiry_days = 365 WHERE business_id = $1`, [S.businessId]);
  assert.equal((await S.call(loyalty.expireNow)).code, 200);
});
