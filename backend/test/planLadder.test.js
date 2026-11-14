/* Plans and add-ons migration 0127: the ladder per plan and per industry, and that nothing already priced is overwritten. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { effectiveFeatureFlags } from '../src/modules/planFeatures.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

const flags = async (type, plan) => {
  const p = (await pool.query(`SELECT feature_flags FROM plans WHERE plan_code = $1`, [plan])).rows[0].feature_flags;
  const t = (await pool.query(`SELECT feature_flags FROM business_type_features WHERE business_type = $1 AND plan_code = $2`, [type, plan])).rows[0]?.feature_flags || {};
  const f = effectiveFeatureFlags([p, t], {}, type, undefined);
  return (k) => f[k] !== false;
};

test('each plan and industry gets its step of the ladder', { skip }, async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const prices = (await pool.query(`SELECT plan_code, price_monthly_paise p, price_yearly_paise y FROM plans WHERE plan_code IN ('STARTER','GROWTH','ENTERPRISE') ORDER BY 1`)).rows;
  assert.deepEqual(prices.map((r) => [r.plan_code, Number(r.p), Number(r.y)]), [['ENTERPRISE', 0, 0], ['GROWTH', 99900, 999900], ['STARTER', 49900, 499900]]);

  const rs = await flags('RESTAURANT', 'STARTER'); const rg = await flags('RESTAURANT', 'GROWTH'); const re = await flags('RESTAURANT', 'ENTERPRISE');
  assert.ok(!rs('messaging') && !rs('ai') && !rs('purchases') && rs('estimates') === false /* food has no estimates */);
  assert.ok(rg('messaging') && rg('ai') && rg('loyalty') && rg('qr_ordering') && !rg('integrations') && !rg('advanced_reports'));
  assert.ok(re('integrations') && re('advanced_reports') && re('multi_brand'));

  const g1 = await flags('GYM', 'STARTER'); const g2 = await flags('GYM', 'GROWTH'); const g3 = await flags('GYM', 'ENTERPRISE');
  assert.ok(g1('gym_access') && !g1('gym_classes') && !g1('gym_devices'));
  assert.ok(g2('gym_classes') && g2('gym_self_checkin') && !g2('gym_devices'));
  assert.ok(g3('gym_devices'));

  const m1 = await flags('MECHANIC', 'STARTER'); const m2 = await flags('MECHANIC', 'GROWTH');
  assert.ok(m1('ap_jobcards') && m1('ap_catalog') && !m1('ap_racks') && !m1('ap_staff'));
  assert.ok(m2('ap_racks') && m2('ap_staff') && !m2('ap_intelligence'));

  const salon = await flags('SALON', 'STARTER');
  assert.ok(salon('salon_appointments') && !salon('salon_memberships'));
  assert.ok((await flags('CLOTHING', 'STARTER'))('cl_catalog'), 'clothing keeps its catalogue on every plan');
});

test('Flow AI and Loyalty: every industry, from Growth, never on Starter', { skip }, async () => {
  for (const type of ['RESTAURANT', 'RETAIL', 'SALON', 'GYM', 'MECHANIC', 'WHOLESALE', 'DISTRIBUTOR', 'CLOTHING', 'OTHER']) {
    const [s, g, e] = [await flags(type, 'STARTER'), await flags(type, 'GROWTH'), await flags(type, 'ENTERPRISE')];
    for (const k of ['loyalty', 'ai']) assert.ok(!s(k) && g(k) && e(k), `${type} ${k}`);
  }
});

test('add-ons exist for what is held back; an existing price is kept', { skip }, async () => {
  const a = (await pool.query(`SELECT addon_key, price_monthly_paise m FROM addons WHERE addon_key IN ('gym_classes','ap_racks','advanced_reports','integrations') ORDER BY 1`)).rows;
  assert.equal(a.length, 4);
  assert.equal(Number(a.find((x) => x.addon_key === 'gym_classes').m), 29900);
  await pool.query(`UPDATE addons SET price_monthly_paise = 12300 WHERE addon_key = 'gym_classes'`);
  await pool.query(`DELETE FROM schema_migrations WHERE name = '0127_plans_and_addons.js'`);
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  assert.equal(Number((await pool.query(`SELECT price_monthly_paise m FROM addons WHERE addon_key = 'gym_classes'`)).rows[0].m), 12300, 'a price already set is kept');
  assert.equal(Number((await pool.query(`SELECT count(*) n FROM plan_versions WHERE plan_code = 'STARTER'`)).rows[0].n) >= 2, true, 'prices cut a new version');
});

test('the Super Admin can change a plan\'s limits and website list; bad values are refused', { skip }, async () => {
  const { updatePlan } = await import('../src/controllers/admin.controller.js');
  const uid = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Admin','a@pl.test','x') RETURNING user_id`)).rows[0].user_id;
  const call = async (body) => { let out; await updatePlan({ params: { code: 'STARTER' }, body, auth: { userId: uid }, ip: '127.0.0.1', headers: {} }, { status(c) { this.code = c; return this; }, json(b) { out = { code: this.code ?? 200, body: b }; return this; } }); return out; };
  const v0 = Number((await pool.query(`SELECT count(*) n FROM plan_versions WHERE plan_code = 'STARTER'`)).rows[0].n);
  const ok = await call({ limits: { users: 3, outlets: '', ai_queries: 150 }, features: ['Billing', 'Stock'] });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.limits, { users: 3, outlets: null, ai_queries: 150 });
  assert.deepEqual(ok.body.data.features, ['Billing', 'Stock']);
  assert.equal(Number((await pool.query(`SELECT count(*) n FROM plan_versions WHERE plan_code = 'STARTER'`)).rows[0].n), v0 + 1, 'a limit change cuts a version');
  assert.equal((await call({ limits: { users: -1 } })).code, 400);
  assert.equal((await call({ limits: { users: 2.5 } })).code, 400);
  assert.equal((await call({ features: [''] })).code, 400);
});

test('every feature belongs to a group the Super Admin screens can list it under', async () => {
  const { PLAN_FEATURE_KEYS, FEATURE_GROUPS, featureGroup } = await import('../src/modules/planFeatures.js');
  const known = FEATURE_GROUPS.map(([k]) => k);
  for (const k of PLAN_FEATURE_KEYS) assert.ok(known.includes(featureGroup(k)), k);
  assert.equal(featureGroup('salon_packages'), 'salon'); assert.equal(featureGroup('kitchen'), 'food'); assert.equal(featureGroup('wholesale_orders'), 'common'); assert.equal(featureGroup('ai'), 'common');
});
