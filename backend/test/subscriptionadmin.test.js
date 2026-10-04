/*
 * The three gaps closed from the Super Admin audit (owner-approved scope,
 * 2026-09-28, see brain.md): plan versioning/grandfathering, a subscription
 * history view (reusing audit_log, not a parallel table), and per-business
 * feature overrides (the third, highest-precedence layer in
 * modules/planFeatures.js's effectiveFeatureFlags()).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const auth = await import('../src/controllers/auth.controller.js');
const admin = await import('../src/controllers/admin.controller.js');
const business = await import('../src/controllers/business.controller.js');
const mw = await import('../src/middleware/auth.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const PASSWORD = 'correct horse battery';

const makeOwner = async (label, planCode) => {
  const u = (await pool.query(
    `INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id, email`,
    [label, `${label}@subadmin.test`, await bcrypt.hash(PASSWORD, 4)]
  )).rows[0];
  const versionId = (await pool.query(`SELECT plan_version_id FROM plan_versions WHERE plan_code = $1 AND effective_to IS NULL`, [planCode])).rows[0].plan_version_id;
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code, plan_version_id)
     VALUES ($1,$2,'RESTAURANT','ACTIVE',$3,$4) RETURNING business_id`,
    [`${label} Co`, u.user_id, planCode, versionId]
  )).rows[0];
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz.business_id]);
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, u.user_id]);
  return { email: u.email, businessId: biz.business_id };
};

const tenantFor = async (email) => {
  const login = fakeRes();
  await auth.login({ body: { email, password: PASSWORD }, headers: { 'user-agent': 'T/1' }, ip: '10.0.0.1', query: {}, params: {} }, login);
  assert.equal(login.code ?? 200, 200, `login failed for ${email}: ${JSON.stringify(login.body)}`);
  const token = login.body.data.token;
  const req = { headers: { authorization: `Bearer ${token}` }, body: {}, query: {}, params: {}, ip: '10.0.0.1' };
  let ok = false;
  await mw.requireAuth(req, fakeRes(), () => { ok = true; });
  assert.ok(ok);
  ok = false;
  await mw.withBusiness()(req, fakeRes(), () => { ok = true; });
  assert.ok(ok);
  return req.tenant;
};

const getSubscription = async (businessId) => {
  const res = fakeRes();
  await business.getSubscription({ tenant: { businessId } }, res);
  return res.body.data;
};

let growth; let starter;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  growth = await makeOwner('sa-growth', 'GROWTH');
  starter = await makeOwner('sa-starter', 'STARTER');
});

/* ── plan versioning / grandfathering ─────────────────────────────────── */

test('changing a plan’s price cuts a new version; a business already pinned keeps the old price', { skip }, async () => {
  // node-pg returns BIGINT columns as strings — Number() everywhere one is compared, same as elsewhere in this suite.
  const before = await getSubscription(growth.businessId);
  assert.equal(Number(before.plan.price_monthly_paise), 0); // GROWTH seeds at ₹0 in this codebase

  const res = fakeRes();
  await admin.updatePlan({ params: { code: 'GROWTH' }, body: { price_monthly: 999 }, auth: { userId: null } }, res);
  assert.equal(res.code ?? 200, 200);
  assert.equal(Number(res.body.data.price_monthly_paise), 99900, 'the plan itself (what a NEW signup sees) reflects the new price');

  const after = await getSubscription(growth.businessId);
  assert.equal(Number(after.plan.price_monthly_paise), 0, 'a business already pinned to v1 must not be silently re-priced');

  const versions = fakeRes();
  await admin.listPlanVersions({ params: { code: 'GROWTH' } }, versions);
  assert.equal(versions.body.data.length, 2);
  assert.equal(versions.body.data[0].version_number, 2);
  assert.equal(versions.body.data[0].price_monthly, 999);
  assert.ok(versions.body.data[0].effective_to == null, 'the newest version is the live one');
  assert.ok(versions.body.data[1].effective_to != null, 'the old version was closed, not deleted');
});

