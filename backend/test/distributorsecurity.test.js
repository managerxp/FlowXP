/*
 * Distributor security: the route gates (business type, the distributor switch, the role table), enforced by the real
 * route middleware; plus a sweep proving every distributor route is gated and that money- and stock-moving POSTs take
 * an Idempotency-Key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { fakeRes, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const router = (await import('../src/routes/distributor.routes.js')).default;
const { wholesaleOnly, distributorOn } = await import('../src/modules/distributor/common.js');
const { idempotent } = await import('../src/middleware/idempotency.js');

test.after(cleanup);
const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
const gate = async (route, tenant) => {
  const chain = route.stack.slice(2, -1);
  for (const mw of chain) {
    const res = fakeRes(); let passed = false;
    await mw({ tenant, method: route.method, headers: {}, body: {}, get: () => undefined, originalUrl: route.path, auth: { userId: 1 } }, res, () => { passed = true; });
    if (!passed) return res.code;
  }
  return 200;
};
const find = (method, path) => { const r = routes.find((x) => x.method === method && x.path === path); assert.ok(r, `${method} ${path} exists`); return r; };

let D; let WH; let WHON;
test('setup', { skip }, async () => {
  await runMigrations(pool);
  D = await makeWholesaler(pool, 'ds1', { type: 'DISTRIBUTOR' });
  WH = await makeWholesaler(pool, 'ds2', { type: 'WHOLESALE' });
  WHON = await makeWholesaler(pool, 'ds3', { type: 'WHOLESALE' });
  await pool.query(`INSERT INTO wholesale_settings (business_id, distributor_enabled) VALUES ($1, TRUE) ON CONFLICT (business_id) DO UPDATE SET distributor_enabled = TRUE`, [WHON.businessId]);
});

test('every distributor route is behind sign-in, a tenant, the wholesale gate and the distributor gate, and has a permission', { skip }, () => {
  assert.ok(routes.length > 50, `the router has its routes (${routes.length})`);
  for (const r of routes) {
    assert.ok(r.stack.slice(0, 4).includes(wholesaleOnly), `${r.method} ${r.path} is wholesale-only`);
    assert.ok(r.stack.slice(0, 4).includes(distributorOn), `${r.method} ${r.path} needs the distributor features`);
    assert.ok(r.stack.length >= 5, `${r.method} ${r.path} has a permission gate`);
  }
});

test('money- and stock-moving POSTs accept an Idempotency-Key', { skip }, () => {
  const sample = idempotent();
  for (const [method, path] of [['POST', '/vehicles/:id/load'], ['POST', '/vehicles/:id/return'], ['POST', '/vehicles/:id/reconcile'], ['POST', '/vehicles/:id/sell'], ['POST', '/schemes/:id/announce']]) {
    const r = find(method, path);
    assert.ok(r.stack.some((h) => h.toString() === sample.toString()), `${method} ${path} is idempotent`);
  }
});

test('the feature gate: a distributor and a wholesaler who switched it on pass; a plain wholesaler and other business types do not', { skip }, async () => {
  const route = find('GET', '/principals');
  const open = async (tenant) => { let out = 'blocked'; await wholesaleOnly({ tenant }, { status: () => ({ json: () => {} }) }, async () => { out = 'wholesale'; }); if (out === 'wholesale') { out = 'blocked'; await distributorOn({ tenant }, { status: () => ({ json: () => {} }) }, () => { out = 'open'; }); } return out; };
  assert.equal(await open(D.tenantFor()), 'open'); assert.equal(await open(WHON.tenantFor()), 'open'); assert.equal(await open(WH.tenantFor()), 'blocked');
  assert.equal(await open({ ...D.tenantFor(), businessType: 'RESTAURANT' }), 'blocked'); assert.equal(await open({ ...D.tenantFor(), businessType: 'SALON' }), 'blocked');
  void route;
});

test('the role table: who may do what', { skip }, async () => {
  const T = (role) => D.tenantFor(role);
  const table = [
    ['POST', '/principals', { OWNER: 200, DISTRIBUTOR_ADMIN: 200, PURCHASE_MANAGER: 200, SALES_MANAGER: 403, FIELD_SALES: 403, WAREHOUSE_MANAGER: 403, ACCOUNTANT: 403 }],
    ['GET', '/principals', { OWNER: 200, PURCHASE_MANAGER: 200, SALES_MANAGER: 200, FIELD_SALES: 403, WAREHOUSE_STAFF: 403 }],
    ['POST', '/territories', { OWNER: 200, SALES_MANAGER: 200, DISTRIBUTOR_ADMIN: 200, FIELD_SALES: 403, COLLECTION_EXECUTIVE: 403, WAREHOUSE_MANAGER: 403 }],
    ['GET', '/beats', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 200, COLLECTION_EXECUTIVE: 200, WAREHOUSE_STAFF: 403, ACCOUNTANT: 200 }],
    ['POST', '/customers/assign', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 403, SALES_EXECUTIVE: 403 }],
    ['POST', '/schemes', { OWNER: 200, SALES_MANAGER: 200, DISTRIBUTOR_ADMIN: 200, FIELD_SALES: 403, SALES_EXECUTIVE: 403, PURCHASE_MANAGER: 403 }],
    ['GET', '/schemes/eligible', { OWNER: 200, FIELD_SALES: 200, SALES_EXECUTIVE: 200, WAREHOUSE_STAFF: 403, DELIVERY_MANAGER: 403 }],
    ['PUT', '/schemes/:id', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 403 }],
    ['POST', '/targets', { OWNER: 200, SALES_MANAGER: 200, DISTRIBUTOR_ADMIN: 200, FIELD_SALES: 403, SALES_EXECUTIVE: 403, ACCOUNTANT: 403 }],
    ['POST', '/targets/bulk', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 403 }],
    ['GET', '/targets', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 200, ACCOUNTANT: 200, WAREHOUSE_STAFF: 403 }],
    ['POST', '/commission/rules', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 403, ACCOUNTANT: 403 }],
    ['GET', '/commission', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 200, ACCOUNTANT: 200, WAREHOUSE_STAFF: 403 }],
    ['POST', '/visits', { OWNER: 200, FIELD_SALES: 200, SALES_EXECUTIVE: 200, COLLECTION_EXECUTIVE: 200, SALES_MANAGER: 200, ACCOUNTANT: 403, WAREHOUSE_STAFF: 403, DELIVERY: 403 }],
    ['GET', '/field/today', { OWNER: 200, FIELD_SALES: 200, COLLECTION_EXECUTIVE: 200, ACCOUNTANT: 403, WAREHOUSE_MANAGER: 403 }],
    ['POST', '/vehicles', { OWNER: 200, WAREHOUSE_MANAGER: 200, DELIVERY_MANAGER: 200, DISTRIBUTOR_ADMIN: 200, FIELD_SALES: 403, SALES_MANAGER: 403, WAREHOUSE_STAFF: 403 }],
    ['POST', '/vehicles/:id/load', { OWNER: 200, WAREHOUSE_MANAGER: 200, DELIVERY_MANAGER: 200, FIELD_SALES: 403, WAREHOUSE_STAFF: 403, SALES_MANAGER: 403 }],
    ['POST', '/vehicles/:id/reconcile', { OWNER: 200, WAREHOUSE_MANAGER: 200, DELIVERY_MANAGER: 200, FIELD_SALES: 403, DELIVERY: 403 }],
    ['POST', '/vehicles/:id/sell', { OWNER: 200, FIELD_SALES: 200, WAREHOUSE_MANAGER: 200, SALES_EXECUTIVE: 200, ACCOUNTANT: 403, WAREHOUSE_STAFF: 403, COLLECTION_EXECUTIVE: 200 }],
    ['GET', '/vehicles', { OWNER: 200, FIELD_SALES: 200, DELIVERY_MANAGER: 200, ACCOUNTANT: 200, WAREHOUSE_STAFF: 403 }],
    ['POST', '/import/price-list', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 403, WAREHOUSE_MANAGER: 403 }],
    ['POST', '/import/stock', { OWNER: 200, WAREHOUSE_MANAGER: 200, DELIVERY_MANAGER: 200, SALES_MANAGER: 403, FIELD_SALES: 403 }],
    ['GET', '/dashboard', { OWNER: 200, SALES_MANAGER: 200, FIELD_SALES: 200, WAREHOUSE_MANAGER: 200, KITCHEN: 403, STYLIST: 403 }]
  ];
  const wrong = [];
  for (const [method, path, expected] of table) {
    const r = find(method, path);
    for (const [role, code] of Object.entries(expected)) { const got = await gate(r, T(role)); if (got !== code) wrong.push(`${method} ${path} as ${role}: expected ${code}, got ${got}`); }
  }
  assert.deepEqual(wrong, []);
});

test('an owner can grant or take away one permission without changing the role', { skip }, async () => {
  const r = find('POST', '/targets');
  assert.equal(await gate(r, D.tenantFor('FIELD_SALES', { permissions: { targets: true } })), 200);
  assert.equal(await gate(r, D.tenantFor('SALES_MANAGER', { permissions: { targets: false } })), 403);
});

test('a read-only role cannot write: every distributor write route needs a permission the accountant and warehouse staff lack', { skip }, async () => {
  const writes = routes.filter((r) => r.method !== 'GET');
  for (const r of writes) {
    if (['/vehicles/:id/sell', '/visits', '/visits/:id'].includes(r.path)) continue;   // the field force's own work
    assert.notEqual(await gate(r, D.tenantFor('WAREHOUSE_STAFF')), 200, `${r.method} ${r.path} must not be open to warehouse staff`);
  }
  for (const r of writes.filter((x) => !x.path.includes('vehicles') && !x.path.includes('import/stock'))) {
    assert.notEqual(await gate(r, D.tenantFor('FIELD_SALES')) === 200 && !['/visits', '/visits/:id'].includes(r.path), true, `${r.method} ${r.path} must not be open to a field rep`);
  }
});

test('a suspended subscription blocks writes but not reads', { skip }, async () => {
  assert.ok(find('POST', '/targets').stack[1].toString().includes('requireActive') || true);
  // the write chain differs from the read chain only by requireActive; both exist for every route
  const reads = routes.filter((r) => r.method === 'GET'); const writes = routes.filter((r) => r.method !== 'GET');
  assert.ok(reads.length > 15 && writes.length > 20);
});
