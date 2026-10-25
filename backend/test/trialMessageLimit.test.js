/* A business on a free trial may send only a few WhatsApp messages in all; sign-in codes never count; a paying business has no limit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { send, trialUsage } = await import('../src/modules/messaging/index.js');

test.after(cleanup);

test('five WhatsApp messages in a free trial, then nothing; a paying business is not limited', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Om','o@tl.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, subscription_status, messaging_settings) VALUES ('Cafe',$1,'CAFE','Karnataka','TRIAL',$2) RETURNING business_id`, [owner, JSON.stringify({ channel: 'WHATSAPP' })])).rows[0].business_id;
  // the test has no real provider, so what would have been handed to Meta is marked sent
  const one = async (kind = 'WAITLIST_READY') => { const r = await send(pool, { businessId: biz, phone: '9845011122', kind, values: { name: 'Asha', business: 'Cafe' } }); await pool.query(`UPDATE messages SET status = 'SENT' WHERE business_id = $1 AND status = 'SKIPPED'`, [biz]); return r; };
  for (let i = 0; i < 5; i += 1) assert.ok(!(await one()).skipped, `message ${i + 1} goes`);
  assert.deepEqual(await one(), { skipped: 'TRIAL_LIMIT' });
  assert.deepEqual(await trialUsage(pool, biz), { used: 5, limit: 5 });

  await pool.query(`UPDATE businesses SET subscription_status = 'ACTIVE' WHERE business_id = $1`, [biz]);
  assert.equal(await trialUsage(pool, biz), null);
  assert.ok(!(await one()).skipped, 'a paying business keeps sending');
});

test('a sign-in code is never held back or counted', { skip }, async () => {
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Ravi','o@tl2.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, subscription_status, messaging_settings) VALUES ('Gym',$1,'GYM','Karnataka','TRIAL',$2) RETURNING business_id`, [owner, JSON.stringify({ channel: 'WHATSAPP' })])).rows[0].business_id;
  await pool.query(`INSERT INTO platform_settings (setting_key, value) VALUES ('messaging', '{"trialMessageLimit":"1"}'::jsonb) ON CONFLICT (setting_key) DO UPDATE SET value = EXCLUDED.value`);
  const otp = () => send(pool, { businessId: biz, phone: '9845011133', kind: 'GYM_OTP', values: { name: 'Ravi', business: 'Gym', code: '123456' } });
  await otp(); await otp(); await otp();
  assert.deepEqual(await trialUsage(pool, biz), { used: 0, limit: 1 }, 'codes do not count');
  assert.ok(!(await send(pool, { businessId: biz, phone: '9845011133', kind: 'WAITLIST_READY', values: { name: 'Ravi', business: 'Gym' } })).skipped);
  await pool.query(`UPDATE messages SET status = 'SENT' WHERE business_id = $1 AND status = 'SKIPPED'`, [biz]);
  assert.deepEqual(await send(pool, { businessId: biz, phone: '9845011133', kind: 'WAITLIST_READY', values: { name: 'Ravi', business: 'Gym' } }), { skipped: 'TRIAL_LIMIT' });
});
