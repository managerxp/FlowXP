/*
 * Suppliers: what you owe them and what you bought, counted at the outlet(s)
 * the viewer may see; other businesses see nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const suppliers = await import('../src/controllers/suppliers.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let biz; let user; let A; let B; let sup; let other;
const tenant = (scopeBranchId, branchId = scopeBranchId ?? A) => ({ businessId: biz, branchId, scopeBranchId, role: 'OWNER', permissions: {} });
const call = async (fn, t, extra = {}) => { const res = fakeRes(); await fn({ tenant: t, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
let n = 0;
const po = (branch, status, total, due, date) => pool.query(
  `INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, subtotal_paise, tax_paise, total_paise, amount_paid_paise, balance_due_paise, payment_status, status)
   VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7,$8,$9,$10)`,
  [biz, branch, sup, `PO-S${++n}`, date, total, total - due, due, due === 0 ? 'PAID' : due === total ? 'UNPAID' : 'PARTIAL', status]);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('s','s@sup.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'B') RETURNING branch_id`, [biz])).rows[0].branch_id;
  sup = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Veg Co') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  const u2 = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@sup.test','x') RETURNING user_id`)).rows[0].user_id;
  other = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Other',$1,'RETAIL') RETURNING business_id`, [u2])).rows[0].business_id;

  await po(A, 'RECEIVED', 100000, 40000, '2026-09-01');   // ₹1,000, ₹400 owed
  await po(A, 'RECEIVED', 50000, 0, '2026-09-10');        // paid
  await po(A, 'ORDERED', 30000, 30000, '2026-09-20');     // on its way: not owed, not bought yet
  await po(B, 'RECEIVED', 20000, 20000, '2026-09-15');    // the other outlet
  await po(B, 'CANCELLED', 99900, 99900, '2026-09-16');   // never counts
});

test('the whole business sees every outlet: owed, bought, orders and the last one', { skip }, async () => {
  const s = (await call(suppliers.get, tenant(null), { params: { id: sup } })).body.data;
  assert.deepEqual([s.payable_balance, s.total_purchases, s.received_orders, s.open_orders, s.last_po_date], [600, 1700, 3, 1, '2026-09-15']);
  const listed = (await call(suppliers.list, tenant(null))).body.data.find((x) => x.supplier_id === sup);
  assert.equal(listed.payable_balance, 600);
});

test('one outlet sees only its own orders and money', { skip }, async () => {
  const atA = (await call(suppliers.get, tenant(A), { params: { id: sup } })).body.data;
  assert.deepEqual([atA.payable_balance, atA.total_purchases, atA.received_orders, atA.open_orders, atA.last_po_date], [400, 1500, 2, 1, '2026-09-10']);
  const atB = (await call(suppliers.list, tenant(B), { query: { search: 'veg' } })).body.data;
  assert.deepEqual(atB.map((x) => [x.payable_balance, x.total_purchases, x.received_orders]), [[200, 200, 1]]);
  const history = (await call(suppliers.purchaseHistory, tenant(B), { params: { id: sup } })).body.data;
  assert.deepEqual(history.map((h) => h.status).sort(), ['CANCELLED', 'RECEIVED'], 'B does not see A’s orders');
  assert.equal((await call(suppliers.purchaseHistory, tenant(null), { params: { id: sup } })).body.data.length, 5);
});

test('a supplier with no orders still lists, at zero', { skip }, async () => {
  const res = await call(suppliers.create, tenant(A), { body: { name: 'New Dairy' } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.deepEqual([res.body.data.payable_balance, res.body.data.received_orders, res.body.data.last_po_date], [0, 0, null]);
  const edited = await call(suppliers.update, tenant(A), { params: { id: res.body.data.supplier_id }, body: { phone: '9876543210' } });
  assert.equal(edited.body.data.phone, '9876543210');
});

test('another business cannot see or change these suppliers', { skip }, async () => {
  const theirs = { businessId: other, branchId: null, scopeBranchId: null, role: 'OWNER', permissions: {} };
  assert.equal((await call(suppliers.get, theirs, { params: { id: sup } })).code, 404);
  assert.equal((await call(suppliers.purchaseHistory, theirs, { params: { id: sup } })).code, 404);
  assert.equal((await call(suppliers.update, theirs, { params: { id: sup }, body: { name: 'Mine' } })).code, 404);
  assert.equal((await call(suppliers.list, theirs)).body.data.length, 0);
});
