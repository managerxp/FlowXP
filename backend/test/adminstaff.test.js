import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionsOf, roleOf, ROLES } from '../src/modules/adminRoles.js';
import { setupTestDb } from './helpers/db.js';

test('roles: the owner can do everything, onboarding staff cannot see revenue or change plans, a turned-off sign-in can do nothing', () => {
  const owner = { is_super_admin: true, admin_role: 'OWNER' };
  assert.equal(roleOf(owner), 'OWNER');
  assert.ok(permissionsOf(owner).includes('owner') && permissionsOf(owner).includes('revenue'));
  const onboarding = { is_super_admin: true, admin_role: 'ONBOARDING' };
  const can = permissionsOf(onboarding);
  assert.ok(can.includes('payments') && can.includes('billing') && can.includes('customers'));
  for (const no of ['revenue', 'manage', 'owner']) assert.ok(!can.includes(no), no);
  assert.deepEqual(permissionsOf({ is_super_admin: true, admin_role: 'ONBOARDING', admin_disabled: true }), []);
  assert.deepEqual(permissionsOf({ is_super_admin: false, admin_role: 'OWNER' }), []);
  assert.equal(roleOf({ is_super_admin: true, admin_role: null }), 'OWNER');   // an admin made before roles existed is the owner
  assert.ok(Object.keys(ROLES).every((r) => ROLES[r].can.every((p) => ['overview', 'revenue', 'customers', 'manage', 'payments', 'billing', 'support', 'people', 'messaging', 'bugs', 'owner'].includes(p))));
});

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

const call = async (fn, { params = {}, body = {}, user, headers = {} }) => {
  let status = 200; let payload;
  const res = { status(c) { status = c; return this; }, json(v) { payload = v; return this; } };
  await fn({ params, body, auth: { userId: user.user_id, user, isSuperAdmin: true }, headers, ip: '127.0.0.1', get: () => undefined }, res);
  return { status, ...payload };
};

