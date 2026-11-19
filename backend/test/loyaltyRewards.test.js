/*
 * Loyalty engine, phase 2: rewards and claims, and the two automatic hooks (a bill credits the customer's programmes, a credit note takes the share back, a cancel puts everything back).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const ctl = await import('../src/controllers/loyaltyEngine.controller.js');

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let T; let other;
const make = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@rw.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, get: () => undefined, ip: '127.0.0.1', ...extra }, res); return res; };
  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Thali',25000,FALSE) RETURNING product_id`, [biz.business_id])).rows[0].product_id;
  const customer = async (name, phone) => (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [biz.business_id, name, phone])).rows[0].customer_id;
  const bill = (customerId, qty = 1) => call(invoices.create, { body: { customer_id: customerId, items: [{ product_id: dish, quantity: qty }] } });
  return { businessId: biz.business_id, call, customer, bill };
};
const programme = async (biz, over = {}) => (await pool.query(
  `INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points, settings)
   VALUES ($1,'Points','POINTS',10,10000,100,5000,100,$2) RETURNING *`, [biz.businessId, over.settings || {}])).rows[0];
const balance = async (membershipId) => (await engine.balanceOf(pool, membershipId)).balance;

test('setup', { skip }, async () => { await runMigrations(pool); T = await make('t'); other = await make('o'); });

test('rewards: listed with what is affordable; a claim spends the exact points once and is recorded', { skip }, async () => {
  const p = await programme(T);
  const asha = await T.customer('Asha', '9876500101');
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: T.businessId, programmeId: p.programme_id, customerId: asha }))).membership;
  await withTransaction((c) => engine.earn(c, { businessId: T.businessId, membershipId: m.membership_id, amountPaise: 100000, key: 'seed' }));   // 100 points
  const make1 = async (b) => (await T.call(ctl.createReward, { body: { programme_id: p.programme_id, ...b } }));
  const coffee = (await make1({ name: 'Free coffee', points_cost: 60, value_paise: 12000, max_per_member: 1 })).body.data;
  const big = (await make1({ name: 'Free thali', points_cost: 300, value_paise: 25000 })).body.data;
  assert.equal((await make1({ name: '', points_cost: 5 })).code, 400);
  assert.equal((await make1({ name: 'x', points_cost: 0 })).code, 400);

  const list = await engine.rewardsFor(pool, T.businessId, m.membership_id);
  assert.deepEqual(list.map((r) => [r.name, r.affordable, r.points_short]), [['Free coffee', true, 0], ['Free thali', false, 200]]);

  const claim = (key, rewardId = coffee.reward_id) => withTransaction((c) => engine.redeemReward(c, { businessId: T.businessId, membershipId: m.membership_id, rewardId, key }));
  const one = await claim('c1');
  assert.equal(one.balance, 40); assert.equal(one.redemption.value_paise, '12000'); assert.equal(one.duplicate, false);
  assert.equal((await claim('c1')).duplicate, true);                    // the same request again spends nothing
  assert.equal(await balance(m.membership_id), 40);
  await assert.rejects(claim('c2'), /already claimed this reward 1 time/);
  await assert.rejects(claim('c3', big.reward_id), /Only 40 points/);

  // cancelling the claim gives the points back and marks it cancelled; it cannot be cancelled twice
  const back = await withTransaction((c) => engine.cancelRedemption(c, { businessId: T.businessId, redemptionId: one.redemption.redemption_id, key: 'cancel-1' }));
  assert.equal(back.balance, 100);
  assert.equal((await pool.query(`SELECT status FROM loyalty_redemptions WHERE redemption_id = $1`, [one.redemption.redemption_id])).rows[0].status, 'CANCELLED');
  await assert.rejects(withTransaction((c) => engine.cancelRedemption(c, { businessId: T.businessId, redemptionId: one.redemption.redemption_id, key: 'cancel-2' })), /already cancelled/);
  await claim('c4');                                                     // a cancelled claim no longer counts against the limit
  assert.equal(await balance(m.membership_id), 40);
});

test('a reward from another programme or another business cannot be claimed', { skip }, async () => {
  const p1 = await programme(T); const p2 = await programme(T);
  const cust = await T.customer('Mani', '9876500102');
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: T.businessId, programmeId: p1.programme_id, customerId: cust }))).membership;
  await withTransaction((c) => engine.earn(c, { businessId: T.businessId, membershipId: m.membership_id, amountPaise: 500000, key: 'seed2' }));
  const r2 = (await T.call(ctl.createReward, { body: { programme_id: p2.programme_id, name: 'Other programme', points_cost: 10 } })).body.data;
  await assert.rejects(withTransaction((c) => engine.redeemReward(c, { businessId: T.businessId, membershipId: m.membership_id, rewardId: r2.reward_id, key: 'k1' })), /different programme/);
  await assert.rejects(withTransaction((c) => engine.redeemReward(c, { businessId: other.businessId, membershipId: m.membership_id, rewardId: r2.reward_id, key: 'k2' })), /not found/);
  assert.equal((await other.call(ctl.createReward, { body: { programme_id: p1.programme_id, name: 'x', points_cost: 5 } })).code, 404);   // cannot add to a programme that is not theirs
});

test('a bill credits the customer\'s programme once; a customer with no membership is joined only when the programme enrols automatically', { skip }, async () => {
  const manual = await programme(T);                                      // no auto-enrol
  const auto = await programme(T, { settings: { auto_enrol: true } });
  const cust = await T.customer('Lata', '9876500103');
  const inv = (await T.bill(cust, 4)).body.data;                          // Rs 1000 -> 100 points
  const mems = (await pool.query(`SELECT programme_id, membership_id FROM loyalty_memberships WHERE customer_id = $1`, [cust])).rows;
  assert.deepEqual(mems.map((x) => x.programme_id), [auto.programme_id]);  // only the auto-enrol programme joined them
  assert.equal(await balance(mems[0].membership_id), 100);
  // crediting the same bill again (a retry) adds nothing
  await withTransaction((c) => engine.creditBill(c, { businessId: T.businessId, customerId: cust, invoiceId: inv.invoice_id, amountPaise: 100000 }));
  assert.equal(await balance(mems[0].membership_id), 100);
  assert.ok(manual);
});

test('a loyalty problem never stops a sale: a switched-off programme is skipped and the bill is still made', { skip }, async () => {
  await pool.query(`UPDATE loyalty_programmes SET is_active = FALSE WHERE business_id = $1`, [T.businessId]);
  const cust = await T.customer('Ravi', '9876500104');
  const res = await T.bill(cust, 1);
  assert.equal(res.code, 201);
  await pool.query(`UPDATE loyalty_programmes SET is_active = TRUE WHERE business_id = $1`, [T.businessId]);
});

test('a credit note takes back its share of the programme points; cancelling the bill puts all of it back', { skip }, async () => {
  await pool.query(`UPDATE loyalty_programmes SET settings = '{}'::jsonb WHERE business_id = $1`, [T.businessId]);
  const p = await programme(T, { settings: { auto_enrol: true } });
  const cust = await T.customer('Credit Cathy', '9876500105');
  const inv = (await T.bill(cust, 4)).body.data;
  const m = (await pool.query(`SELECT membership_id FROM loyalty_memberships WHERE customer_id = $1 AND programme_id = $2`, [cust, p.programme_id])).rows[0];
  assert.equal(await balance(m.membership_id), 100);
  const line = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].item_id;
  const one = await T.call(notes.create, { params: { id: inv.invoice_id }, body: { reason: 'Cold food', items: [{ item_id: line, quantity: 1 }] } });
  assert.equal(one.code, 201, JSON.stringify(one.body));
  assert.equal(await balance(m.membership_id), 75);                       // a quarter of the bill credited: a quarter of the points
  await T.call(notes.create, { params: { id: inv.invoice_id }, body: { reason: 'Rest', items: [{ item_id: line, quantity: 3 }] } });
  assert.equal(await balance(m.membership_id), 0);                        // the whole bill credited: all the points taken back, once each

  const inv2 = (await T.bill(cust, 2)).body.data;                         // Rs 500 -> 50 points
  assert.equal(await balance(m.membership_id), 50);
  const cancelled = await T.call(invoices.cancel, { params: { id: inv2.invoice_id }, body: { reason: 'Wrong order' } });
  assert.equal(cancelled.code, 200, JSON.stringify(cancelled.body));
  assert.equal(await balance(m.membership_id), 0);                        // a cancelled bill: what it earned is out of the balance
});
