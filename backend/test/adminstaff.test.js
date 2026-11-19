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

const call = async (fn, { params = {}, body = {}, user }) => {
  let status = 200; let payload;
  const res = { status(c) { status = c; return this; }, json(v) { payload = v; return this; } };
  await fn({ params, body, auth: { userId: user.user_id, user, isSuperAdmin: true }, headers: {}, ip: '127.0.0.1', get: () => undefined }, res);
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

  const after = await call(admin.getStats, { user: ownerRow });
  assert.equal(after.data.revenue_collected, 700 + 1500);
  assert.equal(after.data.revenue_periods.this_month, 2200);
  assert.equal(after.data.revenue_periods.this_year, 2200);
  assert.equal(after.data.revenue_by_month.at(-1).amount, 2200);

  // staff: an onboarding login is made, sees no revenue, and can be turned off
  const made = await call(staff.create, { body: { name: 'Meena', email: 'Meena@FX.test', role: 'ONBOARDING' }, user: ownerRow });
  assert.equal(made.status, 201); assert.match(made.data.temporary_password, /^[A-Za-z0-9]{12}$/); assert.equal(made.data.role, 'ONBOARDING');
  assert.equal((await call(staff.create, { body: { name: 'X', email: 'meena@fx.test', role: 'SUPPORT' }, user: ownerRow })).status, 409, 'one sign-in per email');
  assert.equal((await call(staff.create, { body: { name: 'X', email: 'x@fx.test', role: 'OWNER' }, user: ownerRow })).status, 400, 'a second owner is not made from here');
  const meena = (await pool.query(`SELECT * FROM users WHERE email = 'meena@fx.test'`)).rows[0];
  const view = await call(admin.getStats, { user: meena });
  assert.equal(view.data.revenue_collected, undefined);
  assert.equal(view.data.businesses.total, 1);
  assert.equal((await call(staff.update, { params: { id: meena.user_id }, body: { role: 'ACCOUNTS' }, user: ownerRow })).data.role, 'ACCOUNTS');
  const off = await call(staff.update, { params: { id: meena.user_id }, body: { disabled: true }, user: ownerRow });
  assert.equal(off.data.disabled, true);
  assert.equal((await call(staff.update, { params: { id: ownerRow.user_id }, body: { disabled: true }, user: ownerRow })).status, 409, 'not yourself');
  assert.ok((await pool.query(`SELECT token_version FROM users WHERE user_id = $1`, [meena.user_id])).rows[0].token_version >= 2, 'their open sessions end');
});