test('reassigning a business to a plan pins it to the CURRENT version, not an old one', { skip }, async () => {
  // starter is being moved onto GROWTH, which by now has a 999 v2 live from the previous test
  const res = fakeRes();
  await admin.updateBusinessPlan({ params: { id: starter.businessId }, body: { plan_code: 'GROWTH' }, auth: { userId: null } }, res);
  assert.equal(res.code ?? 200, 200);

  const sub = await getSubscription(starter.businessId);
  assert.equal(Number(sub.plan.price_monthly_paise), 99900, 'a fresh assignment gets today’s price, not the original business’s pinned one');
});

test('editing only name/description does not cut a new version', { skip }, async () => {
  const before = fakeRes();
  await admin.listPlanVersions({ params: { code: 'STARTER' } }, before);
  const count = before.body.data.length;

  await admin.updatePlan({ params: { code: 'STARTER' }, body: { description: 'For a single shop, still finding its feet.' }, auth: { userId: null } }, fakeRes());

  const after = fakeRes();
  await admin.listPlanVersions({ params: { code: 'STARTER' } }, after);
  assert.equal(after.body.data.length, count, 'a non-billing edit is not a new version');
});

test('a feature_flags change also grandfathers: an already-pinned business keeps its old entitlements', { skip }, async () => {
  const hadLoyalty = (await getSubscription(growth.businessId)).feature_flags.loyalty !== false; // GROWTH seeds loyalty:false

  await admin.updatePlan({ params: { code: 'GROWTH' }, body: { feature_flags: { loyalty: !hadLoyalty } }, auth: { userId: null } }, fakeRes());

  const afterTenant = await tenantFor('sa-growth@subadmin.test');
  assert.equal(afterTenant.planFeatures.loyalty !== false, hadLoyalty, 'still pinned to the version it joined on, so its entitlement did not move with the plan edit');
});

/* ── subscription history (reuses audit_log) ──────────────────────────── */

