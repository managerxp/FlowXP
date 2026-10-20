/*
 * Profit reports: profit by bill / item / party, the profit & loss, and the discount report all start from the same bills, so they
 * must agree with each other: bill profits add up to the gross profit, net profit is gross profit less expenses, and the discount
 * report adds the line discounts and the bill discount.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const profit = await import('../src/controllers/profitReports.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let biz; let A; let owner;
const call = async (fn) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, branchId: A, scopeBranchId: null, role: 'OWNER', permissions: {} }, auth: { userId: owner }, query: { from: '2000-01-01', to: '2100-01-01' }, params: {}, body: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res.body.data;
};

test('profit by bill, item and party, the P&L and the discount report agree', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@pf.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,'Bolt','DISH',10000,6000,18,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi Motors','9000033333') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const bill = async (input) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: A }, owner, { items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' }, ...input }); await client.query('COMMIT'); }
    finally { client.release(); }
  };
  await bill({ customerId: customer });                                        // 2 x ₹100, cost 2 x ₹60
  await bill({ customerId: customer, items: [{ product_id: product, quantity: 2, discount: 20 }] });   // ₹20 off the line
  await bill({});                                                              // walk-in
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method) VALUES ($1,$2,'Rent',5000,'CASH')`, [biz, A]);

  const bills = await call(profit.profitByBill);
  const pl = await call(profit.profitLoss);
  const items = await call(profit.profitByItem);
  const parties = await call(profit.profitByParty);
  assert.equal(bills.rows.length, 3);
  assert.equal(bills.totals.profit, pl.gross_profit, 'bill profits add up to the gross profit');
  assert.equal(items.totals.profit, pl.gross_profit);
  assert.equal(parties.totals.profit, pl.gross_profit);
  assert.equal(pl.cost_of_goods, 360, '3 bills x 2 bolts x ₹60');
  assert.equal(pl.net_sales, 200 + 180 + 200, 'ex-tax, after the ₹20 line discount');
  assert.equal(pl.gross_profit, pl.net_sales - pl.cost_of_goods);
  assert.equal(pl.total_expenses, 50);
  assert.equal(pl.net_profit, pl.gross_profit - 50);
  assert.deepEqual(pl.expenses, [{ category: 'Rent', amount: 50 }]);

  const disc = await call(profit.discounts);
  assert.equal(disc.rows.length, 1);
  assert.equal(disc.totals.line_discount, 20);
  assert.equal(disc.totals.discount, disc.totals.line_discount + disc.totals.bill_discount);
});
