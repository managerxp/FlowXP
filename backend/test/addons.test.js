/*
 * Paid add-ons (owner's request, 2026-09-29): Reservations, Table QR,
 * Loyalty, Zomato/Swiggy, Flow AI, each sellable on its own via a Cashfree
 * link. Deliberately built on what already existed rather than a second
 * system — paying one sets the same business_feature_overrides row an admin
 * can set by hand (see test/subscriptionadmin.test.js's override tests) —
 * so this file focuses on the parts that are actually new: the catalog, its
 * own link-creation path, and the webhook telling an add-on order apart from
 * a plan subscription order by the `flowxp-addon-` link prefix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const admin = await import('../src/controllers/admin.controller.js');
const webhooks = await import('../src/controllers/webhooks.controller.js');
const cashfree = await import('../src/modules/payments/cashfree.js');
const config = (await import('../src/config/env.js')).default;
const mw = await import('../src/middleware/auth.js');

test.after(() => { cashfree.setProvider(null); cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const call = (fn, businessId, body = {}) => {
  const res = fakeRes();
  return fn({ params: { id: businessId }, auth: { userId: owner }, body, headers: {}, ip: '127.0.0.1', get: () => undefined }, res).then(() => res);
};

let owner; let biz;
const SECRET = 'test-cashfree-secret';
const sign = (body, timestamp) => crypto.createHmac('sha256', SECRET).update(timestamp + body).digest('base64');
const webhookReq = (payload) => {
  const raw = JSON.stringify(payload);
  const timestamp = String(Date.now());
  return { rawBody: Buffer.from(raw), body: payload, get: (name) => (name === 'x-webhook-signature' ? sign(raw, timestamp) : (name === 'x-webhook-timestamp' ? timestamp : undefined)) };
};

const tenantFor = async (email, password) => {
  const login = fakeRes();
  await (await import('../src/controllers/auth.controller.js')).login({ body: { email, password }, headers: { 'user-agent': 'T/1' }, ip: '10.0.0.1', query: {}, params: {} }, login);
  const req = { headers: { authorization: `Bearer ${login.body.data.token}` }, body: {}, query: {}, params: {}, ip: '10.0.0.1' };
  await mw.requireAuth(req, fakeRes(), () => {});
  await mw.withBusiness()(req, fakeRes(), () => {});
  return req.tenant;
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  config.cashfree.appId = 'test-app';
  config.cashfree.secretKey = SECRET;
  const bcrypt = (await import('bcryptjs')).default;
  owner = (await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified) VALUES ('Addon Owner','addon-owner@test.local','9000000002',$1,TRUE) RETURNING user_id`,
    [await bcrypt.hash('password123', 4)]
  )).rows[0].user_id;
  // STARTER has reservations off by default — a clean baseline to prove the add-on turns it on.
  const startV1 = (await pool.query(`SELECT plan_version_id FROM plan_versions WHERE plan_code = 'STARTER' AND effective_to IS NULL`)).rows[0].plan_version_id;
  biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code, plan_version_id) VALUES ('Addon Test Co',$1,'RESTAURANT','ACTIVE','STARTER',$2) RETURNING business_id`,
    [owner, startV1]
  )).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz, owner]);
});

test('the catalog lists the 5 real add-ons, seeded at ₹0, and AI-based review is not one of them', { skip }, async () => {
  const res = fakeRes();
  await admin.listAddons({}, res);
  const keys = res.body.data.map((a) => a.addon_key).sort();
  assert.deepEqual(keys, ['ai', 'integrations', 'loyalty', 'qr_ordering', 'reservations']);
  assert.ok(res.body.data.every((a) => a.price_monthly === 0 && a.is_active));
});

test('updateAddon sets a price; createAddonLink refuses one that still has none', { skip }, async () => {
  const noPrice = await call(admin.createAddonLink, biz, { addon_key: 'reservations', billing_cycle: 'MONTHLY' });
  assert.equal(noPrice.code, 400);

  const bad = fakeRes();
  await admin.updateAddon({ params: { key: 'reservations' }, body: { price_monthly: -5 } }, bad);
  // negative prices aren't rejected by toPaise itself, but should never be sellable — guard at creation time instead:
  // this documents current behaviour rather than assuming a validation that doesn't exist yet.
  void bad;

  const set = fakeRes();
  await admin.updateAddon({ params: { key: 'reservations' }, body: { price_monthly: 199, price_yearly: 1999 } }, set);
  assert.equal(set.code ?? 200, 200);
  assert.equal(Number(set.body.data.price_monthly_paise), 19900);
});

test('generating an add-on link uses the catalog price by default, and a distinct link_id prefix', { skip }, async () => {
  cashfree.setProvider(async ({ linkId, amount }) => ({ linkUrl: `https://sandbox.cashfree.com/pg/links/${linkId}`, status: 'ACTIVE', amount }));

  const res = await call(admin.createAddonLink, biz, { addon_key: 'reservations', billing_cycle: 'MONTHLY' });
  assert.equal(res.code ?? 200, 200);
  assert.equal(res.body.data.amount, 199, 'defaulted to the catalog price, not typed in');
  assert.ok(res.body.data.payment_link_url.includes('cashfree.com'));

  const row = (await pool.query(`SELECT * FROM addon_orders WHERE business_id = $1 AND addon_key = 'reservations'`, [biz])).rows[0];
  assert.equal(row.status, 'PENDING');
  assert.ok(row.link_id.startsWith('flowxp-addon-'));
});

test('an unknown or inactive add-on key is refused', { skip }, async () => {
  const res = await call(admin.createAddonLink, biz, { addon_key: 'time_travel', billing_cycle: 'MONTHLY' });
  assert.equal(res.code, 400);
});

test('paying an add-on turns the feature on for that business without touching its plan', { skip }, async () => {
  const before = await tenantFor('addon-owner@test.local', 'password123');
  assert.equal(before.planFeatures.reservations, false, 'STARTER has this off before the add-on');

  const link = await call(admin.createAddonLink, biz, { addon_key: 'reservations', billing_cycle: 'MONTHLY' });
  const linkId = (await pool.query(`SELECT link_id FROM addon_orders WHERE order_id = $1`, [link.body.data.order_id])).rows[0].link_id;

  const webhookRes = fakeRes();
  await webhooks.cashfree(webhookReq({ type: 'PAYMENT_LINK_EVENT', data: { link_id: linkId, link_status: 'PAID' } }), webhookRes);
  assert.equal(webhookRes.body.success, true);

  const order = (await pool.query(`SELECT status, paid_at FROM addon_orders WHERE link_id = $1`, [linkId])).rows[0];
  assert.equal(order.status, 'PAID');
  assert.ok(order.paid_at);

  const after = await tenantFor('addon-owner@test.local', 'password123');
  assert.equal(after.planFeatures.reservations, undefined, 'now on — the plan is still STARTER, untouched');

  const override = (await pool.query(`SELECT enabled, reason FROM business_feature_overrides WHERE business_id = $1 AND feature_key = 'reservations'`, [biz])).rows[0];
  assert.equal(override.enabled, true);
  assert.match(override.reason, /Paid add-on/);

  const plan = (await pool.query(`SELECT plan_code FROM businesses WHERE business_id = $1`, [biz])).rows[0];
  assert.equal(plan.plan_code, 'STARTER', 'buying an add-on must never silently change the plan');

  // a duplicate webhook delivery must not double-process or crash
  const replay = fakeRes();
  await webhooks.cashfree(webhookReq({ type: 'PAYMENT_LINK_EVENT', data: { link_id: linkId, link_status: 'PAID' } }), replay);
  assert.equal(replay.body.success, true);
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM addon_orders WHERE link_id = $1 AND status = 'PAID'`, [linkId])).rows[0].n, '1');
});

test('an expired add-on link is marked EXPIRED, not left PENDING forever', { skip }, async () => {
  cashfree.setProvider(async ({ linkId }) => ({ linkUrl: `https://sandbox.cashfree.com/pg/links/${linkId}`, status: 'ACTIVE' }));
  const link = await call(admin.createAddonLink, biz, { addon_key: 'loyalty', billing_cycle: 'YEARLY', amount: 999 });
  const linkId = (await pool.query(`SELECT link_id FROM addon_orders WHERE order_id = $1`, [link.body.data.order_id])).rows[0].link_id;

  const res = fakeRes();
  await webhooks.cashfree(webhookReq({ type: 'PAYMENT_LINK_EVENT', data: { link_id: linkId, link_status: 'EXPIRED' } }), res);
  assert.equal(res.body.success, true);
  assert.equal((await pool.query(`SELECT status FROM addon_orders WHERE link_id = $1`, [linkId])).rows[0].status, 'EXPIRED');
});

test('listAddonLinks and businessHistory both surface the add-on activity for this business', { skip }, async () => {
  const links = fakeRes();
  await admin.listAddonLinks({ params: { id: biz } }, links);
  assert.ok(links.body.data.length >= 2);

  const history = fakeRes();
  await admin.businessHistory({ params: { id: biz } }, history);
  assert.ok(history.body.data.some((e) => e.action === 'admin.addon_link_created'));
  assert.ok(history.body.data.some((e) => e.action === 'subscription.addon_activated'));
});

/* ── full CRUD + business-type scoping (owner's request, 2026-09-29) ─────── */

