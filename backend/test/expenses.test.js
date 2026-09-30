/*
 * Expenses: exact period totals (not capped like the list), the field checks,
 * editing, and outlet/business isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const expenses = await import('../src/controllers/expenses.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let B; let other;
const at = (scope, branchId = scope ?? A, businessId = biz) => ({ businessId, branchId, scopeBranchId: scope, role: 'OWNER', permissions: {} });
const call = async (fn, tenant, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
const add = (tenant, body) => call(expenses.create, tenant, { body });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('e','e@exp.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Cafe',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'B') RETURNING branch_id`, [biz])).rows[0].branch_id;
  const u2 = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@exp.test','x') RETURNING user_id`)).rows[0].user_id;
  other = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Other',$1,'RETAIL') RETURNING business_id`, [u2])).rows[0].business_id;
});

test('an expense needs a category, an amount above zero, a known method and a real date', { skip }, async () => {
  assert.equal((await add(at(A), { amount: 100 })).code, 400);
  assert.equal((await add(at(A), { category: 'Rent', amount: 0 })).code, 400);
  assert.match((await add(at(A), { category: 'Rent', amount: 10, payment_method: 'CHEQUE' })).body.message, /how it was paid/);
  assert.match((await add(at(A), { category: 'Rent', amount: 10, expense_date: '2026-02-31x' })).body.message, /valid date/);
  assert.match((await add(at(A), { category: 'Rent', amount: 10, expense_date: '2026-02-31' })).body.message, /valid date/, 'no 31st of February');
  assert.match((await add(at(A), { category: 'x'.repeat(61), amount: 10 })).body.message, /up to 60/);
  const ok = await add(at(A), { category: 'Tea & snacks', amount: 45.5, payment_method: 'UPI', expense_date: '2026-09-05' });
  assert.equal(ok.code, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.category, 'Tea & snacks', 'a category of their own is kept as typed');
});

test('the summary totals a period exactly, by category and by method, per outlet', { skip }, async () => {
  await add(at(A), { category: 'Rent', amount: 30000, payment_method: 'BANK_TRANSFER', expense_date: '2026-09-01' });
  await add(at(A), { category: 'Salary', amount: 12000.25, expense_date: '2026-09-10' });
  await add(at(A), { category: 'Rent', amount: 30000, payment_method: 'BANK_TRANSFER', expense_date: '2026-08-01' });   // last month
  await add(at(B), { category: 'Rent', amount: 20000, expense_date: '2026-09-02' });                                  // the other outlet

  const sep = (await call(expenses.summary, at(A), { query: { from: '2026-09-01', to: '2026-09-30' } })).body.data;
  assert.equal(sep.total, 42045.75);
  assert.equal(sep.count, 3);
  assert.deepEqual(sep.by_category.map((c) => [c.category, c.total, c.count]), [['Rent', 30000, 1], ['Salary', 12000.25, 1], ['Tea & snacks', 45.5, 1]]);
  assert.deepEqual(sep.by_method.map((m) => [m.method, m.total]), [['BANK_TRANSFER', 30000], ['CASH', 12000.25], ['UPI', 45.5]]);
  assert.deepEqual(sep.categories.sort(), ['Rent', 'Salary', 'Tea & snacks'], 'every category this outlet has used, any date');

  const aug = (await call(expenses.summary, at(A), { query: { from: '2026-08-01', to: '2026-08-31' } })).body.data;
  assert.equal(aug.total, 30000);
  const whole = (await call(expenses.summary, at(null), { query: { from: '2026-09-01', to: '2026-09-30' } })).body.data;
  assert.equal(whole.total, 62045.75, 'all outlets together');
  assert.equal((await call(expenses.summary, at(A), { query: { from: 'soon' } })).code, 400);
});

test('an expense can be corrected with the same checks, and another outlet cannot touch it', { skip }, async () => {
  const id = (await add(at(A), { category: 'Gas', amount: 900, expense_date: '2026-09-12' })).body.data.expense_id;
  const fixed = await call(expenses.update, at(A), { params: { id }, body: { amount: 950, category: 'Gas cylinder', payment_method: 'UPI' } });
  assert.equal(fixed.code, 200);
  assert.deepEqual([fixed.body.data.amount, fixed.body.data.category, fixed.body.data.payment_method], [950, 'Gas cylinder', 'UPI']);
  assert.equal((await call(expenses.update, at(A), { params: { id }, body: { payment_method: 'IOU' } })).code, 400);
  assert.equal((await call(expenses.update, at(B), { params: { id }, body: { amount: 1 } })).code, 404, 'another outlet');
  assert.equal((await call(expenses.remove, at(null, null, other), { params: { id } })).code, 404, 'another business');
  assert.equal((await call(expenses.remove, at(A), { params: { id } })).code, 200);
  assert.equal((await call(expenses.remove, at(A), { params: { id } })).code, 404, 'gone');
});
