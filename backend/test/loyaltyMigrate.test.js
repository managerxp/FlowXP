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

/* ── Points & tiers ─────────────────────────────────────────────────────────────────────────────────────────────── */
let pb; const pc = {};
const old = (c, kind, points, extra = '') => pool.query(`INSERT INTO points_ledger (business_id, customer_id, kind, points) VALUES ($1,$2,$3,$4)${extra}`, [pb, c, kind, points]);

test('points: a shop with 2.5 points per Rs 100, a point worth Re 1, tiers that do not start at 0, and customers with history', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('mp','mp@x.test','x') RETURNING user_id`)).rows[0];
  pb = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ('mp',$1,'CAFE',(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [u.user_id])).rows[0].business_id;
  await pool.query(`INSERT INTO points_programs (business_id, is_enabled, earn_per_100, point_value_paise, min_redeem_points, max_redeem_pct) VALUES ($1,TRUE,2.5,100,50,40)`, [pb]);
  await pool.query(`INSERT INTO points_tiers (business_id, name, min_points, multiplier) VALUES ($1,'Silver',100,1.5)`, [pb]);
  for (const n of ['A', 'B', 'C']) pc[n] = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [pb, n, `8${String(Math.random()).slice(2, 11)}`])).rows[0].customer_id;
  await old(pc.A, 'EARN', 200); await old(pc.A, 'REDEEM', -50);   // 150 now, 200 earned in all
  await old(pc.B, 'EARN', 30);
  await old(pc.C, 'EARN', 500, ''); await pool.query(`UPDATE points_ledger SET voided_at = now() WHERE customer_id = $1`, [pc.C]);   // cancelled: nothing to move
});

test('points: the preview, then the move keeps rate, value, limits, tiers, balances and lifetime', { skip }, async () => {
  assert.deepEqual(await mv.previewPoints(pool, pb), { state: 'READY', customers: 2, points: 180, tiers: 1 });
  const out = await withTransaction((c) => mv.runPoints(c, { businessId: pb }));
  assert.deepEqual([out.members, out.points, out.tiers], [2, 180, 2]);
  const p = await engine.getProgramme(pool, pb, out.programme_id);
  assert.deepEqual([p.kind, p.earn_points, Number(p.per_amount_paise), p.redeem_points, Number(p.redeem_value_paise), p.min_redeem_points, p.settings.max_redeem_pct, p.settings.auto_enrol], ['POINTS', 25, 100000, 1, 100, 50, 40, true]);
  assert.equal(engine.pointsFor(p, 25000), 6);                                                          // Rs 250 at 2.5 per Rs 100, rounded down, as before
  const tiers = (await pool.query(`SELECT name, min_points FROM loyalty_tiers WHERE programme_id = $1 ORDER BY min_points`, [p.programme_id])).rows;
  assert.deepEqual(tiers.map((t) => [t.name, t.min_points]), [['Member', 0], ['Silver', 100]]);
  const card = await engine.spendCard(pool, pb, pc.A);
  assert.equal(card.balance, 150); assert.equal(card.tier.name, 'Silver'); assert.equal(card.lifetime, 200); assert.equal(card.max_redeem_pct, 40); assert.equal(card.point_value, 1);   // still Silver: spending did not demote
  assert.equal((await engine.spendCard(pool, pb, pc.B)).balance, 30);
  assert.equal(await engine.spendCard(pool, pb, pc.C), null);
  assert.equal((await pool.query(`SELECT is_enabled FROM points_programs WHERE business_id = $1`, [pb])).rows[0].is_enabled, false);
  assert.equal((await mv.previewPoints(pool, pb)).state, 'DONE');
  await assert.rejects(withTransaction((c) => mv.runPoints(c, { businessId: pb })), /already been moved/);
});

test('points: a salon keeps its own points, and a shop with points off has nothing to move', { skip }, async () => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('ms','ms@x.test','x') RETURNING user_id`)).rows[0];
  const sb = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ('ms',$1,'SALON',(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [u.user_id])).rows[0].business_id;
  await pool.query(`INSERT INTO points_programs (business_id, is_enabled) VALUES ($1,TRUE)`, [sb]);
  assert.equal((await mv.previewPoints(pool, sb)).state, 'SALON');
  await assert.rejects(withTransaction((c) => mv.runPoints(c, { businessId: sb })), /Salons keep/);
  assert.equal((await mv.previewPoints(pool, biz)).state, 'NONE');   // the visit-card shop above has no points programme
});

/* ── the deploy-time move for every shop ─────────────────────────────────────────────────────────────────────────── */
test('migration 0152 moves every non-salon shop with an older programme, skips salons, and leaves a shop it cannot move clean', { skip }, async () => {
  const { up } = await import('../migrations/0152_move_older_loyalty.js');
  const shop = async (name, type, { visit = false, points = false, tiers = 0 } = {}) => {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@x.test`])).rows[0];
    const b = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ($1,$2,$3,(SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1)) RETURNING business_id`, [name, u.user_id, type])).rows[0].business_id;
    if (points) await pool.query(`INSERT INTO points_programs (business_id, is_enabled) VALUES ($1,TRUE)`, [b]);
    for (let i = 0; i < tiers; i++) await pool.query(`INSERT INTO points_tiers (business_id, name, min_points, multiplier) VALUES ($1,$2,$3,1)`, [b, `T${i}`, i * 100]);
    if (visit) {
      const prod = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise) VALUES ($1,'Tea',1000) RETURNING product_id`, [b])).rows[0].product_id;
      await pool.query(`INSERT INTO loyalty_programs (business_id, is_enabled, visits_required, reward_product_id) VALUES ($1,TRUE,5,$2)`, [b, prod]);
    }
    return b;
  };
  const cafe = await shop('all1', 'CAFE', { visit: true, points: true });
  const salon = await shop('all2', 'SALON', { points: true });
  const heavy = await shop('all3', 'CAFE', { points: true, tiers: 7 });   // 7 tiers do not fit a card (6)
  const c = await pool.connect();
  try { await c.query('BEGIN'); await up(c); await c.query('COMMIT'); } finally { c.release(); }
  const on = async (b, table) => (await pool.query(`SELECT is_enabled FROM ${table} WHERE business_id = $1`, [b])).rows[0]?.is_enabled;
  assert.equal(await on(cafe, 'loyalty_programs'), false); assert.equal(await on(cafe, 'points_programs'), false);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM loyalty_programmes WHERE business_id = $1`, [cafe])).rows[0].n, 2);   // a stamps card and a points card
  assert.equal(await on(salon, 'points_programs'), true);                                                                            // salons untouched
  assert.equal(await on(heavy, 'points_programs'), true);                                                                            // not movable: stays as it was
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM loyalty_programmes WHERE business_id = $1`, [heavy])).rows[0].n, 0);   // and nothing half-made
});
