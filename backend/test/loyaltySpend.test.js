/*
 * Spending a Loyalty card's points at the till: the points card the till sees, the discount on the bill, the rules (minimum, most percent of a bill), and a cancelled bill giving the points back.
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


test('setup', { skip }, async () => { await runMigrations(pool); T = await make('sp1'); other = await make('sp2'); });

let p; let m; let cust; let dish;
test('the till sees the card as a points card: balance, value of a point, and the share of a bill points may pay for', { skip }, async () => {
  p = await programme(T, { settings: { max_redeem_pct: 40 } });
  cust = await T.customer('Asha', '9876500201');
  m = (await withTransaction((c) => engine.enrol(c, { businessId: T.businessId, programmeId: p.programme_id, customerId: cust }))).membership;
  await withTransaction((c) => engine.earn(c, { businessId: T.businessId, membershipId: m.membership_id, amountPaise: 500000, key: 'sp-seed' }));   // 500 points
  const card = await engine.spendCard(pool, T.businessId, cust);
  assert.equal(card.membership_id, m.membership_id); assert.equal(card.balance, 500); assert.equal(card.point_value, 0.5); assert.equal(card.max_redeem_pct, 40); assert.equal(card.min_redeem_points, 100);
  assert.equal(await engine.spendCard(pool, T.businessId, await T.customer('Nobody', '9876500202')), null);
  dish = (await pool.query(`SELECT product_id FROM products WHERE business_id = $1 AND name = 'Thali'`, [T.businessId])).rows[0].product_id;
});

test('spending points takes the discount off the bill and the points off the card, and the rules hold', { skip }, async () => {
  const bill = (extra) => T.call(invoices.create, { body: { customer_id: cust, items: [{ product_id: dish, quantity: 1 }], ...extra } });
  assert.equal((await bill({ redeem_points: 220, spend_membership_id: m.membership_id })).code, 400);   // Rs 110 is more than 40% of the bill
  assert.equal((await bill({ redeem_points: 50, spend_membership_id: m.membership_id })).code, 400);    // under the card's minimum
  const stranger = await other.customer('Z', '9876500203');
  const otherProgramme = await programme(other);
  const theirs = (await withTransaction((c) => engine.enrol(c, { businessId: other.businessId, programmeId: otherProgramme.programme_id, customerId: stranger }))).membership;
  assert.equal((await bill({ redeem_points: 100, spend_membership_id: theirs.membership_id })).code, 404);   // someone else's card
  assert.equal(await balance(m.membership_id), 500);                                                    // nothing was taken by the refused ones
  const ok = await bill({ redeem_points: 200, spend_membership_id: m.membership_id });
  assert.equal(ok.code, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.points_redeemed, 200); assert.equal(ok.body.data.points_discount, 100);
  assert.equal(ok.body.data.loyalty_spend.points, 200);
  const after = await balance(m.membership_id);
  assert.ok(after >= 300 && after < 340, `balance ${after}`);                                          // 300 left, plus what this bill earned
  const rows = (await pool.query(`SELECT kind, points FROM points_ledger WHERE membership_id = $1 AND invoice_id = $2 ORDER BY entry_id`, [m.membership_id, ok.body.data.invoice_id])).rows;
  assert.equal(rows.find((r) => r.kind === 'REDEEM').points, -200);
  await T.call(invoices.cancel, { params: { id: ok.body.data.invoice_id }, body: { reason: 'x' } });
  assert.equal(await balance(m.membership_id), 500);                                                    // a cancelled bill gives the points back and takes its earning away
});
