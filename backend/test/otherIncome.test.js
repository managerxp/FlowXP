/*
 * Other income: the field checks, the period total per outlet, and that the Day Book carries it as money in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const income = await import('../src/controllers/otherIncome.controller.js');
const ledger = await import('../src/controllers/ledgerReports.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let B;
const at = (scope) => ({ businessId: biz, branchId: scope, scopeBranchId: scope, role: 'OWNER', permissions: {} });
const call = async (fn, tenant, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

test('other income: checks, period total per outlet, Day Book money in', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('i','i@inc.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'B') RETURNING branch_id`, [biz])).rows[0].branch_id;

  const add = (tenant, body) => call(income.create, tenant, { body });
  assert.equal((await add(at(A), { amount: 10 })).code, 400);
  assert.equal((await add(at(A), { category: 'Interest', amount: 0 })).code, 400);
  assert.match((await add(at(A), { category: 'Interest', amount: 5, income_date: '2026-02-31' })).body.message, /valid date/);
  assert.match((await add(at(A), { category: 'Interest', amount: 5, payment_method: 'CHEQUE' })).body.message, /how it was received/);

  assert.equal((await add(at(A), { category: 'Interest', amount: 1200.5, income_date: '2026-09-03' })).code, 201);
  await add(at(A), { category: 'Rent received', amount: 8000, payment_method: 'BANK_TRANSFER', income_date: '2026-09-05' });
  await add(at(B), { category: 'Scrap', amount: 300, income_date: '2026-09-06' });

  const list = (await call(income.list, at(A), { query: { from: '2026-09-01', to: '2026-09-30' } })).body.data;
  assert.equal(list.total, 9200.5);
  assert.equal(list.rows.length, 2, 'the other outlet is not shown');

  const book = (await call(ledger.transactions, at(A), { query: { from: '2026-09-01', to: '2026-09-30' } })).body.data;
  assert.equal(book.summary.other_income, 9200.5);
  assert.equal(book.summary.money_in, 9200.5);
  assert.equal(book.rows.filter((r) => r.type === 'OTHER_INCOME').length, 2);

  const id = list.rows[0].income_id;
  assert.equal((await call(income.remove, at(A), { params: { id: String(id) } })).code, 200);
  assert.equal((await call(income.remove, at(A), { params: { id: String(id) } })).code, 404);
});
