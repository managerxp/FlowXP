/* Loyalty phase 5: campaign audiences from a loyalty card. Only members who agreed to offers, never an opted-out customer, never another business's. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { audience, segmentsFor } = await import('../src/modules/messaging/index.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

let biz; let other; let prog; let otherProg; const who = {};
const mkBiz = async (n) => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [n, `${n}@lc5.test`])).rows[0];
  return (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [n, u.user_id])).rows[0].business_id;
};
const member = async (b, p, name, phone, { consent = true, points = 0, optOut = false, daysAgo = 0 } = {}) => {
  const c = (await pool.query(`INSERT INTO customers (business_id, name, phone, marketing_opt_out) VALUES ($1,$2,$3,$4) RETURNING customer_id`, [b, name, phone, optOut])).rows[0].customer_id;
  const m = (await withTransaction((cl) => engine.enrol(cl, { businessId: b, programmeId: p, customerId: c, consentMarketing: consent }))).membership;
  for (let i = 0; i < points; i++) await withTransaction((cl) => engine.earn(cl, { businessId: b, membershipId: m.membership_id, amountPaise: 0, key: `${name}-${i}` }));
  if (daysAgo) {   // age the member: the ledger is append-only, so the test switches its trigger off for this one change
    await pool.query(`ALTER TABLE points_ledger DISABLE TRIGGER USER`);
    await pool.query(`UPDATE points_ledger SET created_at = created_at - ($2 || ' days')::interval WHERE membership_id = $1`, [m.membership_id, daysAgo]);
    await pool.query(`ALTER TABLE points_ledger ENABLE TRIGGER USER`);
    await pool.query(`UPDATE loyalty_memberships SET joined_at = joined_at - ($2 || ' days')::interval WHERE membership_id = $1`, [m.membership_id, daysAgo]);
  }
  return c;
};
const names = async (segment, extra = {}) => ((await audience(pool, biz, { segment, programme_id: prog, ...extra })).customers || []).map((c) => c.name).sort();

test('setup', { skip }, async () => {
  await runMigrations(pool);
  biz = await mkBiz('a'); other = await mkBiz('b');
  const mk = async (b) => (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points) VALUES ($1,'Stamps','STAMPS',1,0,5,0,5) RETURNING programme_id`, [b])).rows[0].programme_id;
  prog = await mk(biz); otherProg = await mk(other);
  await pool.query(`INSERT INTO loyalty_rewards (business_id, programme_id, name, points_cost) VALUES ($1,$2,'Free coffee',10)`, [biz, prog]);
  await member(biz, prog, 'Fresh', '9000000001', { points: 0 });
  await member(biz, prog, 'Near', '9000000002', { points: 8 });      // within a fifth of 10
  await member(biz, prog, 'Ready', '9000000003', { points: 10 });
  await member(biz, prog, 'Quiet', '9000000004', { points: 3, daysAgo: 60 });
  await member(biz, prog, 'NoConsent', '9000000005', { consent: false, points: 10 });
  await member(biz, prog, 'OptedOut', '9000000006', { optOut: true, points: 10 });
  await member(biz, prog, 'ShortNumber', '12345', { points: 10 });
  await member(biz, prog, 'SpacedShort', '12345 6789', { points: 10 });   // ten characters but only nine digits
  await member(other, otherProg, 'Stranger', '9000000007', { points: 10 });
});

test('everyone on the card who agreed to offers, and nobody who did not, opted out, has no number or is another business\'s', { skip }, async () => {
  assert.deepEqual(await names('CARD_ALL'), ['Fresh', 'Near', 'Quiet', 'Ready']);
});
test('near a reward: within a fifth of the cost and not there yet; ready: enough for it', { skip }, async () => {
  assert.deepEqual(await names('CARD_NEAR'), ['Near']);
  assert.deepEqual(await names('CARD_READY'), ['Ready']);
});
test('idle members: nothing for a while (a member who just joined is not idle)', { skip }, async () => {
  assert.deepEqual(await names('CARD_IDLE', { days: 30 }), ['Quiet']);
});
test('a card of another business cannot be used, and a card must be chosen', { skip }, async () => {
  assert.equal((await audience(pool, biz, { segment: 'CARD_ALL', programme_id: otherProg })).error, 'Choose which loyalty card');
  assert.equal((await audience(pool, biz, { segment: 'CARD_ALL' })).error, 'Choose which loyalty card');
});
test('the card segments are offered only to a business that has a card', { skip }, async () => {
  assert.ok('CARD_ALL' in await segmentsFor(pool, biz));
  const none = await mkBiz('c');
  assert.ok(!('CARD_ALL' in await segmentsFor(pool, none))); assert.ok('ALL' in await segmentsFor(pool, none));
});

test('points expiring soon: only members whose points will be written off within the window, on a card that expires points', { skip }, async () => {
  const mk = async (b, expiry) => (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points, expiry_days) VALUES ($1,'Stamps','STAMPS',1,0,5,0,5,$2) RETURNING programme_id`, [b, expiry])).rows[0].programme_id;
  const exp = await mk(biz, 30); const plain = await mk(biz, null);
  await member(biz, exp, 'ExpSoon', '9000000011', { points: 4, daysAgo: 25 });      // 25 days old on a 30 day card: gone in 5 days
  await member(biz, exp, 'ExpFresh', '9000000012', { points: 4 });                  // just earned: nowhere near
  await member(biz, exp, 'ExpNothing', '9000000013', { points: 0, daysAgo: 25 });   // old but no points left
  await member(biz, exp, 'ExpNoConsent', '9000000014', { consent: false, points: 4, daysAgo: 25 });
  await member(biz, plain, 'PlainOld', '9000000015', { points: 4, daysAgo: 400 });  // a card without an expiry never expires
  const who = async (p, days) => ((await audience(pool, biz, { segment: 'CARD_EXPIRING', programme_id: p, days })).customers || []).map((c) => c.name);
  assert.deepEqual(await who(exp, 7), ['ExpSoon']);
  assert.deepEqual(await who(exp, 3), []);                 // 5 days away is outside a 3 day window
  assert.deepEqual(await who(plain, 7), []);
  assert.ok('CARD_EXPIRING' in await segmentsFor(pool, biz));
});
