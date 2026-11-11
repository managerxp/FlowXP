/*
 * Estimates: numbering, checks, total, and that "Make invoice" bills the quoted lines once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const est = await import('../src/controllers/estimates.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const call = async (fn, tenant, user, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

test('estimates: numbered, checked, converted to one invoice', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('e','e@est.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  const br = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const pid = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Pen',1000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const tenant = { businessId: biz, branchId: br, scopeBranchId: br, role: 'OWNER', businessType: 'RETAIL', permissions: {} };
  const make = (body) => call(est.create, tenant, user, { body });

  assert.equal((await make({ items: [] })).code, 400);
  assert.equal((await make({ items: [{ description: 'x', quantity: 0, unit_price: 5 }] })).code, 400);
  assert.match((await make({ items: [{ product_id: pid, quantity: 1 }], valid_until: '2026-02-31' })).body.message, /valid date/);

  const a = (await make({ items: [{ product_id: pid, quantity: 3 }, { description: 'Delivery', quantity: 1, unit_price: 50 }], discount: 10 })).body.data;
  assert.equal(a.estimate_number, 'EST-0001');
  assert.equal(a.total, 70);   // 3 x 10 + 50 - 10
  assert.equal((await make({ items: [{ product_id: pid, quantity: 1 }] })).body.data.estimate_number, 'EST-0002');

  const made = await call(est.convert, tenant, user, { params: { id: String(a.estimate_id) }, body: { payment: { method: 'CASH', amount: 70 } } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal((await call(est.convert, tenant, user, { params: { id: String(a.estimate_id) } })).code, 409, 'only once');

  const rows = (await call(est.list, tenant, user)).body.data;
  assert.equal(rows.find((r) => r.estimate_id === a.estimate_id).status, 'CONVERTED');
  const other = rows.find((r) => r.estimate_id !== a.estimate_id);
  assert.equal((await call(est.cancel, tenant, user, { params: { id: String(other.estimate_id) } })).code, 200);
  assert.equal((await call(est.convert, tenant, user, { params: { id: String(other.estimate_id) } })).code, 409);
});
