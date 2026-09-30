/*
 * RBAC (roles, per-user overrides, the route middleware) and staff management
 * rules (who can add/change whom, the last-owner guard, self-edit guard, and
 * the plan's user-count limit) — the two things a business owner relies on to
 * trust that a cashier cannot see what a manager sees, and that a plan actually
 * gates something. `features` on the plans table is still a marketing list
 * only, never enforced; `limits` (users, outlets, ai_queries) and
 * `feature_flags` (see test/planfeatures.test.js) are the real gates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { ROLE_PERMISSIONS, hasPermission, requirePermission, requireAnyPermission, requireOwner, requireOutlet, requireGroupUser, withBusiness } = await import('../src/middleware/auth.js');
const { PERMISSIONS } = await import('../src/modules/permissions.js');
const staff = await import('../src/controllers/staff.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
/* Runs a real Express middleware and reports whether it called next(). */
const run = async (mw, tenant) => { const res = fakeRes(); let passed = false; await mw({ tenant }, res, () => { passed = true; }); return { passed, res }; };

/* ── pure: hasPermission ───────────────────────────────────────────────── */

test('hasPermission matches each role\'s table, and overrides win', () => {
  assert.equal(hasPermission(null, 'billing'), false, 'no tenant, no access');
  assert.equal(hasPermission({ role: 'GHOST' }, 'billing'), false, 'an unknown role has nothing');

  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const p of PERMISSIONS) {
      const expected = perms.includes('*') || perms.includes(p);
      assert.equal(hasPermission({ role }, p), expected, `${role} × ${p}`);
    }
  }

  // a CASHIER normally has no 'reports', but an explicit true grants it
  assert.equal(hasPermission({ role: 'CASHIER', permissions: { reports: true } }, 'reports'), true);
  // a MANAGER normally has 'reports', but an explicit false takes it away
  assert.equal(hasPermission({ role: 'MANAGER', permissions: { reports: false } }, 'reports'), false);
  // OWNER's wildcard cannot be overridden away — the UI never offers it (owners aren't editable), but the guard belongs here too
  assert.equal(hasPermission({ role: 'OWNER', permissions: { billing: false } }, 'billing'), true);
});

/* ── pure: the route middleware ───────────────────────────────────────── */

test('requirePermission, requireAnyPermission, requireOwner, requireOutlet, requireGroupUser', async () => {
  const cashier = { role: 'CASHIER', permissions: {} };
  const manager = { role: 'MANAGER', permissions: {} };

  assert.equal((await run(requirePermission('billing'), cashier)).passed, true);
  let r = await run(requirePermission('reports'), cashier);
  assert.deepEqual([r.passed, r.res.code], [false, 403]);
  assert.match(r.res.body.message, /do not have access/);

  // the read-side door: a CASHIER has no 'products', but the OR passes on 'customers' or 'billing'
  assert.equal((await run(requireAnyPermission('products', 'reports'), cashier)).passed, false);
  assert.equal((await run(requireAnyPermission('products', 'billing'), cashier)).passed, true);

  assert.equal((await run(requireOwner, { role: 'OWNER' })).passed, true);
  r = await run(requireOwner, manager);
  assert.deepEqual([r.passed, r.res.code], [false, 403]);

  assert.equal((await run(requireOutlet, { viewAll: false })).passed, true);
  r = await run(requireOutlet, { viewAll: true });
  assert.deepEqual([r.passed, r.res.body.code], [false, 'OUTLET_REQUIRED']);

  assert.equal((await run(requireGroupUser, { pinned: false })).passed, true);
  assert.equal((await run(requireGroupUser, { pinned: true })).passed, false);
});

/* ── database: staff management ───────────────────────────────────────── */

let biz; let owner; let owner2; let admin; let manager; let cashier; let waiter;
const membershipsFor = async (userId) => (await pool.query(
  `SELECT bu.business_id, bu.role, bu.branch_id, bu.permissions, b.name, b.business_type, b.status AS business_status, b.subscription_status, b.plan_code,
          b.billing_cycle, b.trial_started_at, b.trial_ends_at, b.next_billing_date, b.currency, b.onboarding_step, b.gst_enabled
   FROM business_users bu JOIN businesses b ON b.business_id = bu.business_id WHERE bu.user_id = $1 AND bu.status = 'ACTIVE'`, [userId])).rows;