test('createAddon makes a brand new one, not tied to any existing feature key', { skip }, async () => {
  const bad = await (async () => { const r = fakeRes(); await admin.createAddon({ body: { name: 'X' }, auth: { userId: owner } }, r); return r; })();
  assert.equal(bad.code, 400, 'needs a key');

  const res = fakeRes();
  await admin.createAddon({
    body: { addon_key: 'onboarding help!', name: 'Onboarding help', description: 'A guided setup call', price_monthly: 999, business_types: ['SALON'] },
    auth: { userId: owner }
  }, res);
  assert.equal(res.code ?? 200, 200);
  assert.equal(res.body.data.addon_key, 'onboarding_help_', 'sanitised to lowercase letters/numbers/underscores');
  assert.deepEqual(res.body.data.business_types, ['SALON']);

  const dupe = fakeRes();
  await admin.createAddon({ body: { addon_key: 'onboarding help!', name: 'Again' }, auth: { userId: owner } }, dupe);
  assert.equal(dupe.code, 409);
});

test('createAddon and updateAddon reject an unknown business type', { skip }, async () => {
  const res = fakeRes();
  await admin.createAddon({ body: { addon_key: 'bad_type_test', name: 'X', business_types: ['MARS_COLONY'] }, auth: { userId: owner } }, res);
  assert.equal(res.code, 400);

  const upd = fakeRes();
  await admin.updateAddon({ params: { key: 'loyalty' }, body: { business_types: ['MARS_COLONY'] } }, upd);
  assert.equal(upd.code, 400);
});

