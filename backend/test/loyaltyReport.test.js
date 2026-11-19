/* Loyalty phase 6: the owner's report reads the ledger faithfully, stays inside its own business, and the self-check catches a broken book. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { report, problems } = await import('../src/modules/loyaltyReport.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

let biz; let other; let prog; let reward; const m = {};
const mkBiz = async (n) => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [n, `${n}@lr6.test`])).rows[0];
  return (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [n, u.user_id])).rows[0].business_id;
};
const join = async (b, p, name, phone) => {
  const c = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [b, name, phone])).rows[0].customer_id;
  return (await withTransaction((cl) => engine.enrol(cl, { businessId: b, programmeId: p, customerId: c, consentMarketing: true }))).membership.membership_id;
};
const earn = (b, id, amountPaise, key) => withTransaction((cl) => engine.earn(cl, { businessId: b, membershipId: id, amountPaise, key }));

test('setup', { skip }, async () => {
  await runMigrations(pool);
  biz = await mkBiz('a'); other = await mkBiz('b');
  prog = (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points) VALUES ($1,'Points','POINTS',1,10000,10,5000,10) RETURNING programme_id`, [biz])).rows[0].programme_id;
  const op = (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points) VALUES ($1,'Points','POINTS',1,10000,10,5000,10) RETURNING programme_id`, [other])).rows[0].programme_id;
  reward = (await pool.query(`INSERT INTO loyalty_rewards (business_id, programme_id, name, points_cost, value_paise) VALUES ($1,$2,'Free dessert',10,5000) RETURNING reward_id`, [biz, prog])).rows[0].reward_id;
  m.a = await join(biz, prog, 'Asha', '9100000001'); m.b = await join(biz, prog, 'Bala', '9100000002'); m.idle = await join(biz, prog, 'Idle', '9100000003');
  const o = await join(other, op, 'Other', '9100000009'); await earn(other, o, 5000000, 'o1');
  await earn(biz, m.a, 100000, 'a1'); await earn(biz, m.a, 100000, 'a2');   // 10 points each (1 per Rs 100), 2 visits
  await earn(biz, m.b, 100000, 'b1');
});

test('the report adds up from the ledger', { skip }, async () => {
  const r = await report(pool, biz, { days: 30 });
  assert.equal(r.cards.length, 1);
  const c = r.cards[0];
  assert.equal(c.members, 3); assert.equal(c.active, 2); assert.equal(c.visits, 3);
  assert.equal(c.earned, 30); assert.equal(c.spend_paise, '300000'); assert.equal(c.repeaters, 1);   // only Asha came twice
  assert.equal(c.owed_points, 30); assert.equal(c.owed_paise, '15000');                              // 30 points x Rs 50 per 10
  assert.equal(r.active_share, 67);
  assert.equal(r.totals.members, 3);
});

test('claims and reversals show up; a reversal is its own line', { skip }, async () => {
  const claim = await withTransaction((cl) => engine.redeemReward(cl, { businessId: biz, membershipId: m.a, rewardId: reward, key: 'claim-1' }));
  let r = await report(pool, biz, { days: 30 });
  assert.equal(r.cards[0].claims, 1); assert.equal(r.cards[0].claim_paise, '5000'); assert.equal(r.top_rewards[0].name, 'Free dessert');
  assert.equal(r.cards[0].owed_points, 20);
  const first = (await pool.query(`SELECT entry_id FROM points_ledger WHERE membership_id = $1 AND kind = 'EARN' ORDER BY entry_id LIMIT 1`, [m.b])).rows[0].entry_id;
  await withTransaction((cl) => engine.reverse(cl, { businessId: biz, entryId: first, key: 'rev-1' }));
  r = await report(pool, biz, { days: 30 });
  assert.equal(r.cards[0].undone, 1); assert.equal(r.cards[0].earned, 30);   // gross earned unchanged, the reversal counted separately
  assert.equal(r.cards[0].owed_points, 10);
  assert.ok(claim.redemption);
});

test('a wild days value is clamped, and another business sees nothing of this one', { skip }, async () => {
  assert.equal((await report(pool, biz, { days: "1; DROP TABLE x" })).days, 30);
  assert.equal((await report(pool, biz, { days: 99999 })).days, 365);
  const o = await report(pool, other, { days: 30 });
  assert.equal(o.totals.members, 1); assert.equal(o.totals.claims, 0); assert.ok(o.series.every((s) => s.earns <= 1));
  assert.equal((await report(pool, other, { days: 30, programmeId: prog })).cards.length, 0);   // another business's programme id gives nothing
});

test('a healthy book has no problems; a broken one is named, not hidden', { skip }, async () => {
  assert.deepEqual(await problems(pool, biz), []);
  // force a bad row the engine itself would refuse: a redeem larger than the balance
  await pool.query(`INSERT INTO points_ledger (business_id, customer_id, kind, points, amount_paise, programme_id, membership_id) SELECT business_id, customer_id, 'REDEEM', -500, 0, programme_id, membership_id FROM loyalty_memberships WHERE membership_id = $1`, [m.b]);
  const p = await problems(pool, biz);
  assert.deepEqual(p.map((x) => x.code), ['NEGATIVE_BALANCE']);
  assert.deepEqual(p[0].ids, [m.b]);
  assert.deepEqual(await problems(pool, other), []);
});
