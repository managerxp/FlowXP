/*
 * Ledger reports: the Day Book / All transactions list, a party's statement and sales by party. The check that matters: a customer's
 * statement closes at exactly what the bills say they still owe, and the list's money-in matches what was paid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const ledger = await import('../src/controllers/ledgerReports.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let biz; let A; let owner; let customer;
const call = async (fn, query = {}) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, branchId: A, scopeBranchId: null, role: 'OWNER', permissions: {} }, auth: { userId: owner }, query, params: {}, body: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};
const WIDE = { from: '2000-01-01', to: '2100-01-01' };

test('a statement closes at what the customer still owes, and the day book adds up', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@lg.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Bolt','DISH',10000,18,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi Motors','9000022222') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const bill = async (input) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: A }, owner, { customerId: customer, items: [{ product_id: product, quantity: 2 }], ...input }); await client.query('COMMIT'); return inv; }
    finally { client.release(); }
  };
  await bill({ payment: { amount: 'FULL' } });          // paid in full
  await bill({ payment: { amount: 100 } });             // part paid
  await bill({});                                       // on credit

  const owed = Number((await pool.query(`SELECT COALESCE(SUM(balance_due_paise),0) AS b FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [biz])).rows[0].b) / 100;
  assert.ok(owed > 0, 'something is owed');

  const st = (await call(ledger.partyStatement, { kind: 'customer', id: customer, ...WIDE })).body.data;
  assert.equal(st.closing_balance, owed, 'the statement closes at what the bills say is owed');
  assert.equal(st.opening_balance, 0);

  const day = (await call(ledger.transactions, WIDE)).body.data;
  const paid = Number((await pool.query(`SELECT COALESCE(SUM(amount_paise),0) AS p FROM payments WHERE business_id = $1 AND payment_method <> 'CREDIT'`, [biz])).rows[0].p) / 100;
  assert.equal(day.summary.money_in, paid);
  assert.equal(day.rows.filter((r) => r.type === 'SALE').length, 3);
  assert.equal((await call(ledger.transactions, { ...WIDE, type: 'SALE' })).body.data.rows.every((r) => r.type === 'SALE'), true);

  const by = (await call(ledger.byParty, { kind: 'sales', ...WIDE })).body.data;
  assert.equal(by.rows[0].name, 'Ravi Motors');
  assert.equal(by.rows[0].balance, owed);
  assert.equal((await call(ledger.partyStatement, { kind: 'customer', id: 'x', ...WIDE })).code, 400);
});