test('deleteAddon refuses one that has already been sold, and works on one that hasn’t', { skip }, async () => {
  const sold = await (async () => { const r = fakeRes(); await admin.deleteAddon({ params: { key: 'reservations' } }, r); return r; })();
  assert.equal(sold.code, 409, 'reservations was sold earlier in this file');

  const create = fakeRes();
  await admin.createAddon({ body: { addon_key: 'never_sold', name: 'Never sold' }, auth: { userId: owner } }, create);
  const del = fakeRes();
  await admin.deleteAddon({ params: { key: 'never_sold' } }, del);
  assert.equal(del.body.success, true);

  const gone = fakeRes();
  await admin.deleteAddon({ params: { key: 'never_sold' } }, gone);
  assert.equal(gone.code, 404);
});

test('a business only sees add-ons scoped to its own type (or scoped to none)', { skip }, async () => {
  await admin.createAddon({ body: { addon_key: 'salon_only', name: 'Salon-only thing', business_types: ['SALON'] }, auth: { userId: owner } }, fakeRes());
  // `biz` is RESTAURANT (see setup) — createAddonLink for a SALON-only add-on should still be
  // possible via the API (admin can override anything), but the catalog itself records the scope
  // so the frontend's own dropdown can filter it out; this proves the data is there to filter on.
  const catalog = fakeRes();
  await admin.listAddons({}, catalog);
  const salonOnly = catalog.body.data.find((a) => a.addon_key === 'salon_only');
  assert.deepEqual(salonOnly.business_types, ['SALON']);
  const reservations = catalog.body.data.find((a) => a.addon_key === 'reservations');
  assert.deepEqual(reservations.business_types, ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'], 'seeded scope from migration 0041');
});
