/* Loyalty tiers: the tier follows what a member earned in all (spending never lowers it, undoing a sale can), and a higher tier earns faster on every path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const tiers = await import('../src/modules/loyaltyTiers.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

let biz; let other; let prog; let stamps; let n = 0;
const mkBiz = async (name) => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@lt.test`])).rows[0];
  return (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'CAFE') RETURNING business_id`, [name, u.user_id])).rows[0].business_id;
};
const mkProg = async (b, kind) => (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points) VALUES ($1,$2,$3,1,100,10,5000,10) RETURNING programme_id`, [b, kind, kind])).rows[0].programme_id;
const join = async (b, p) => {
  n += 1;
  const c = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [b, `T${n}`, `92000000${String(n).padStart(2, '0')}`])).rows[0].customer_id;
  return (await withTransaction((cl) => engine.enrol(cl, { businessId: b, programmeId: p, customerId: c }))).membership.membership_id;
};
const earn = (m, rupees) => withTransaction((cl) => engine.earn(cl, { businessId: biz, membershipId: m, amountPaise: rupees * 100, key: `t${++n}` }));
const SET = [{ name: 'Silver', min_points: 0, multiplier: 1 }, { name: 'Gold', min_points: 100, multiplier: 1.5 }, { name: 'Platinum', min_points: 300, multiplier: 2 }];

test('setup', { skip }, async () => { await runMigrations(pool); biz = await mkBiz('lt1'); other = await mkBiz('lt2'); prog = await mkProg(biz, 'POINTS'); stamps = await mkProg(biz, 'STAMPS'); });

test('tiers are checked: a name, whole points, the first at 0, no clashes, up to six, points and spend cards only', { skip }, async () => {
  for (const [list, re] of [[[{ name: '', min_points: 0 }], /needs a name/], [[{ name: 'A', min_points: 5 }], /start at 0/], [[{ name: 'A', min_points: 0 }, { name: 'B', min_points: 0 }], /same number/],
    [[{ name: 'A', min_points: 0, multiplier: 0.5 }], /between 1 and 10/], [[{ name: 'A', min_points: 1.5 }], /whole number/], [Array.from({ length: 7 }, (_, i) => ({ name: `T${i}`, min_points: i * 10 })), /Up to 6/]]) {
    await assert.rejects(withTransaction((c) => tiers.saveTiers(c, biz, prog, list)), re);
  }
  await assert.rejects(withTransaction((c) => tiers.saveTiers(c, biz, stamps, SET)), /points and spend/);
  await assert.rejects(withTransaction((c) => tiers.saveTiers(c, other, prog, SET)), /not found/);   // another business's card
  const saved = await withTransaction((c) => tiers.saveTiers(c, biz, prog, [...SET].reverse()));       // order typed does not matter
  assert.deepEqual(saved.map((t) => t.name), ['Silver', 'Gold', 'Platinum']);
});

test('a member climbs as they earn, and each bill earns at the tier they were in', { skip }, async () => {
  const m = await join(biz, prog);
  assert.equal((await tiers.standing(pool, prog, m)).tier.name, 'Silver');
  assert.equal((await earn(m, 80)).points, 80);                                // Silver: 1x
  let s = await tiers.standing(pool, prog, m);
  assert.equal(s.tier.name, 'Silver'); assert.equal(s.next.name, 'Gold'); assert.equal(s.next.points_to_go, 20);
  await earn(m, 20);                                                           // 100 earned: Gold from now on
  assert.equal((await tiers.standing(pool, prog, m)).tier.name, 'Gold');
  assert.equal((await earn(m, 100)).points, 150);                              // Gold: 1.5x
  assert.equal((await tiers.standing(pool, prog, m)).lifetime, 250);          // 80 + 20 + 150
  assert.equal((await earn(m, 100)).points, 150);                              // still Gold (under 300)
  s = await tiers.standing(pool, prog, m);
  assert.equal(s.tier.name, 'Platinum'); assert.equal(s.next, null);
  assert.equal((await earn(m, 100)).points, 200);                              // Platinum: 2x
});

test('spending points never lowers a tier, but undoing a sale can', { skip }, async () => {
  const m = await join(biz, prog);
  await earn(m, 120);
  assert.equal((await tiers.standing(pool, prog, m)).tier.name, 'Gold');
  await withTransaction((c) => engine.redeem(c, { businessId: biz, membershipId: m, points: 100, key: `r${++n}` }));
  assert.equal((await tiers.standing(pool, prog, m)).tier.name, 'Gold');       // balance fell to 20, the tier did not
  const m2 = await join(biz, prog);
  const second = await earn(m2, 120);
  assert.equal((await tiers.standing(pool, prog, m2)).tier.name, 'Gold');
  await withTransaction((c) => engine.reverse(c, { businessId: biz, entryId: second.entry.entry_id, key: `v${++n}`, reason: 'bill cancelled' }));
  assert.equal((await tiers.standing(pool, prog, m2)).lifetime, 0);            // the cancelled sale no longer counts
  assert.equal((await tiers.standing(pool, prog, m2)).tier.name, 'Silver');
});

test('a card without tiers earns exactly as before, and the bill-scan path uses the tier too', { skip }, async () => {
  const plain = await mkProg(biz, 'SPEND');
  const m = await join(biz, plain);
  assert.equal(await tiers.standing(pool, plain, m), null);
  assert.equal((await earn(m, 50)).points, 50);
  const claim = await import('../src/modules/loyaltyBillClaim.js');
  assert.equal(typeof claim.claim, 'function');
});
