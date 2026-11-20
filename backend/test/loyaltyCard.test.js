/* Loyalty engine, phase 3: card design, and the customer's join page and card (no login). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);
const { runMigrations } = await import('../src/config/migrate.js');
const engine = await import('../src/modules/loyaltyEngine.js');
const { withTransaction } = await import('../src/modules/wholesale/common.js');
const ctl = await import('../src/controllers/loyaltyEngine.controller.js');
const pub = await import('../src/controllers/loyaltyCard.controller.js');

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let T; let prog;
const make = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@lc.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, get: () => undefined, ip: '127.0.0.1', ...extra }, res); return res; };
  return { businessId: biz.business_id, call };
};
const pcall = async (fn, extra) => { const res = fakeRes(); await fn({ params: {}, body: {}, query: {}, ...extra }, res); return res; };

test('setup', { skip }, async () => {
  await runMigrations(pool); T = await make('cafe');
  await pool.query(`UPDATE businesses SET plan_code = (SELECT plan_code FROM plans ORDER BY sort_order LIMIT 1) WHERE business_id = $1`, [T.businessId]);
  const made = await T.call(ctl.createProgramme, { body: { name: 'Coffee card', kind: 'STAMPS', earn_points: 1, redeem_points: 5, redeem_value_paise: 12000, card: { bg: '#112233', icon: 'coffee', title: 'Buy 5, get 1', message: 'Thanks!', accent: 'javascript:alert(1)' } } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  prog = made.body.data;
});

test('the card design keeps only real colours and known icons, and the programme gets a join code', { skip }, async () => {
  assert.equal(prog.card.bg, '#112233'); assert.equal(prog.card.icon, 'coffee'); assert.equal(prog.card.accent, '#fbbf24');   // the bad colour fell back to the default
  assert.match(prog.join_code, /^[0-9a-f]{16}$/);
  assert.equal(engine.cardFields({ icon: '<script>' }).icon, 'star');
});

test('a customer joins from the page, gets a card with their balance and rewards, and the secret link alone shows it', { skip }, async () => {
  // plan features differ per install: if loyalty programmes are not on for this plan the public pages must hide it
  const info = await pcall(pub.joinInfo, { params: { code: prog.join_code } });
  if (info.code === 404) { await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'loyalty_programmes',TRUE) ON CONFLICT DO NOTHING`, [T.businessId]); }
  const open = await pcall(pub.joinInfo, { params: { code: prog.join_code } });
  assert.equal(open.code, 200, JSON.stringify(open.body));
  assert.equal(open.body.data.business, 'cafe'); assert.equal(open.body.data.card.bg, '#112233'); assert.equal(open.body.data.open, true);
  assert.equal((await pcall(pub.joinInfo, { params: { code: 'nope' } })).code, 404);

  assert.equal((await pcall(pub.join, { params: { code: prog.join_code }, body: { name: 'Asha', phone: '123' } })).code, 400);
  const joined = await pcall(pub.join, { params: { code: prog.join_code }, body: { name: 'Asha', phone: '98765 43210', consent_marketing: true } });
  assert.equal(joined.code, 201); assert.ok(joined.body.data.token);
  // the same number again gets no card (it would give anyone who knows a number that person's card)
  const again = await pcall(pub.join, { params: { code: prog.join_code }, body: { name: 'Someone else', phone: '9876543210' } });
  assert.deepEqual(again.body.data, { already: true });

  const m = (await pool.query(`SELECT membership_id FROM loyalty_memberships WHERE token = $1`, [joined.body.data.token])).rows[0];
  await withTransaction((c) => engine.earn(c, { businessId: T.businessId, membershipId: m.membership_id, amountPaise: 10000, key: 'k1' }));
  await T.call(ctl.createReward, { body: { programme_id: prog.programme_id, name: 'Free coffee', points_cost: 5, value_paise: 12000 } });
  const card = await pcall(pub.card, { params: { token: joined.body.data.token } });
  assert.equal(card.code, 200, JSON.stringify(card.body));
  const d = card.body.data;
  assert.equal(d.balance, 1); assert.equal(d.customer, 'Asha'); assert.equal(d.rewards[0].points_short, 4); assert.equal(d.ledger.length, 1);
  assert.equal(d.token, undefined); assert.equal(d.join_code, undefined); assert.equal(d.business_id, undefined);   // nothing internal leaks
  assert.equal((await pcall(pub.card, { params: { token: 'a'.repeat(48) } })).code, 404);
  assert.equal((await pcall(pub.card, { params: { token: 'short' } })).code, 404);
});

test('a switched-off programme cannot be joined', { skip }, async () => {
  await pool.query(`UPDATE loyalty_programmes SET is_active = FALSE WHERE programme_id = $1`, [prog.programme_id]);
  const r = await pcall(pub.join, { params: { code: prog.join_code }, body: { name: 'Late', phone: '9000000001' } });
  assert.equal(r.code, 400);
});

test('a number saved with a country code and spaces is recognised: joining makes a card for that customer, not a second customer', { skip }, async () => {
  await pool.query(`UPDATE loyalty_programmes SET is_active = TRUE WHERE programme_id = $1`, [prog.programme_id]);   // the test above switched it off
  const c = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Old customer','+91 91234-56789') RETURNING customer_id`, [T.businessId])).rows[0].customer_id;
  const joined = await pcall(pub.join, { params: { code: prog.join_code }, body: { name: 'Typed again', phone: '9123456789' } });
  assert.equal(joined.code, 201, JSON.stringify(joined.body));
  const rows = (await pool.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = '9123456789'`, [T.businessId])).rows;
  assert.deepEqual(rows.map((r) => r.customer_id), [c]);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM loyalty_memberships WHERE customer_id = $1`, [c])).rows[0].n, 1);
});
