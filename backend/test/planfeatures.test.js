/*
 * Real, enforced feature gating (owner's request, 2026-09-28) on two
 * independent axes — `plans.feature_flags` (did they pay for this) and
 * `business_type_features.feature_flags`, keyed by (business type, plan)
 * since 2026-09-29 (does this apply to this kind of business at all, on this
 * plan) — combined by modules/planFeatures.js's effectiveFeatureFlags() into
 * what requirePlanFeature() actually checks.
 * Neither is the `features` marketing bullet list, which stays cosmetic.
 * Exercised through the real middleware chain (requireAuth -> withBusiness),
 * same as security.test.js, not just the pure predicate, so the SQL joins
 * that attach both to req.tenant are proven too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const auth = await import('../src/controllers/auth.controller.js');
const admin = await import('../src/controllers/admin.controller.js');
const mw = await import('../src/middleware/auth.js');
const publicOrdering = await import('../src/controllers/publicOrdering.controller.js');
const integrations = await import('../src/controllers/integrations.controller.js');
const { PLAN_FEATURE_KEYS, hasPlanFeature } = await import('../src/modules/planFeatures.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const PASSWORD = 'correct horse battery';

const makeOwner = async (label, planCode) => {
  const u = (await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING user_id, email`,
    [label, `${label}@planfeat.test`, await bcrypt.hash(PASSWORD, 4)]
  )).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code)
     VALUES ($1,$2,'RESTAURANT','ACTIVE',$3) RETURNING business_id`,
    [`${label} Co`, u.user_id, planCode]
  )).rows[0];
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz.business_id]);
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, u.user_id]);
  return { email: u.email, businessId: biz.business_id };
};

/** The real middleware chain a request goes through, ending with req.tenant populated. */
const tenantFor = async (email) => {
  const login = fakeRes();
  await auth.login({ body: { email, password: PASSWORD }, headers: { 'user-agent': 'T/1' }, ip: '10.0.0.1', query: {}, params: {} }, login);
  assert.equal(login.code ?? 200, 200, `login failed for ${email}: ${JSON.stringify(login.body)}`);
  const token = login.body.data.token;

  const req = { headers: { authorization: `Bearer ${token}` }, body: {}, query: {}, params: {}, ip: '10.0.0.1' };
  let ok = false;
  await mw.requireAuth(req, fakeRes(), () => { ok = true; });
  assert.ok(ok, 'requireAuth rejected a fresh login');
  ok = false;
  await mw.withBusiness()(req, fakeRes(), () => { ok = true; });
  assert.ok(ok, 'withBusiness rejected an active membership');
  return req.tenant;
};

const runsThrough = async (middleware, tenant) => {
  const res = fakeRes();
  let next = false;
  await middleware({ tenant }, res, () => { next = true; });
  return { next, res };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  await makeOwner('starter-owner', 'STARTER');
  await makeOwner('growth-owner', 'GROWTH');
  await makeOwner('business-owner', 'BUSINESS');
  await makeOwner('trial-owner', 'TRIAL');
});

test('withBusiness attaches each plan\'s real feature flags to req.tenant', { skip }, async () => {
  const starter = await tenantFor('starter-owner@planfeat.test');
  assert.deepEqual(starter.planFeatures, {
    loyalty: false, messaging: false, reservations: false, purchases: false, expenses: false, ai: false, advanced_reports: false
  });

  const growth = await tenantFor('growth-owner@planfeat.test');
  assert.deepEqual(growth.planFeatures, { loyalty: false, messaging: false, reservations: false, advanced_reports: false });
  // Growth's marketing copy explicitly includes these — must not have been switched off.
  assert.equal(growth.planFeatures.purchases, undefined);
  assert.equal(growth.planFeatures.expenses, undefined);
  assert.equal(growth.planFeatures.ai, undefined);

  const business = await tenantFor('business-owner@planfeat.test');
  assert.deepEqual(business.planFeatures, {});

  const trial = await tenantFor('trial-owner@planfeat.test');
  assert.deepEqual(trial.planFeatures, {}, 'trial must ship with every feature on');
});

