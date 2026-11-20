/* The older Visit card moves onto Loyalty cards: stamps carry over, the free item becomes a reward, the old card switches off, and it can happen only once. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const mv = await import('../src/modules/loyaltyMigrate.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');

let biz; let item; const cust = {};
const mkCust = async (name) => (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [biz, name, `9${String(Math.random()).slice(2, 11)}`])).rows[0].customer_id;
const event = (c, kind, day) => pool.query(`INSERT INTO loyalty_events (business_id, customer_id, kind, visit_date) VALUES ($1,$2,$3,$4)`, [biz, c, kind, day]);

test('setup: a shop with a 5-visit Visit card (4 stamps then the 5th visit free)', { skip }, async () => {
  await runMigrations(pool);
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('mv','mv@x.test','x') RETURNING user_id`)).rows[0];
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ('mv',$1,'CAFE',(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [u.user_id])).rows[0].business_id;
  item = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, kind) VALUES ($1,'Coffee',12000,'DISH') RETURNING product_id`, [biz]).catch(async () => pool.query(`INSERT INTO products (business_id, name, selling_price_paise) VALUES ($1,'Coffee',12000) RETURNING product_id`, [biz]))).rows[0].product_id;
  await pool.query(`INSERT INTO loyalty_programs (business_id, is_enabled, visits_required, reward_product_id, reward_quantity, min_bill_paise) VALUES ($1,TRUE,5,$2,1,5000)`, [biz, item]);
  cust.a = await mkCust('Asha'); cust.b = await mkCust('Bala'); cust.c = await mkCust('Chitra');
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) await event(cust.a, 'VISIT', d);                       // 3 stamps
  for (const d of ['2026-01-01', '2026-01-02']) await event(cust.b, 'VISIT', d); await event(cust.b, 'REDEEM', '2026-01-03'); await event(cust.b, 'VISIT', '2026-01-04');   // 1 stamp since the reward
  await event(cust.c, 'VISIT', '2026-01-01'); await event(cust.c, 'REDEEM', '2026-01-02');                           // 0 stamps
});

test('the preview says what will move', { skip }, async () => {
  const p = await mv.preview(pool, biz);
  assert.deepEqual([p.state, p.visits_required, p.reward, p.customers, p.stamps], ['READY', 5, 'Coffee', 2, 4]);
});

test('moving makes a stamps card with the same reward, carries each customer\'s stamps, and switches the old card off', { skip }, async () => {
  const out = await withTransaction((c) => mv.run(c, { businessId: biz }));
  assert.deepEqual([out.members, out.stamps], [2, 4]);
  const p = await engine.getProgramme(pool, biz, out.programme_id);
  assert.equal(p.kind, 'STAMPS'); assert.equal(p.redeem_points, 4); assert.equal(Number(p.min_txn_paise), 5000); assert.equal(p.settings.auto_enrol, true);
  const reward = (await pool.query(`SELECT * FROM loyalty_rewards WHERE programme_id = $1`, [p.programme_id])).rows[0];
  assert.equal(reward.points_cost, 4); assert.equal(Number(reward.value_paise), 12000); assert.equal(reward.product_id, item);
  const stamps = async (c) => { const m = (await pool.query(`SELECT membership_id FROM loyalty_memberships WHERE programme_id = $1 AND customer_id = $2`, [p.programme_id, c])).rows[0]; return m ? (await engine.balanceOf(pool, m.membership_id)).balance : null; };
  assert.equal(await stamps(cust.a), 3); assert.equal(await stamps(cust.b), 1); assert.equal(await stamps(cust.c), null);
  assert.equal((await pool.query(`SELECT is_enabled FROM loyalty_programs WHERE business_id = $1`, [biz])).rows[0].is_enabled, false);
  assert.equal((await mv.preview(pool, biz)).state, 'DONE');
});

test('it cannot be moved twice, and a shop with nothing switched on has nothing to move', { skip }, async () => {
  await assert.rejects(withTransaction((c) => mv.run(c, { businessId: biz })), /already been moved/);
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('mv2','mv2@x.test','x') RETURNING user_id`)).rows[0];
  const b2 = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ('mv2',$1,'CAFE',(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [u.user_id])).rows[0].business_id;
  assert.equal((await mv.preview(pool, b2)).state, 'NONE');
  await assert.rejects(withTransaction((c) => mv.run(c, { businessId: b2 })), /no switched-on Visit card/);
});
