/*
 * Expense reports: categories carry their share and the change on the period just before, items group the same words together whatever the
 * capitals and spacing, and every view adds up to the same total.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const exp = await import('../src/controllers/expenseReports.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let biz; let A; let B;
const call = async (fn, query, scopeBranchId = null) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, scopeBranchId, role: 'OWNER', permissions: {} }, query, params: {}, body: {}, headers: {} }, res);
  return res.body.data;
};

test('expense categories, items and list agree', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@ex.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Second',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const add = (branch, category, description, rupees, method, date) => pool.query(
    `INSERT INTO expenses (business_id, branch_id, category, description, amount_paise, payment_method, expense_date) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [biz, branch, category, description, rupees * 100, method, date]);
  // the period: 11 to 20 Oct (10 days); the period before: 1 to 10 Oct
  await add(A, 'Rent', 'Shop rent', 20000, 'BANK_TRANSFER', '2026-10-12');
  await add(A, 'Electricity', 'Electricity bill', 3000, 'UPI', '2026-10-14');
  await add(A, 'Electricity', '  electricity BILL ', 1000, 'UPI', '2026-10-16');
  await add(B, 'Tea', null, 500, 'CASH', '2026-10-15');
  await add(A, 'Electricity', 'Electricity bill', 2000, 'UPI', '2026-10-05');   // before

  const q = { from: '2026-10-11', to: '2026-10-20' };
  const cat = await call(exp.byCategory, q);
  assert.deepEqual(cat.previous_range, { from: '2026-10-01', to: '2026-10-10' });
  assert.equal(cat.totals.total, 24500);
  assert.equal(cat.totals.previous, 2000);
  assert.equal(cat.totals.per_day, 2450);
  const elec = cat.rows.find((r) => r.category === 'Electricity');
  assert.deepEqual([elec.count, elec.total, elec.average, elec.biggest, elec.previous, elec.change_pct], [2, 4000, 2000, 3000, 2000, 100]);
  assert.equal(cat.rows[0].category, 'Rent');
  assert.equal(cat.rows.reduce((s, r) => s + r.share_pct, 0) > 99.5, true, 'shares add to 100');
  assert.equal(cat.by_method.reduce((s, m) => s + m.amount, 0), 24500);

  const items = await call(exp.byItem, q);
  assert.equal(items.totals.total, 24500);
  const bill = items.rows.find((r) => r.name.toLowerCase().trim() === 'electricity bill');
  assert.deepEqual([bill.count, bill.total], [2, 4000], 'same words, different capitals and spacing: one item');
  assert.ok(items.rows.some((r) => r.name === '(no description)' && r.total === 500));
  assert.deepEqual((await call(exp.byItem, { ...q, category: 'Rent' })).rows.map((r) => r.total), [20000]);

  const list = await call(exp.list, q);
  assert.equal(list.rows.length, 4);
  assert.equal(list.totals.total, 24500);
  assert.equal(list.rows[0].date, '2026-10-16', 'newest first');
  assert.equal((await call(exp.list, { ...q, q: 'rent' })).rows.length, 1);

  // an outlet's view is that outlet only
  assert.equal((await call(exp.byCategory, q, B)).totals.total, 500);
  assert.equal((await call(exp.byItem, q, B)).totals.total, 500);
  assert.equal((await call(exp.list, q, A)).rows.length, 3);
});