// integrations and qr_ordering were added after Starter/Growth were seeded and were deliberately
// left ON everywhere by default (missing key = on) rather than silently restricting two big,
// already-shipped features for existing businesses the moment they were added to the catalog.
const STARTER_RESTRICTED = ['loyalty', 'messaging', 'reservations', 'purchases', 'expenses', 'ai', 'advanced_reports'];

test('requirePlanFeature refuses a plan without the feature, with a 402 an owner can act on', { skip }, async () => {
  const starter = await tenantFor('starter-owner@planfeat.test');
  for (const key of STARTER_RESTRICTED) {
    const { next, res } = await runsThrough(mw.requirePlanFeature(key), starter);
    assert.equal(next, false, `STARTER should be refused ${key}`);
    assert.equal(res.code, 402);
    assert.equal(res.body.code, 'FEATURE_NOT_IN_PLAN');
    assert.equal(res.body.data.feature, key);
  }
  for (const key of ['integrations', 'qr_ordering']) {
    assert.ok((await runsThrough(mw.requirePlanFeature(key), starter)).next, `STARTER should still have ${key} (on by default)`);
  }

  const business = await tenantFor('business-owner@planfeat.test');
  for (const key of PLAN_FEATURE_KEYS) {
    const { next } = await runsThrough(mw.requirePlanFeature(key), business);
    assert.ok(next, `BUSINESS should have ${key}`);
  }

  // Growth: purchases/expenses/ai on, the rest off — proves it isn't all-or-nothing.
  const growth = await tenantFor('growth-owner@planfeat.test');
  for (const key of ['purchases', 'expenses', 'ai']) {
    assert.ok((await runsThrough(mw.requirePlanFeature(key), growth)).next, `GROWTH should have ${key}`);
  }
  for (const key of ['loyalty', 'messaging', 'reservations', 'advanced_reports']) {
    assert.equal((await runsThrough(mw.requirePlanFeature(key), growth)).next, false, `GROWTH should not have ${key}`);
  }
});

test('a missing tenant, or a plan with no flags set at all, defaults to every feature on', () => {
  for (const key of PLAN_FEATURE_KEYS) {
    assert.equal(hasPlanFeature({ planFeatures: {} }, key), true);
    assert.equal(hasPlanFeature(null, key), true);
  }
  assert.equal(hasPlanFeature({ planFeatures: { loyalty: false } }, 'loyalty'), false);
});

/* ── admin: turning a feature on/off, and the catalog the admin page reads ── */

test('the feature catalog lists exactly the keys the middleware understands', { skip }, async () => {
  const res = fakeRes();
  admin.planFeatureCatalog({}, res);
  assert.deepEqual(res.body.data.map((f) => f.key).sort(), [...PLAN_FEATURE_KEYS].sort());
  assert.ok(res.body.data.every((f) => f.label && f.description));
});

test('updatePlan rejects an unknown feature key or a non-boolean value', { skip }, async () => {
  const bad1 = fakeRes();
  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { not_a_real_feature: true } } }, bad1);
  assert.equal(bad1.code, 400);

  const bad2 = fakeRes();
  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { loyalty: 'yes' } } }, bad2);
  assert.equal(bad2.code, 400);

  const bad3 = fakeRes();
  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: ['loyalty'] } }, bad3);
  assert.equal(bad3.code, 400);
});

test('updatePlan toggles one feature without clobbering the others already set', { skip }, async () => {
  const on = fakeRes();
  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { loyalty: true } } }, on);
  assert.equal(on.code ?? 200, 200);
  assert.equal(on.body.data.feature_flags.loyalty, true);
  // Everything else STARTER had off must still be off — a partial PATCH is a merge, not a replace.
  assert.equal(on.body.data.feature_flags.messaging, false);
  assert.equal(on.body.data.feature_flags.purchases, false);

  // And it takes effect immediately for a STARTER business already signed in.
  const starter = await tenantFor('starter-owner@planfeat.test');
  assert.ok((await runsThrough(mw.requirePlanFeature('loyalty'), starter)).next, 'loyalty should now be on for STARTER');
  assert.equal((await runsThrough(mw.requirePlanFeature('messaging'), starter)).next, false);

  // put it back so the rest of the suite (and other test files sharing this DB image) sees STARTER as originally seeded
  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { loyalty: false } } }, fakeRes());
});

