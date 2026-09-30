/*
 * Delivery rider assignment and status (owner's request, 2026-09-29, from
 * the "Cloud Kitchen module" spec) — reuses the business's own staff/RBAC
 * (a new DELIVERY role) rather than a separate rider entity, the same way
 * orders.waiter_user_id already reuses `users` for waiters.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = await import('../src/controllers/orders.controller.js');
const { requirePlanFeature } = await import('../src/middleware/auth.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let A; let B;

const makeBusiness = async (label) => {
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}-owner@delivery.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ($1,$2,'CLOUD_KITCHEN','GROWTH') RETURNING business_id`, [label, owner.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const otherBranchId = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Other') RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: owner.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const rider = async (name, opts = {}) => {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${label}-${name}@delivery.test`])).rows[0];
    await pool.query(
      `INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,'DELIVERY','ACTIVE',$3)`,
      [biz.business_id, u.user_id, opts.otherBranch ? otherBranchId : branchId]
    );
    return u.user_id;
  };
  const openDelivery = async () => (await call(orders.create, { body: { order_type: 'DELIVERY' } })).body.data.order_id;
  return { biz: biz.business_id, branchId, tenant, req, call, rider, openDelivery };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a');
  B = await makeBusiness('b');
  A.ravi = await A.rider('Ravi');
});

test('delivery_fleet is on by default, and an admin can switch it off for a plan', { skip }, async () => {
  const middleware = requirePlanFeature('delivery_fleet');
  let next = false;
  await middleware({ tenant: { planFeatures: {} } }, fakeRes(), () => { next = true; });
  assert.ok(next);

  next = false;
  const res = fakeRes();
  await middleware({ tenant: { planFeatures: { delivery_fleet: false } } }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.code, 402);
});

test('listRiders returns only eligible staff at this outlet, not another business\'s', { skip }, async () => {
  const list = await A.call(orders.listRiders);
  assert.deepEqual(list.body.data.map((r) => r.name), ['Ravi']);
  assert.deepEqual((await B.call(orders.listRiders)).body.data, []);
});

test('a rider can only be assigned to a delivery order, not dine-in or takeaway', { skip }, async () => {
  const takeawayId = (await A.call(orders.create, { body: { order_type: 'TAKEAWAY' } })).body.data.order_id;
  const res = await A.call(orders.setRider, { params: { id: takeawayId }, body: { rider_user_id: A.ravi } });
  assert.equal(res.code, 400);
});

test('only someone eligible at this outlet can be assigned, and it is isolated per business', { skip }, async () => {
  const orderId = await A.openDelivery();

  const unknownUser = 999999;
  assert.equal((await A.call(orders.setRider, { params: { id: orderId }, body: { rider_user_id: unknownUser } })).code, 400);

  const outsideRider = await A.rider('Faraway', { otherBranch: true });
  assert.equal((await A.call(orders.setRider, { params: { id: orderId }, body: { rider_user_id: outsideRider } })).code, 400);

  const ok = await A.call(orders.setRider, { params: { id: orderId }, body: { rider_user_id: A.ravi } });
  assert.equal(ok.code ?? 200, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.rider_name, 'Ravi');

  assert.equal((await B.call(orders.setRider, { params: { id: orderId }, body: { rider_user_id: A.ravi } })).code, 404); // not B's order

  const cleared = await A.call(orders.setRider, { params: { id: orderId }, body: { rider_user_id: null } });
  assert.equal(cleared.body.data.rider_user_id, null);
});

test('delivery status must be set in order, and needs a rider first', { skip }, async () => {
  const orderId = await A.openDelivery();

  const noRider = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'PICKED_UP' } });
  assert.equal(noRider.code, 400);
  assert.match(noRider.body.message, /rider/i);

  await A.call(orders.setRider, { params: { id: orderId }, body: { rider_user_id: A.ravi } });

  const skipped = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'OUT_FOR_DELIVERY' } });
  assert.equal(skipped.code, 409);
  assert.match(skipped.body.message, /picked up/i);

  const bad = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'WALKING' } });
  assert.equal(bad.code, 400);

  const pickedUp = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'PICKED_UP' } });
  assert.equal(pickedUp.code ?? 200, 200);
  assert.ok(pickedUp.body.data.picked_up_at);

  // idempotent: setting it again doesn't move the timestamp
  const again = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'PICKED_UP' } });
  assert.equal(new Date(again.body.data.picked_up_at).getTime(), new Date(pickedUp.body.data.picked_up_at).getTime());

  const outForDelivery = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'OUT_FOR_DELIVERY' } });
  assert.ok(outForDelivery.body.data.out_for_delivery_at);
  assert.equal(outForDelivery.body.data.delivered_at, null);

  const delivered = await A.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'DELIVERED' } });
  assert.ok(delivered.body.data.delivered_at);

  assert.equal((await B.call(orders.setDeliveryStatus, { params: { id: orderId }, body: { status: 'PICKED_UP' } })).code, 404);
});

test('a dine-in or takeaway order has no delivery status to set', { skip }, async () => {
  const takeawayId = (await A.call(orders.create, { body: { order_type: 'TAKEAWAY' } })).body.data.order_id;
  const res = await A.call(orders.setDeliveryStatus, { params: { id: takeawayId }, body: { status: 'PICKED_UP' } });
  assert.equal(res.code, 400);
});