test('a payment link settled in cash is marked paid: the plan switches on and every kind of payment counts in the revenue', { skip }, async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const payments = await import('../src/controllers/adminPayments.controller.js');
  const admin = await import('../src/controllers/admin.controller.js');
  const staff = await import('../src/controllers/adminStaff.controller.js');

  const ownerRow = (await pool.query(`INSERT INTO users (name, email, password_hash, is_super_admin, admin_role) VALUES ('Boss','boss@fx.test','x',TRUE,'OWNER') RETURNING *`)).rows[0];
  const tenant = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Shop owner','shop@fx.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [tenant])).rows[0].business_id;
  const link = (await pool.query(`INSERT INTO subscription_orders (business_id, amount_paise, billing_cycle, plan_code, link_id, payment_link_url) VALUES ($1, 150000, 'YEARLY', NULL, 'flowxp-t1', 'https://pay.test/1') RETURNING order_id`, [biz])).rows[0].order_id;
  await pool.query(`INSERT INTO addon_orders (business_id, addon_key, amount_paise, billing_cycle, link_id, status, paid_at) SELECT $1, addon_key, 50000, 'MONTHLY', 'flowxp-addon-t1', 'PAID', CURRENT_TIMESTAMP FROM addons LIMIT 1`, [biz]);
  await pool.query(`INSERT INTO admin_documents (kind, doc_number, business_id, totals, status, paid_at) VALUES ('INVOICE','INV-T-1',$1,'{"total_paise":20000}','PAID',CURRENT_TIMESTAMP)`, [biz]);

  const before = await call(admin.getStats, { user: ownerRow });
  assert.equal(before.data.revenue_collected, 700, 'the paid add-on (500) and the paid invoice (200) count; the open link does not');

  assert.equal((await call(payments.markPaid, { params: { id: biz, kind: 'plan', orderId: link }, body: { method: 'BITCOIN' }, user: ownerRow })).status, 400);
  const done = await call(payments.markPaid, { params: { id: biz, kind: 'plan', orderId: link }, body: { method: 'CASH', note: 'Collected at the shop' }, user: ownerRow });
  assert.equal(done.success, true);
  const order = (await pool.query(`SELECT status, paid_method, paid_by FROM subscription_orders WHERE order_id = $1`, [link])).rows[0];
  assert.deepEqual({ ...order }, { status: 'PAID', paid_method: 'CASH', paid_by: ownerRow.user_id });
  assert.equal((await pool.query(`SELECT subscription_status, billing_cycle FROM businesses WHERE business_id = $1`, [biz])).rows[0].subscription_status, 'ACTIVE');
  assert.equal((await call(payments.markPaid, { params: { id: biz, kind: 'plan', orderId: link }, body: { method: 'CASH' }, user: ownerRow })).status, 409, 'not twice');

  // the receipt goes on WhatsApp from FlowXP's number, to the owner's phone, as the approved template
  const { setProvider } = await import('../src/modules/messaging/provider.js');
  const sent = []; setProvider(async (m) => { sent.push(m); return { status: 'SENT', providerId: 'w1' }; });
  try {
    assert.equal((await call(payments.sendReceipt, { params: { id: biz, kind: 'plan', orderId: link }, body: { channel: 'whatsapp' }, user: ownerRow })).status, 409, 'no phone yet');
    await pool.query(`UPDATE users SET phone = '9876543210' WHERE user_id = $1`, [tenant]);
    const wa = await call(payments.sendReceipt, { params: { id: biz, kind: 'plan', orderId: link }, body: { channel: 'whatsapp' }, user: ownerRow });
    assert.equal(wa.data.sent_to, '9876543210');
    assert.equal(sent[0].template.name, 'flowxp_receipt'); assert.match(sent[0].text, /Rs 1500\.00.*Start date.*End date/); assert.equal(sent[0].document.buffer.subarray(0, 4).toString(), '%PDF');
  } finally { setProvider(null); }

  const after = await call(admin.getStats, { user: ownerRow });
  assert.equal(after.data.revenue_collected, 700 + 1500);
  assert.equal(after.data.revenue_periods.this_month, 2200);
  assert.equal(after.data.revenue_periods.this_year, 2200);
  assert.equal(after.data.revenue_by_month.at(-1).amount, 2200);

  // staff: an onboarding login is made, sees no revenue, and can be turned off
  const made = await call(staff.create, { body: { name: 'Meena', email: 'Meena@FX.test', role: 'ONBOARDING' }, user: ownerRow });
  assert.equal(made.status, 201); assert.equal(made.data.temporary_password, undefined, 'staff have no password'); assert.equal(made.data.role, 'ONBOARDING');
  assert.equal((await call(staff.create, { body: { name: 'X', email: 'meena@fx.test', role: 'SUPPORT' }, user: ownerRow })).status, 409, 'one sign-in per email');
  assert.equal((await call(staff.create, { body: { name: 'X', email: 'x@fx.test', role: 'OWNER' }, user: ownerRow })).status, 400, 'a second owner is not made from here');
  const meena = (await pool.query(`SELECT * FROM users WHERE email = 'meena@fx.test'`)).rows[0];
  const view = await call(admin.getStats, { user: meena });
  assert.equal(view.data.revenue_collected, undefined);
  assert.equal(view.data.businesses.total, 1);
  assert.equal((await call(staff.update, { params: { id: meena.user_id }, body: { role: 'ACCOUNTS' }, user: ownerRow })).data.role, 'ACCOUNTS');
  // staff sign in with an emailed code, once; a password does not work for them
  const crypto = await import('node:crypto');
  const sha = (c) => crypto.createHash('sha256').update(c).digest('hex');
  const open = async (fn, body, headers = {}) => call(fn, { body, user: meena, headers });
  assert.equal((await open(admin.staffCode, { identifier: 'meena@fx.test' })).success, true);
  assert.ok((await pool.query(`SELECT email_otp_hash FROM users WHERE user_id = $1`, [meena.user_id])).rows[0].email_otp_hash, 'a code was made');
  assert.equal((await open(admin.staffCode, { identifier: 'nobody@fx.test' })).success, true, 'the answer does not say who has a sign-in');
  await pool.query(`UPDATE users SET email_otp_hash = $2, email_otp_expires_at = CURRENT_TIMESTAMP + interval '10 minutes' WHERE user_id = $1`, [meena.user_id, sha('123456')]);
  assert.equal((await open(admin.staffVerify, { identifier: 'meena@fx.test', code: '000000' })).status, 401);
  const inn = await open(admin.staffVerify, { identifier: 'meena@fx.test', code: '123 456' });
  assert.equal(inn.success, true); assert.ok(inn.data.token); assert.equal(inn.data.admin.role, 'ACCOUNTS'); assert.equal(inn.data.admin.two_factor_required, false);
  assert.equal((await open(admin.staffVerify, { identifier: 'meena@fx.test', code: '123456' })).status, 401, 'a code works once');
  const ownerOnly = await open(admin.staffCode, { identifier: 'boss@fx.test' });
  assert.equal(ownerOnly.success, true);
  assert.equal((await pool.query(`SELECT email_otp_hash FROM users WHERE user_id = $1`, [ownerRow.user_id])).rows[0].email_otp_hash, null, 'the owner is not sent a code');


  // after the first code, a PIN set on a computer signs them in there: by email or by phone, never anywhere else, and five wrong ones end it
  const bcrypt = (await import('bcryptjs')).default;
  const key = 'k'.repeat(43); const cookie = { cookie: `flowxp_device=${key}` };
  await pool.query(`UPDATE users SET phone = '9123456789' WHERE user_id = $1`, [meena.user_id]);
  const tv = (await pool.query(`SELECT token_version FROM users WHERE user_id = $1`, [meena.user_id])).rows[0].token_version;
  await pool.query(`INSERT INTO pin_logins (device_hash, user_id, pin_hash, token_version, device_label) VALUES ($1, $2, $3, $4, 'test')`, [sha(key), meena.user_id, await bcrypt.hash('4821', 4), tv]);
  assert.equal((await open(admin.staffPin, { identifier: 'meena@fx.test', pin: '1111' }, cookie)).status, 401, 'wrong PIN');
  assert.equal((await open(admin.staffPin, { identifier: 'meena@fx.test', pin: '4821' }, {})).status, 401, 'no PIN on a computer that has not set one');
  const byPhone = await open(admin.staffPin, { identifier: '+91 91234 56789', pin: '4821' }, cookie);
  assert.equal(byPhone.success, true); assert.equal(byPhone.data.admin.role, 'ACCOUNTS');
  assert.equal((await open(admin.staffPin, { identifier: 'meena@fx.test', pin: '4821' }, cookie)).success, true, 'and by email');
  await call(staff.update, { params: { id: meena.user_id }, body: { sign_out: true }, user: ownerRow });
  assert.equal((await open(admin.staffPin, { identifier: 'meena@fx.test', pin: '4821' }, cookie)).status, 401, 'signing them out ends the PIN: a code is needed again');

  const off = await call(staff.update, { params: { id: meena.user_id }, body: { disabled: true }, user: ownerRow });
  assert.equal(off.data.disabled, true);
  assert.equal((await call(staff.update, { params: { id: ownerRow.user_id }, body: { disabled: true }, user: ownerRow })).status, 409, 'not yourself');
  assert.ok((await pool.query(`SELECT token_version FROM users WHERE user_id = $1`, [meena.user_id])).rows[0].token_version >= 2, 'their open sessions end');
});