const request = async (who, extra = {}) => {
  const req = { auth: { userId: who }, memberships: await membershipsFor(who), headers: {}, body: {}, query: {}, params: {}, ip: '127.0.0.1', ...extra };
  const res = fakeRes(); let ok = false;
  await withBusiness()(req, res, () => { ok = true; });
  return { req, res, ok };
};
const call = async (fn, who, extra) => { const { req, res, ok } = await request(who, extra); if (!ok) return res; const out = fakeRes(); await fn(req, out); return out; };
const membership = async (userId) => (await pool.query(`SELECT role, status, branch_id FROM business_users WHERE business_id = $1 AND user_id = $2`, [biz, userId])).rows[0];

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = async (n) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [n, `${n}@rbac.test`])).rows[0].user_id;
  [owner, owner2, admin, manager, cashier, waiter] = await Promise.all(['Priya', 'Rahul', 'Adam', 'Meera', 'Ravi', 'Sneha'].map(user));
  // ENTERPRISE so the plan's own user cap (TRIAL defaults to 3) never interferes
  // with the RBAC checks below; the dedicated test further down sets its own cap.
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code) VALUES ('RBAC Test',$1,'RESTAURANT','ACTIVE','ENTERPRISE') RETURNING business_id`, [owner])).rows[0].business_id;
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz]);
  for (const [u, role] of [[owner, 'OWNER'], [owner2, 'OWNER'], [admin, 'ADMIN'], [manager, 'MANAGER'], [cashier, 'CASHIER'], [waiter, 'WAITER']]) {
    await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,$3)`, [biz, u, role]);
  }
});

test('inviting staff: role validity, who may grant privilege, and the outlet a floor role gets', { skip }, async () => {
  assert.equal((await call(staff.invite, owner, { body: { name: 'X', email: 'bad-role@rbac.test', role: 'SUPERUSER' } })).code, 400);
  assert.equal((await call(staff.invite, owner, { body: { role: 'CASHIER' } })).code, 400, 'needs a name and email');

  // only an OWNER may create an OWNER or ADMIN
  let res = await call(staff.invite, admin, { body: { name: 'New Admin', email: 'newadmin@rbac.test', role: 'ADMIN' } });
  assert.equal(res.code, 403);
  res = await call(staff.invite, owner, { body: { name: 'New Admin', email: 'newadmin@rbac.test', role: 'ADMIN' } });
  assert.equal(res.code, 201);
  assert.deepEqual(await membership(res.body.data.user_id), { role: 'ADMIN', status: 'ACTIVE', branch_id: null }, 'group role: no outlet');

  // a floor role with no outlet named gets the business's primary one
  res = await call(staff.invite, owner, { body: { name: 'New Cashier', email: 'newcashier@rbac.test', role: 'CASHIER' } });
  assert.equal(res.code, 201);
  const main = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND is_primary`, [biz])).rows[0].branch_id;
  assert.deepEqual((await membership(res.body.data.user_id)).branch_id, main);

  // an outlet from another business is refused
  const elsewhere = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Stray','stray@rbac.test','x') RETURNING user_id`)).rows[0].user_id;
  const otherBiz = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('Other',$1) RETURNING business_id`, [elsewhere])).rows[0].business_id;
  const otherBranch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Theirs',TRUE) RETURNING branch_id`, [otherBiz])).rows[0].branch_id;
  assert.equal((await call(staff.invite, owner, { body: { name: 'Cross Branch', email: 'crossbranch@rbac.test', role: 'CASHIER', branch_id: otherBranch } })).code, 400);

  // already on the team
  assert.equal((await call(staff.invite, owner, { body: { name: 'New Cashier Dup', email: 'newcashier@rbac.test', role: 'WAITER' } })).code, 409);
});

test('a plan\'s user limit actually stops a new hire', { skip }, async () => {
  await pool.query(`UPDATE businesses SET plan_code = 'STARTER' WHERE business_id = $1`, [biz]);
  const before = (await pool.query(`SELECT limits FROM plans WHERE plan_code = 'STARTER'`)).rows[0].limits;
  const headcount = Number((await pool.query(`SELECT COUNT(*) AS n FROM business_users WHERE business_id = $1 AND status = 'ACTIVE'`, [biz])).rows[0].n);

  await pool.query(`UPDATE plans SET limits = limits || jsonb_build_object('users', $1::int) WHERE plan_code = 'STARTER'`, [headcount]);
  let res = await call(staff.invite, owner, { body: { name: 'One Too Many', email: 'overlimit@rbac.test', role: 'CASHIER' } });
  assert.deepEqual([res.code, res.body.message.includes(`${headcount} users`)], [402, true]);

  await pool.query(`UPDATE plans SET limits = limits || jsonb_build_object('users', $1::int) WHERE plan_code = 'STARTER'`, [headcount + 1]);
  assert.equal((await call(staff.invite, owner, { body: { name: 'Now Fits', email: 'fits@rbac.test', role: 'CASHIER' } })).code, 201, 'raising the limit by one lets exactly one more in');
  assert.equal((await call(staff.invite, owner, { body: { name: 'Still One Too Many', email: 'stillover@rbac.test', role: 'CASHIER' } })).code, 402, 'now at the new cap');

  await pool.query(`UPDATE plans SET limits = $1::jsonb WHERE plan_code = 'STARTER'`, [JSON.stringify(before)]);
  await pool.query(`UPDATE businesses SET plan_code = 'TRIAL' WHERE business_id = $1`, [biz]);
});

