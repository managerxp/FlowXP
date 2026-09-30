/*
 * Custom-priced subscription payments (Option B, 2026-09-28): no fixed public
 * plan price — the super admin sets a price on one business and sends a
 * Cashfree hosted payment link for it. Covers link creation, the webhook that
 * activates a subscription, replay/duplicate-event safety, and a bad
 * signature being refused.
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

test.after(() => { cashfree.setProvider(null); cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const call = (fn, businessId, body = {}, extra = {}) => {
  const res = fakeRes();
  return fn({ params: { id: businessId }, auth: { userId: owner }, body, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra }, res).then(() => res);
};

let owner; let biz;
const SECRET = 'test-cashfree-secret';

const sign = (body, timestamp) => crypto.createHmac('sha256', SECRET).update(timestamp + body).digest('base64');

const webhookReq = (payload, { badSignature = false, noSignature = false } = {}) => {
  const raw = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = noSignature ? undefined : (badSignature ? 'nope' : sign(raw, timestamp));
  return {
    rawBody: Buffer.from(raw),
    body: payload,
    get: (name) => {
      if (name === 'x-webhook-signature') return signature;
      if (name === 'x-webhook-timestamp') return timestamp;
      return undefined;
    }
  };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  config.cashfree.appId = 'test-app';
  config.cashfree.secretKey = SECRET;
  owner = (await pool.query(`INSERT INTO users (name, email, phone, password_hash) VALUES ('Owner','owner@payments.test','9000000001','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Payments Test',$1,'RETAIL') RETURNING business_id`, [owner])).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, owner]);
});

test('a bad billing cycle or a zero/negative price is refused before anything is created', { skip }, async () => {
  const bad = await call(admin.createPaymentLink, biz, { amount: 999, billing_cycle: 'WEEKLY' });
  assert.equal(bad.code, 400);
  const zero = await call(admin.createPaymentLink, biz, { amount: 0, billing_cycle: 'MONTHLY' });
  assert.equal(zero.code, 400);
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM subscription_orders WHERE business_id = $1`, [biz])).rows[0].n, '0');
});

test('generating a link creates a PENDING order and returns Cashfree\'s hosted URL', { skip }, async () => {
  cashfree.setProvider(async ({ linkId, amount }) => ({ linkUrl: `https://sandbox.cashfree.com/pg/links/${linkId}`, status: 'ACTIVE', amount }));

  const res = await call(admin.createPaymentLink, biz, { amount: 1499, billing_cycle: 'MONTHLY', plan_code: 'GROWTH' });
  assert.equal(res.code ?? 200, 200);
  assert.equal(res.body.data.amount, 1499);
  assert.equal(res.body.data.status, 'PENDING');
  assert.ok(res.body.data.payment_link_url.includes('cashfree.com'));

  const row = (await pool.query(`SELECT * FROM subscription_orders WHERE business_id = $1`, [biz])).rows[0];
  assert.equal(row.status, 'PENDING');
  assert.equal(Number(row.amount_paise), 149900);
  assert.equal(row.link_id, `flowxp-${row.order_id}`);
});

test('when Cashfree itself refuses, the order stays PENDING with no link rather than vanishing', { skip }, async () => {
  cashfree.setProvider(async () => { throw new cashfree.CashfreeError('sandbox is down'); });
  const res = await call(admin.createPaymentLink, biz, { amount: 500, billing_cycle: 'YEARLY' });
  assert.equal(res.code, 502);
  const row = (await pool.query(`SELECT status, link_id FROM subscription_orders WHERE business_id = $1 ORDER BY order_id DESC LIMIT 1`, [biz])).rows[0];
  assert.equal(row.status, 'PENDING');
  assert.equal(row.link_id, null);
});

test('a webhook with a bad or missing signature is refused and changes nothing', { skip }, async () => {
  cashfree.setProvider(async ({ linkId }) => ({ linkUrl: `https://sandbox.cashfree.com/pg/links/${linkId}`, status: 'ACTIVE' }));
  const created = await call(admin.createPaymentLink, biz, { amount: 2000, billing_cycle: 'MONTHLY' });
  const linkId = (await pool.query(`SELECT link_id FROM subscription_orders WHERE order_id = $1`, [created.body.data.order_id])).rows[0]?.link_id
    ?? (await pool.query(`SELECT link_id FROM subscription_orders WHERE business_id = $1 ORDER BY order_id DESC LIMIT 1`, [biz])).rows[0].link_id;

  const payload = { type: 'PAYMENT_LINK_EVENT', data: { link_id: linkId, link_status: 'PAID' } };

  const bad = fakeRes();
  await webhooks.cashfree(webhookReq(payload, { badSignature: true }), bad);
  assert.equal(bad.code, 401);

  const missing = fakeRes();
  await webhooks.cashfree(webhookReq(payload, { noSignature: true }), missing);
  assert.equal(missing.code, 401);

  assert.equal((await pool.query(`SELECT status FROM subscription_orders WHERE link_id = $1`, [linkId])).rows[0].status, 'PENDING');
  assert.equal((await pool.query(`SELECT subscription_status FROM businesses WHERE business_id = $1`, [biz])).rows[0].subscription_status, 'TRIAL');
});

test('a correctly signed PAID webhook activates the subscription, once', { skip }, async () => {
  cashfree.setProvider(async ({ linkId }) => ({ linkUrl: `https://sandbox.cashfree.com/pg/links/${linkId}`, status: 'ACTIVE' }));
  const created = await call(admin.createPaymentLink, biz, { amount: 3000, billing_cycle: 'YEARLY', plan_code: 'BUSINESS' });
  const linkId = (await pool.query(`SELECT link_id FROM subscription_orders WHERE business_id = $1 ORDER BY order_id DESC LIMIT 1`, [biz])).rows[0].link_id;
  assert.ok(created.body.success);

  const payload = { type: 'PAYMENT_LINK_EVENT', data: { link_id: linkId, link_status: 'PAID' } };
  const ok = fakeRes();
  await webhooks.cashfree(webhookReq(payload), ok);
  assert.equal(ok.body.success, true);

  const order = (await pool.query(`SELECT status, paid_at FROM subscription_orders WHERE link_id = $1`, [linkId])).rows[0];
  assert.equal(order.status, 'PAID');
  assert.ok(order.paid_at);

  const business = (await pool.query(`SELECT subscription_status, plan_code, billing_cycle, next_billing_date FROM businesses WHERE business_id = $1`, [biz])).rows[0];
  assert.equal(business.subscription_status, 'ACTIVE');
  assert.equal(business.plan_code, 'BUSINESS');
  assert.equal(business.billing_cycle, 'YEARLY');
  assert.ok(new Date(business.next_billing_date) > new Date());

  // a second delivery of the same event (Cashfree retries on anything but 2xx)
  // must not re-activate, double-count or crash
  const replay = fakeRes();
  await webhooks.cashfree(webhookReq(payload), replay);
  assert.equal(replay.body.success, true);
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM subscription_orders WHERE link_id = $1 AND status = 'PAID'`, [linkId])).rows[0].n, '1');
});

test('an unrecognised link_id, or a non-PAID status, is acknowledged but changes nothing', { skip }, async () => {
  const before = (await pool.query(`SELECT subscription_status FROM businesses WHERE business_id = $1`, [biz])).rows[0];

  const unknown = fakeRes();
  await webhooks.cashfree(webhookReq({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'flowxp-does-not-exist', link_status: 'PAID' } }), unknown);
  assert.equal(unknown.body.success, true);

  const expired = fakeRes();
  await webhooks.cashfree(webhookReq({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'flowxp-does-not-exist', link_status: 'EXPIRED' } }), expired);
  assert.equal(expired.body.success, true);

  const after = (await pool.query(`SELECT subscription_status FROM businesses WHERE business_id = $1`, [biz])).rows[0];
  assert.deepEqual(after, before);
});

test('signature verification rejects a tampered body', async () => {
  const timestamp = String(Date.now());
  const signature = sign('{"a":1}', timestamp);
  assert.equal(await cashfree.verifyWebhookSignature('{"a":1}', timestamp, signature), true);
  assert.equal(await cashfree.verifyWebhookSignature('{"a":2}', timestamp, signature), false);
  assert.equal(await cashfree.verifyWebhookSignature('{"a":1}', timestamp, 'garbage'), false);
  assert.equal(await cashfree.verifyWebhookSignature('{"a":1}', timestamp, null), false);
});
