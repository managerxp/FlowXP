/* WhatsApp credit: off by default; on, a paying business spends from its wallet, a trial and sign-in codes do not; the marketing switch holds back offers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { send } = await import('../src/modules/messaging/index.js');
const { adjust, balanceOf } = await import('../src/modules/messaging/wallet.js');

test.after(cleanup);

test('credit is taken per message, stops at zero, and the marketing switch holds back offers', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Om','o@wl.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, subscription_status, messaging_settings) VALUES ('Cafe',$1,'CAFE','Karnataka','ACTIVE',$2) RETURNING business_id`, [owner, JSON.stringify({ channel: 'WHATSAPP' })])).rows[0].business_id;
  // no provider in tests: what Meta would have accepted is marked sent, and charged, by the same path
  const one = async (kind = 'WAITLIST_READY') => {
    const r = await send(pool, { businessId: biz, phone: '9845011122', kind, values: { name: 'Asha', business: 'Cafe', reward: 'Coffee' } });
    return r;
  };
  assert.ok(!(await one()).skipped, 'credit off: no limit');
  await pool.query(`INSERT INTO platform_settings (setting_key, value) VALUES ('messaging', '{"walletRequired":"on"}'::jsonb) ON CONFLICT (setting_key) DO UPDATE SET value = EXCLUDED.value`);
  assert.deepEqual(await one(), { skipped: 'NO_CREDIT' }, 'empty wallet');
  assert.equal(await adjust(pool, biz, 1000, { note: 'UPI' }), 1000);
  // a sent message costs 15 paise; the log provider records SKIPPED, so mark the row sent and charge it the way a real send does
  const { chargeMessage } = await import('../src/modules/messaging/wallet.js');
  const r = await one(); assert.ok(!r.skipped);
  await chargeMessage(pool, { ...r, status: 'SENT' });
  assert.equal(await balanceOf(pool, biz), 985);
  const m = await send(pool, { businessId: biz, phone: '9845011122', kind: 'LOYALTY_NEXT', values: { name: 'Asha', business: 'Cafe', reward: 'Coffee' } });
  await chargeMessage(pool, { ...m, status: 'SENT' });
  assert.equal(await balanceOf(pool, biz), 895, 'marketing costs 90 paise');

  await pool.query(`UPDATE businesses SET messaging_settings = $2 WHERE business_id = $1`, [biz, JSON.stringify({ channel: 'WHATSAPP', marketing: false })]);
  assert.deepEqual(await send(pool, { businessId: biz, phone: '9845011122', kind: 'LOYALTY_NEXT', values: { name: 'Asha', business: 'Cafe', reward: 'Coffee' } }), { skipped: 'MARKETING_OFF' });
  await pool.query(`UPDATE businesses SET subscription_status = 'TRIAL' WHERE business_id = $1`, [biz]);
  const { gate } = await import('../src/modules/messaging/wallet.js');
  assert.equal(await gate(pool, biz, 'BILL'), null, 'a trial is not charged');
  assert.equal(await gate(pool, biz, 'OTP'), null, 'a sign-in code is never charged');
});

test('the owner is warned once when credit falls to the alert level, and again when it runs out', { skip }, async () => {
  const { alertIfLow, walletSettings } = await import('../src/modules/messaging/wallet.js');
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Low','l@wl.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status) VALUES ('Low Cafe',$1,'CAFE','ACTIVE') RETURNING business_id`, [owner])).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz, owner]);
  const s = await walletSettings();
  assert.equal(s.lowAlert, 10000, 'default alert level is ₹100');
  const titles = async () => (await pool.query(`SELECT type FROM notifications WHERE business_id = $1 ORDER BY notification_id`, [biz])).rows.map((r) => r.type);
  await alertIfLow(pool, biz, 20000, 15000, s); assert.deepEqual(await titles(), [], 'still above the level');
  await alertIfLow(pool, biz, 10100, 9985, s); assert.deepEqual(await titles(), ['credit_low']);
  await alertIfLow(pool, biz, 9985, 9970, s); assert.deepEqual(await titles(), ['credit_low'], 'already below: not told again');
  await alertIfLow(pool, biz, 10, 0, s); assert.deepEqual(await titles(), ['credit_low', 'credit_empty']);
});