test('starting a plan by hand sets its start and end date: months from today, or exact dates', { skip }, async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const admin = await import('../src/controllers/admin.controller.js');
  const boss = (await pool.query(`INSERT INTO users (name, email, password_hash, is_super_admin, admin_role) VALUES ('Boss2','boss2@fx.test','x',TRUE,'OWNER') RETURNING *`)).rows[0];
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Own2','own2@fx.test','x') RETURNING user_id`)).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, subscription_status) VALUES ('Trial shop',$1,'RETAIL','Karnataka','TRIAL') RETURNING business_id`, [owner.user_id])).rows[0];
  const dates = async () => (await pool.query(`SELECT subscription_started_at::date::text AS s, next_billing_date::date::text AS e, subscription_status FROM businesses WHERE business_id = $1`, [biz.business_id])).rows[0];

  const a = await call(admin.updateBusinessPlan, { params: { id: biz.business_id }, body: { subscription_status: 'ACTIVE', months: 6 }, user: boss });
  assert.equal(a.success, true);
  const d = await dates();
  assert.equal(d.subscription_status, 'ACTIVE');
  assert.ok(d.s && d.e && d.e > d.s);
  assert.equal((await pool.query(`SELECT (next_billing_date::date - subscription_started_at::date) > 170 AS ok FROM businesses WHERE business_id = $1`, [biz.business_id])).rows[0].ok, true);

  const b = await call(admin.updateBusinessPlan, { params: { id: biz.business_id }, body: { subscription_status: 'ACTIVE', start_date: '2026-01-10', end_date: '2026-03-05' }, user: boss });
  assert.equal(b.success, true);
  assert.deepEqual(await dates(), { s: '2026-01-10', e: '2026-03-05', subscription_status: 'ACTIVE' });

  assert.equal((await call(admin.updateBusinessPlan, { params: { id: biz.business_id }, body: { subscription_status: 'ACTIVE', start_date: '2026-03-05', end_date: '2026-01-10' }, user: boss })).status, 400);
});
