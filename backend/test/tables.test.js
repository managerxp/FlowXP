/*
 * Table setup: names are required and unique per outlet, seats are 1–99, and a
 * table with a running order cannot be removed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const tables = await import('../src/controllers/tables.controller.js');
const orders = await import('../src/controllers/orders.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('table names, seats and removing a busy table', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('t','t@tables.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('T',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  const main = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const other = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Other') RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, user]);
  const at = (branchId) => ({ businessId: biz, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} });
  const call = async (fn, extra, tenant = at(main)) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

  const t1 = (await call(tables.create, { body: { name: ' T1 ', zone: ' Patio ', seats: '4' } })).body.data;
  assert.deepEqual([t1.name, t1.zone, t1.seats], ['T1', 'Patio', 4]);
  assert.equal((await call(tables.create, { body: { name: '   ' } })).code, 400);
  assert.equal((await call(tables.create, { body: { name: 'T2', seats: 0 } })).code, 400);
  assert.equal((await call(tables.create, { body: { name: 'T2', seats: 2.5 } })).code, 400);
  assert.equal((await call(tables.create, { body: { name: 't1' } })).code, 409);                    // same outlet, any case
  assert.equal((await call(tables.create, { body: { name: 'T1' } }, at(other))).code, 201);           // another outlet may reuse it
  const t2 = (await call(tables.create, { body: { name: 'T2' } })).body.data;

  // rename and edit
  assert.equal((await call(tables.update, { params: { id: t2.table_id }, body: { name: 'T1' } })).code, 409);
  assert.equal((await call(tables.update, { params: { id: t2.table_id }, body: { name: '' } })).code, 400);
  assert.equal((await call(tables.update, { params: { id: t2.table_id }, body: { seats: 120 } })).code, 400);
  const edited = (await call(tables.update, { params: { id: t2.table_id }, body: { name: 'T2A', zone: '', seats: null } })).body.data;
  assert.deepEqual([edited.name, edited.zone, edited.seats], ['T2A', null, null]);
  assert.equal((await call(tables.update, { params: { id: t1.table_id }, body: { name: 'T1' } })).code, 200);  // keeping its own name

  // a table with a running order can't be removed; a free one can, and its name is free again
  await call(orders.create, { body: { order_type: 'DINE_IN', table_id: t1.table_id } });
  assert.equal((await call(tables.update, { params: { id: t1.table_id }, body: { status: 'CLOSED' } })).code, 409);
  assert.equal((await call(tables.update, { params: { id: t2.table_id }, body: { status: 'CLOSED' } })).code, 200);
  assert.ok(!(await call(tables.list)).body.data.some((t) => t.table_id === t2.table_id));
  assert.equal((await call(tables.create, { body: { name: 'T2A' } })).code, 201);
});