/* ── qr_ordering and integrations gate the two public, unauthenticated paths
   (the QR menu and a delivery platform's webhook) — no req.tenant there, so
   they check the business's plan directly rather than going through
   requirePlanFeature(). Both default ON (see modules/planFeatures.js), so
   this also proves a feature added after Starter/Growth were seeded doesn't
   silently switch itself off for them. ────────────────────────────────── */

test('QR table ordering is on by default, and the admin can switch it off per plan', { skip }, async () => {
  const businessId = (await pool.query(`SELECT business_id FROM businesses WHERE name = 'starter-owner Co'`)).rows[0].business_id;
  const branchId = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1`, [businessId])).rows[0].branch_id;
  const token = 'qr-gate-test';
  await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'Q1',$3)`, [businessId, branchId, token]);

  const on = fakeRes();
  await publicOrdering.getMenu({ params: { token } }, on);
  assert.equal(on.code ?? 200, 200, 'qr_ordering should be on by default for STARTER');

  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { qr_ordering: false } } }, fakeRes());
  const off = fakeRes();
  await publicOrdering.getMenu({ params: { token } }, off);
  assert.equal(off.code, 404, 'a diner sees "not available", the same as a closed table — not an error page');

  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { qr_ordering: true } } }, fakeRes());
  const restored = fakeRes();
  await publicOrdering.getMenu({ params: { token } }, restored);
  assert.equal(restored.code ?? 200, 200);

  // The business-type axis (migration 0044) gates the public QR menu too, not just the plan's own
  // flag — this predates that axis and only ever checked `plans` directly until 2026-09-29 (Cloud
  // Kitchen has no tables to scan), so this proves the fix actually reaches this endpoint.
  await admin.updateBusinessTypeFeature({ params: { type: 'RESTAURANT', plan: 'STARTER' }, body: { feature_flags: { qr_ordering: false } } }, fakeRes());
  const offByType = fakeRes();
  await publicOrdering.getMenu({ params: { token } }, offByType);
  assert.equal(offByType.code, 404, 'a business-type-level switch must also be honoured here, not just the plan');
  // Clear the row entirely rather than set qr_ordering back to true — a later test in this file
  // asserts a fresh (type, plan) pair has no keys at all, and merging would leave one behind.
  await pool.query(`DELETE FROM business_type_features WHERE business_type = 'RESTAURANT' AND plan_code = 'STARTER'`);
  const restoredByType = fakeRes();
  await publicOrdering.getMenu({ params: { token } }, restoredByType);
  assert.equal(restoredByType.code ?? 200, 200);
});