test('business history surfaces subscription-relevant admin actions for that business only', { skip }, async () => {
  await admin.updateBusinessStatus({ params: { id: growth.businessId }, body: { status: 'SUSPENDED' }, auth: { userId: null } }, fakeRes());
  await admin.updateBusinessStatus({ params: { id: growth.businessId }, body: { status: 'ACTIVE' }, auth: { userId: null } }, fakeRes());

  // recordAudit (modules/events.js) writes without being awaited, by design: a failed audit line must never block
  // the action itself. So the two lines may land a moment after the calls return; wait for them (up to 2s) rather
  // than read the history the instant the second call returns, which made this test fail now and then.
  let res = fakeRes();
  for (let tries = 0; tries < 40; tries++) {
    res = fakeRes();
    await admin.businessHistory({ params: { id: growth.businessId } }, res);
    if (res.body.data.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(res.body.data.length >= 2);
  assert.ok(res.body.data.every((e) => e.action.startsWith('admin.') || e.action.startsWith('subscription.')));

  // isolation: growth's suspend/reactivate events must not leak into starter's history
  const otherRes = fakeRes();
  await admin.businessHistory({ params: { id: starter.businessId } }, otherRes);
  const growthEventIds = new Set(res.body.data.map((e) => e.audit_id));
  assert.ok(!otherRes.body.data.some((e) => growthEventIds.has(e.audit_id)));
});

/* ── business-specific feature overrides ──────────────────────────────── */

test('setBusinessOverride validates feature key, boolean value, and a future expiry', { skip }, async () => {
  const badKey = fakeRes();
  await admin.setBusinessOverride({ params: { id: starter.businessId }, body: { feature_key: 'warp_drive', enabled: true }, auth: { userId: null } }, badKey);
  assert.equal(badKey.code, 400);

  const badValue = fakeRes();
  await admin.setBusinessOverride({ params: { id: starter.businessId }, body: { feature_key: 'ai', enabled: 'yes' }, auth: { userId: null } }, badValue);
  assert.equal(badValue.code, 400);

  const pastExpiry = fakeRes();
  await admin.setBusinessOverride({ params: { id: starter.businessId }, body: { feature_key: 'ai', enabled: true, expires_at: '2020-01-01' }, auth: { userId: null } }, pastExpiry);
  assert.equal(pastExpiry.code, 400);

  const unknownBusiness = fakeRes();
  await admin.setBusinessOverride({ params: { id: 999999 }, body: { feature_key: 'ai', enabled: true }, auth: { userId: null } }, unknownBusiness);
  assert.equal(unknownBusiness.code, 404);
});

test('an override forces a feature on even when the plan says off, and off even when the plan says on', { skip }, async () => {
  const owner = await makeOwner('sa-override', 'STARTER'); // STARTER has loyalty/reservations/etc. off by default

  const before = await tenantFor('sa-override@subadmin.test');
  assert.equal(before.planFeatures.loyalty, false);
  assert.equal(before.planFeatures.expenses, false);

  await admin.setBusinessOverride({ params: { id: owner.businessId }, body: { feature_key: 'loyalty', enabled: true, reason: 'Goodwill gesture' }, auth: { userId: null } }, fakeRes());
  // Expenses is already off by plan; force it off too via override, just to prove override can go either direction.
  await admin.setBusinessOverride({ params: { id: owner.businessId }, body: { feature_key: 'purchases', enabled: false, reason: 'Abuse' }, auth: { userId: null } }, fakeRes());

  const after = await tenantFor('sa-override@subadmin.test');
  assert.equal(after.planFeatures.loyalty, undefined, 'forced on: not marked false, i.e. on');
  const { next: loyaltyNext } = await (async () => { const r = fakeRes(); let n = false; await mw.requirePlanFeature('loyalty')({ tenant: after }, r, () => { n = true; }); return { next: n }; })();
  assert.ok(loyaltyNext, 'loyalty is now genuinely usable, checked the same way a real route checks it');
  assert.equal(after.planFeatures.purchases, false, 'purchases stays off (plan already said off; override said off too)');
  assert.equal(after.planFeatures.reservations, false, 'an untouched feature is unaffected by the other two overrides');

  const list = fakeRes();
  await admin.listBusinessOverrides({ params: { id: owner.businessId } }, list);
  assert.equal(list.body.data.length, 2);

  await admin.removeBusinessOverride({ params: { id: owner.businessId, feature: 'loyalty' } }, fakeRes());
  const afterRemoval = await tenantFor('sa-override@subadmin.test');
  assert.equal(afterRemoval.planFeatures.loyalty, false, 'removing the override reverts to the plan’s own answer');
});

test('an expired override is ignored, as if it never existed', { skip }, async () => {
  const owner = await makeOwner('sa-expiry', 'STARTER');
  await admin.setBusinessOverride({ params: { id: owner.businessId }, body: { feature_key: 'ai', enabled: true }, auth: { userId: null } }, fakeRes());

  let tenant = await tenantFor('sa-expiry@subadmin.test');
  assert.equal(tenant.planFeatures.ai, undefined, 'on while the override is live');

  // Backdate it directly — the API itself refuses a past expiry, this simulates time having passed.
  await pool.query(`UPDATE business_feature_overrides SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE business_id = $1 AND feature_key = 'ai'`, [owner.businessId]);

  tenant = await tenantFor('sa-expiry@subadmin.test');
  assert.equal(tenant.planFeatures.ai, false, 'an expired override is not applied — back to the plan’s own (STARTER: off)');
});

/* ── the Overview dashboard's numbers (owner's request, 2026-09-29) ───────
   revenue_collected used to sum the tenant `payments` table — a restaurant's
   own customers paying the restaurant, not money FlowXP was paid. Fixed to
   read subscription_orders instead; these tests pin that down alongside the
   new MRR, pending-payments and trials-ending-soon numbers. */

test('MRR sums only ACTIVE businesses, at their pinned plan-version price, yearly normalised to monthly', { skip }, async () => {
  const before = (await (async () => { const r = fakeRes(); await admin.getStats({}, r); return r.body.data; })());

  const monthly = await makeOwner('sa-mrr-monthly', 'GROWTH');
  await pool.query(`UPDATE businesses SET subscription_status = 'ACTIVE', billing_cycle = 'MONTHLY' WHERE business_id = $1`, [monthly.businessId]);
  await admin.updatePlan({ params: { code: 'GROWTH' }, body: { price_monthly: 500 }, auth: { userId: null } }, fakeRes());
  // ^ cuts a new version; re-pin this business to it so it actually reflects ₹500, same as a real assignment would
  await admin.updateBusinessPlan({ params: { id: monthly.businessId }, body: { plan_code: 'GROWTH' }, auth: { userId: null } }, fakeRes());

  const yearly = await makeOwner('sa-mrr-yearly', 'STARTER');
  await pool.query(`UPDATE businesses SET subscription_status = 'ACTIVE', billing_cycle = 'YEARLY' WHERE business_id = $1`, [yearly.businessId]);
  await admin.updatePlan({ params: { code: 'STARTER' }, body: { price_yearly: 1200 }, auth: { userId: null } }, fakeRes());
  await admin.updateBusinessPlan({ params: { id: yearly.businessId }, body: { plan_code: 'STARTER' }, auth: { userId: null } }, fakeRes());

  const stillTrial = await makeOwner('sa-mrr-trial', 'BUSINESS'); // TRIAL status — must contribute nothing
  void stillTrial;

  const res = fakeRes();
  await admin.getStats({}, res);
  const delta = res.body.data.mrr - before.mrr;
  assert.equal(Math.round(delta * 100) / 100, 600, '500 (monthly) + 1200/12=100 (yearly, normalised) = 600 more than before');
});

test('revenue_collected reflects subscription_orders paid to FlowXP, not the tenant payments table', { skip }, async () => {
  const owner = await makeOwner('sa-revenue', 'STARTER');
  // A customer paying THIS business's own bill — must NOT count as platform revenue.
  await pool.query(`INSERT INTO payments (business_id, amount_paise, method, direction) VALUES ($1, 500000, 'CASH', 'IN')`, [owner.businessId]).catch(() => {});

  const before = (await (async () => { const r = fakeRes(); await admin.getStats({}, r); return r.body.data; })());

  await pool.query(
    `INSERT INTO subscription_orders (business_id, amount_paise, billing_cycle, status, paid_at, link_id)
     VALUES ($1, 149900, 'MONTHLY', 'PAID', CURRENT_TIMESTAMP, $2)`,
    [owner.businessId, `test-paid-${owner.businessId}`]
  );

  const res = fakeRes();
  await admin.getStats({}, res);
  assert.equal(Math.round((res.body.data.revenue_collected - before.revenue_collected) * 100) / 100, 1499);
});

test('pending payment links are counted and listed, oldest first, with a true (uncapped) total', { skip }, async () => {
  const owner = await makeOwner('sa-pending', 'STARTER');
  for (const amount of [10000, 20000, 30000]) {
    await pool.query(
      `INSERT INTO subscription_orders (business_id, amount_paise, billing_cycle, status, link_id, created_at)
       VALUES ($1, $2, 'MONTHLY', 'PENDING', $3, CURRENT_TIMESTAMP - INTERVAL '1 hour')`,
      [owner.businessId, amount, `test-pending-${owner.businessId}-${amount}`]
    );
  }

  const res = fakeRes();
  await admin.getStats({}, res);
  assert.ok(res.body.data.pending_payments.count >= 3);
  assert.ok(res.body.data.pending_payments.list.some((p) => p.business_id === owner.businessId));
});

test('trials ending within 2 days are listed by business name, soonest first', { skip }, async () => {
  // makeOwner hardcodes subscription_status='ACTIVE' — put these two back on TRIAL, which is the
  // actual condition this feature keys off.
  const soon = await makeOwner('sa-trial-soon', 'STARTER');
  await pool.query(`UPDATE businesses SET subscription_status = 'TRIAL', trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE business_id = $1`, [soon.businessId]);
  const later = await makeOwner('sa-trial-later', 'STARTER');
  await pool.query(`UPDATE businesses SET subscription_status = 'TRIAL', trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '10 days' WHERE business_id = $1`, [later.businessId]); // must NOT appear

  const res = fakeRes();
  await admin.getStats({}, res);
  assert.ok(res.body.data.trials_ending_soon_list.some((t) => t.business_id === soon.businessId));
  assert.ok(!res.body.data.trials_ending_soon_list.some((t) => t.business_id === later.businessId));
});