test('changing a teammate: self-edit, privilege, invalid values', { skip }, async () => {
  assert.equal((await call(staff.update, owner, { params: { userId: owner }, body: { role: 'ADMIN' } })).code, 403, 'nobody edits their own access, not even the owner');

  // a manager cannot touch an owner or admin, or hand out those roles
  assert.equal((await call(staff.update, manager, { params: { userId: admin }, body: { status: 'DISABLED' } })).code, 403);
  assert.equal((await call(staff.update, manager, { params: { userId: cashier }, body: { role: 'ADMIN' } })).code, 403);
  // but an owner may demote an admin back down
  assert.equal((await call(staff.update, owner, { params: { userId: admin }, body: { role: 'MANAGER' } })).code, 200);
  assert.equal((await membership(admin)).role, 'MANAGER');

  assert.equal((await call(staff.update, owner, { params: { userId: cashier }, body: { role: 'NOT_A_ROLE' } })).code, 400);
  assert.equal((await call(staff.update, owner, { params: { userId: cashier }, body: { status: 'ASLEEP' } })).code, 400);
  assert.equal((await call(staff.update, owner, { params: { userId: 999999 }, body: { status: 'DISABLED' } })).code, 404);
});

/* A business can never end up with zero active owners: nobody may change their own
   role/status (blocks a sole owner disabling themselves), and only an OWNER may touch
   an OWNER (so acting on someone else always means at least two owners existed a
   moment ago). The explicit headcount guard is defence in depth for exactly that case
   — it must not also block a harmless change to an owner row that is already disabled. */
test('a business is never left with zero active owners, including the disabled-owner edge case', { skip }, async () => {
  const solo = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Solo','solo@rbac.test','x') RETURNING user_id`)).rows[0].user_id;
  const second = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Second','second@rbac.test','x') RETURNING user_id`)).rows[0].user_id;
  const soloBiz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, subscription_status) VALUES ('Solo Co',$1,'ACTIVE') RETURNING business_id`, [solo])).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER'),($1,$3,'OWNER')`, [soloBiz, solo, second]);
  const act = (who, targetId, body) => call(staff.update, who, { params: { userId: targetId }, body });
  const rowOf = async (id) => (await pool.query(`SELECT role, status FROM business_users WHERE business_id = $1 AND user_id = $2`, [soloBiz, id])).rows[0];

  // two active owners: either may disable the other, leaving exactly one
  assert.equal((await act(solo, second, { status: 'DISABLED' })).code, 200);
  assert.deepEqual(await rowOf(second), { role: 'OWNER', status: 'DISABLED' });

  // now solo is the sole active owner. Nobody but solo could reach the PRIVILEGED
  // gate to act on solo (second is disabled, so second can't authenticate at all),
  // and solo can't act on themselves — so the true "last owner" case is unreachable
  // through this endpoint by construction, not by the headcount check.

  // the edge case: second's row is OWNER but DISABLED. Reassigning it must not be
  // blocked by the "last owner" guard, since second was never counted as active.
  assert.equal((await act(solo, second, { role: 'ADMIN' })).code, 200, 'a disabled owner\'s role can be reassigned even with one active owner');
  assert.deepEqual(await rowOf(second), { role: 'ADMIN', status: 'DISABLED' });
});

test('permission overrides: owner-only route, cannot touch self or an owner, validated keys', { skip }, async () => {
  assert.equal((await call(staff.putPermissions, owner, { params: { userId: owner }, body: { permissions: { billing: false } } })).code, 403, 'cannot change your own permissions');
  assert.equal((await call(staff.putPermissions, owner, { params: { userId: owner2 }, body: { permissions: { billing: false } } })).code, 403, 'an owner\'s permissions are not editable');
  assert.equal((await call(staff.putPermissions, owner, { params: { userId: 999999 }, body: { permissions: {} } })).code, 404);

  let res = await call(staff.putPermissions, owner, { params: { userId: cashier }, body: { permissions: { godmode: true } } });
  assert.equal(res.code, 400);
  res = await call(staff.putPermissions, owner, { params: { userId: cashier }, body: { permissions: { reports: true } } });
  assert.equal(res.code, 200);
  assert.equal((await call(staff.getPermissions, owner, { params: { userId: cashier } })).body.data.permissions.find((p) => p.key === 'reports').effective, true);

  // getPermissions on an owner target: not editable, but readable
  assert.equal((await call(staff.getPermissions, owner, { params: { userId: owner2 } })).body.data.editable, false);
});