test('a delivery webhook is rejected once integrations is switched off for the plan, without touching is_enabled', { skip }, async () => {
  const businessId = (await pool.query(`SELECT business_id FROM businesses WHERE name = 'starter-owner Co'`)).rows[0].business_id;
  const token = 'a'.repeat(40);
  await pool.query(`INSERT INTO delivery_integrations (business_id, platform, is_enabled, webhook_token) VALUES ($1,'ZOMATO',TRUE,$2)`, [businessId, token]);
  const payload = { order: { id: 'FEAT1', display_id: '#FEAT1', customer: { name: 'X', phone: '+919000000000' }, items: [{ name: 'Item', quantity: 1, price: 100 }] } };
  const webhookReq = () => ({ params: { platform: 'zomato', token }, body: payload, headers: {}, ip: '127.0.0.1' });

  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { integrations: false } } }, fakeRes());
  const blocked = fakeRes();
  await integrations.webhook(webhookReq(), blocked);
  assert.equal(blocked.code, 403);
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM orders WHERE business_id = $1`, [businessId])).rows[0].n, '0');

  await admin.updatePlan({ params: { code: 'STARTER' }, body: { feature_flags: { integrations: true } } }, fakeRes());
  const allowed = fakeRes();
  await integrations.webhook(webhookReq(), allowed);
  assert.equal(allowed.code, 201);
});

/* ── the second gate: business type, independent of plan ──────────────────
   Every test business above is RESTAURANT, so these exercise the same type
   the rest of the file already relies on defaulting to "everything on". */

test('the business-type catalog lists every type crossed with every public plan, defaulting to every feature on', { skip }, async () => {
  const res = fakeRes();
  await admin.listBusinessTypeFeatures({}, res);
  const restaurantRows = res.body.data.filter((t) => t.business_type === 'RESTAURANT');
  assert.deepEqual(restaurantRows.map((r) => r.plan_code).sort(), ['ENTERPRISE', 'GROWTH', 'STARTER']);
  assert.ok(restaurantRows.every((r) => Object.keys(r.feature_flags).length === 0));
  assert.ok(res.body.data.some((t) => t.business_type === 'SALON'), 'every BUSINESS_TYPES entry should be listed, configured or not');
});

test('updateBusinessTypeFeature rejects an unknown type, an unknown plan, an unknown key, or a non-boolean value', { skip }, async () => {
  const badType = fakeRes();
  await admin.updateBusinessTypeFeature({ params: { type: 'SPACESHIP', plan: 'GROWTH' }, body: { feature_flags: { ai: false } } }, badType);
  assert.equal(badType.code, 400);

  const badPlan = fakeRes();
  await admin.updateBusinessTypeFeature({ params: { type: 'SALON', plan: 'ULTRA' }, body: { feature_flags: { ai: false } } }, badPlan);
  assert.equal(badPlan.code, 400);

  const badKey = fakeRes();
  await admin.updateBusinessTypeFeature({ params: { type: 'SALON', plan: 'GROWTH' }, body: { feature_flags: { warp_drive: true } } }, badKey);
  assert.equal(badKey.code, 400);

  const badValue = fakeRes();
  await admin.updateBusinessTypeFeature({ params: { type: 'SALON', plan: 'GROWTH' }, body: { feature_flags: { ai: 'nope' } } }, badValue);
  assert.equal(badValue.code, 400);
});

test('a business type with a feature switched off refuses it even on a plan that has everything, and leaves other plans for that type untouched', { skip }, async () => {
  // Enterprise plan has every feature on (seeded {}); business type is the only thing saying no here.
  const enterprise = await makeOwner('enterprise-owner', 'ENTERPRISE');
  const before = await tenantFor('enterprise-owner@planfeat.test');
  assert.ok((await runsThrough(mw.requirePlanFeature('reservations'), before)).next, 'sanity check: ENTERPRISE plan has reservations before we touch the type');

  await admin.updateBusinessTypeFeature({ params: { type: 'RESTAURANT', plan: 'ENTERPRISE' }, body: { feature_flags: { reservations: false } } }, fakeRes());

  const afterTypeOff = await tenantFor('enterprise-owner@planfeat.test');
  const blocked = await runsThrough(mw.requirePlanFeature('reservations'), afterTypeOff);
  assert.equal(blocked.next, false, 'a RESTAURANT with reservations switched off for its type on this plan must be refused');
  assert.equal(blocked.res.code, 402);
  // other features for this (type, plan) are untouched — this is a merge, and it is specific to `reservations`
  assert.ok((await runsThrough(mw.requirePlanFeature('loyalty'), afterTypeOff)).next);

  // a RESTAURANT on a DIFFERENT plan is untouched — the switch is specific to (type, plan), not the whole type
  const growth = await tenantFor('growth-owner@planfeat.test');
  assert.ok((await runsThrough(mw.requirePlanFeature('reservations'), growth)).next === false, 'sanity check: GROWTH already has reservations off from its own plan flags');
  await admin.updatePlan({ params: { code: 'GROWTH' }, body: { feature_flags: { reservations: true } } }, fakeRes());
  const growthNow = await tenantFor('growth-owner@planfeat.test');
  assert.ok((await runsThrough(mw.requirePlanFeature('reservations'), growthNow)).next, 'GROWTH/RESTAURANT must still have reservations — the ENTERPRISE-only switch above must not have leaked');
  await admin.updatePlan({ params: { code: 'GROWTH' }, body: { feature_flags: { reservations: false } } }, fakeRes()); // restore GROWTH's original seed

  // put it back so this doesn't affect any test running later in this same file
  await admin.updateBusinessTypeFeature({ params: { type: 'RESTAURANT', plan: 'ENTERPRISE' }, body: { feature_flags: { reservations: true } } }, fakeRes());
  const restored = await tenantFor('enterprise-owner@planfeat.test');
  assert.ok((await runsThrough(mw.requirePlanFeature('reservations'), restored)).next);
});
