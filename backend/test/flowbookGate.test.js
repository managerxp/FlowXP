/*
 * The super admin's switches reach FlowBook: a feature switched off per business (or per plan) is reported to FlowBook as off, the assistant needs
 * the flowbook_ai feature and shares the plan's monthly AI question allowance, and each answered question is counted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { gate, record, featuresOff } = await import('../src/modules/flowbook/gate.js');
const { PLAN_FEATURE_KEYS } = await import('../src/modules/planFeatures.js');
test.after(cleanup);

test('FlowBook features are listed for the super admin and switched by plan, business and allowance', { skip }, async () => {
  await runMigrations(pool);
  for (const k of ['flowbook_app', 'flowbook_bank', 'flowbook_gst', 'flowbook_ai', 'flowbook_tds_tcs']) assert.ok(PLAN_FEATURE_KEYS.includes(k), k);
  assert.ok(PLAN_FEATURE_KEYS.every((k) => k.length <= 32), 'keys fit the override column');

  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@gate.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status) VALUES ('Shop',$1,'RETAIL','BUSINESS','ACTIVE') RETURNING business_id`, [user])).rows[0].business_id;
  const id = String(biz);

  assert.equal((await gate(id)).ok, true);
  assert.deepEqual(await featuresOff(id), []);
  assert.equal((await gate(null)).ok, false, 'books not linked to a FlowXP business cannot be gated or counted');

  // switched off for this one business by the super admin
  const off = async (key, enabled) => { await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,$2,$3) ON CONFLICT (business_id, feature_key) DO UPDATE SET enabled = $3`, [biz, key, enabled]); };
  await off('flowbook_bank', false);
  await off('flowbook_ai', false);
  await new Promise((r) => setTimeout(r, 5100));   // FlowBook looks again every few seconds
  assert.deepEqual(await featuresOff(id), ['flowbook_bank']);
  const blocked = await gate(id);
  assert.equal(blocked.ok, false); assert.equal(blocked.status, 402);
  await off('flowbook_ai', true);

  // the owner's AI switch, then the monthly allowance shared with Flow AI
  await pool.query(`UPDATE businesses SET ai_enabled = FALSE WHERE business_id = $1`, [biz]);
  assert.equal((await gate(id)).ok, false);
  await pool.query(`UPDATE businesses SET ai_enabled = TRUE WHERE business_id = $1`, [biz]);
  await pool.query(`UPDATE plans SET limits = limits || jsonb_build_object('ai_queries', 2) WHERE plan_code = 'BUSINESS'`);
  assert.equal((await gate(id)).remaining, 2);
  await record(id, { model: 'm', input_tokens: 10, output_tokens: 5 });
  assert.equal((await gate(id)).remaining, 1);
  await record(id, { input_tokens: 1, output_tokens: 1 });
  const spent = await gate(id);
  assert.equal(spent.ok, false); assert.equal(spent.status, 402);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [biz])).rows[0].n, 2);
});
