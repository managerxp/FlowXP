/* Loyalty points expiry: oldest points go first, anything used is never expired twice, a retry writes nothing more, and no other business is touched. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { runForBusiness } = await import('../src/modules/loyaltyExpiry.js');
const { report, problems } = await import('../src/modules/loyaltyReport.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

let biz; let other; let prog; let plain; let otherProg; let n = 0;
const mkBiz = async (name) => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@le.test`])).rows[0];
  return (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [name, u.user_id])).rows[0].business_id;
};
const mkProg = async (b, expiry) => (await pool.query(`INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points, expiry_days) VALUES ($1,'Points','POINTS',1,100,10,5000,10,$2) RETURNING programme_id`, [b, expiry])).rows[0].programme_id;
const join = async (b, p) => {
  n += 1;
  const c = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [b, `C${n}`, `91000000${String(n).padStart(2, '0')}`])).rows[0].customer_id;
  return (await withTransaction((cl) => engine.enrol(cl, { businessId: b, programmeId: p, customerId: c }))).membership.membership_id;
};
/** The ledger is append-only, so a test that needs old history switches its trigger off for this one change. */
const age = async (entryId, days) => {
  await pool.query(`ALTER TABLE points_ledger DISABLE TRIGGER USER`);
  await pool.query(`UPDATE points_ledger SET created_at = created_at - ($2 || ' days')::interval WHERE entry_id = $1`, [entryId, days]);
  await pool.query(`ALTER TABLE points_ledger ENABLE TRIGGER USER`);
};
const earn = async (b, id, points, daysAgo) => {
  const { entry } = await withTransaction((cl) => engine.earn(cl, { businessId: b, membershipId: id, amountPaise: points * 100, key: `e${++n}` }));
  if (daysAgo) await age(entry.entry_id, daysAgo);
  return entry;
};
const redeem = async (b, id, points, daysAgo) => {
  const { entry } = await withTransaction((cl) => engine.redeem(cl, { businessId: b, membershipId: id, points, key: `r${++n}` }));
  if (daysAgo) await age(entry.entry_id, daysAgo);
};
const balance = async (id) => (await engine.balanceOf(pool, id)).balance;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  biz = await mkBiz('a'); other = await mkBiz('b');
  prog = await mkProg(biz, 30); plain = await mkProg(biz, null); otherProg = await mkProg(other, 30);
});

test('points older than the limit expire, newer ones stay, and a second run writes nothing', { skip }, async () => {
  const m = await join(biz, prog);
  await earn(biz, m, 100, 40); await earn(biz, m, 50, 5);
  assert.deepEqual(await runForBusiness(pool, biz), { members: 1, points: 100 });
  assert.equal(await balance(m), 50);
  assert.deepEqual(await runForBusiness(pool, biz), { members: 0, points: 0 });
  const rows = (await pool.query(`SELECT points, note FROM points_ledger WHERE membership_id = $1 AND kind = 'EXPIRE'`, [m])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].points, -100); assert.match(rows[0].note, /30 days/);
});

test('oldest points are used first: what was redeemed is never expired a second time', { skip }, async () => {
  const m = await join(biz, prog);
  await earn(biz, m, 100, 40); await earn(biz, m, 50, 5);
  await redeem(biz, m, 60, 10);                                   // took 60 of the old 100
  assert.equal(await balance(m), 90);
  await runForBusiness(pool, biz);
  assert.equal(await balance(m), 50);                             // only the 40 left of the old points went
});

test('a member who used all their old points loses nothing', { skip }, async () => {
  const m = await join(biz, prog);
  await earn(biz, m, 100, 40); await earn(biz, m, 50, 5);
  await redeem(biz, m, 120, 10);
  await runForBusiness(pool, biz);
  assert.equal(await balance(m), 30);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM points_ledger WHERE membership_id = $1 AND kind = 'EXPIRE'`, [m])).rows[0].n, 0);
});

test('a card without an expiry never expires anything, and another business is never touched', { skip }, async () => {
  const keep = await join(biz, plain); await earn(biz, keep, 80, 400);
  const theirs = await join(other, otherProg); await earn(other, theirs, 80, 400);
  assert.deepEqual(await runForBusiness(pool, biz), { members: 0, points: 0 });
  assert.equal(await balance(keep), 80); assert.equal(await balance(theirs), 80);   // the other business's own old points wait for its own run
  assert.deepEqual(await runForBusiness(pool, other), { members: 1, points: 80 });
});

test('time moves on: later the newer points expire too; the books stay healthy and the report counts it', { skip }, async () => {
  const later = new Date(Date.now() + 100 * 86400000);
  const out = await runForBusiness(pool, biz, { on: later });
  assert.ok(out.members >= 2 && out.points >= 80);
  assert.deepEqual(await problems(pool, biz), []);
  const r = await report(pool, biz, { days: 365 });
  assert.ok(r.cards.find((c) => c.programme_id === prog).expired >= 100);
});
