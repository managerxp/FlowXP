/*
 * Cash flow: money that moved, by method and by day. Unpaid bills are not cash; expenses, supplier payments and refunds are money out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const ledger = await import('../src/controllers/ledgerReports.controller.js');

test.after(cleanup);

test('cash flow adds money in and out by method and by day', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('c','c@cf.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO payments (business_id, branch_id, amount_paise, payment_method, payment_date) VALUES ($1,$2,50000,'CASH','2026-09-03'), ($1,$2,30000,'UPI','2026-09-03'), ($1,$2,99900,'CREDIT','2026-09-03')`, [biz, branch]);
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, expense_date) VALUES ($1,$2,'Rent',20000,'CASH','2026-09-04')`, [biz, branch]);
  await pool.query(`INSERT INTO other_income (business_id, branch_id, category, amount_paise, payment_method, income_date) VALUES ($1,$2,'Interest',1000,'BANK_TRANSFER','2026-09-04')`, [biz, branch]);

  const res = { body: null, json(b) { this.body = b; return this; } };
  await ledger.cashflow({ tenant: { businessId: biz, branchId: branch, scopeBranchId: null }, query: { from: '2026-09-01', to: '2026-09-30' } }, res);
  const d = res.body.data;
  assert.equal(d.total.money_in, 810);
  assert.equal(d.total.money_out, 200);
  assert.equal(d.total.net, 610);
  assert.equal(d.by_method.find((m) => m.method === 'CASH').net, 300);   // 500 in, 200 rent out
  assert.equal(d.by_method.find((m) => m.method === 'UPI').money_in, 300);
  assert.ok(!d.by_method.some((m) => m.method === 'CREDIT'), 'credit is not cash');
  assert.deepEqual(d.by_day.map((x) => [x.date, x.net]), [['2026-09-03', 800], ['2026-09-04', -190]]);
});
