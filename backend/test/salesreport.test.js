/*
 * The sales report: payment methods count only money taken from customers
 * (a supplier payment is not a sale), and sales split by hour, channel and
 * category each add up to the report's total.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const reports = await import('../src/controllers/reports.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let tea; let bag;
const tenant = () => ({ businessId: biz, branchId: A, scopeBranchId: A, role: 'OWNER', permissions: {} });
const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant: tenant(), auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
let today;                       // the business's own today: rows are stamped in its timezone, not UTC
const sum = (rows, k) => Math.round(rows.reduce((t, r) => t + r[k], 0) * 100) / 100;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('r','r@rep.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Cafe',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  today = (await pool.query(`SELECT business_today($1)::text AS d`, [biz])).rows[0].d;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const drinks = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Drinks') RETURNING category_id`, [biz])).rows[0].category_id;
  tea = (await pool.query(`INSERT INTO products (business_id, name, category_id, selling_price_paise, track_inventory) VALUES ($1,'Tea',$2,2000,FALSE) RETURNING product_id`, [biz, drinks])).rows[0].product_id;
  bag = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Bag',50000,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;

  // a counter sale paid by UPI, and a takeaway order's bill paid in cash
  assert.equal((await call(invoices.create, { body: { items: [{ product_id: tea, quantity: 3 }], payment: { method: 'UPI', amount: 'FULL' } } })).code, 201);
  const order = (await pool.query(`INSERT INTO orders (business_id, branch_id, order_number, order_type, status) VALUES ($1,$2,'O-1','TAKEAWAY','BILLED') RETURNING order_id`, [biz, A])).rows[0].order_id;
  const bill = (await call(invoices.create, { body: { items: [{ product_id: bag, quantity: 1 }], payment: { method: 'CASH', amount: 'FULL' } } })).body.data;
  await pool.query(`UPDATE invoices SET order_id = $1 WHERE invoice_id = $2`, [order, bill.invoice_id]);
  // and a supplier paid by bank: not a sale, not money in
  const supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Veg Co') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  const po = (await pool.query(`INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, subtotal_paise, tax_paise, total_paise, amount_paid_paise, balance_due_paise, payment_status, status)
    VALUES ($1,$2,$3,'PO-R1',99900,0,99900,99900,0,'PAID','RECEIVED') RETURNING po_id`, [biz, A, supplier])).rows[0].po_id;
  await pool.query(`INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise) VALUES ($1,$2,$3,$4,'BANK_TRANSFER',99900)`, [biz, A, po, supplier]);
});

test('payment methods count money taken from customers, not payments to suppliers', { skip }, async () => {
  const d = (await call(reports.sales, { query: { from: today, to: today } })).body.data;
  assert.equal(d.total_sales, 560);
  assert.deepEqual(d.by_payment_method.map((m) => [m.method, m.amount]).sort(), [['CASH', 500], ['UPI', 60]]);
});

test('sales by hour, channel and category each add up to the total', { skip }, async () => {
  const d = (await call(reports.sales, { query: { from: today, to: today } })).body.data;
  assert.equal(sum(d.by_hour, 'total'), d.total_sales);
  assert.equal(sum(d.by_hour, 'invoice_count'), d.invoice_count);
  assert.deepEqual(d.by_channel.map((c) => [c.channel, c.invoice_count, c.total]), [['TAKEAWAY', 1, 500], ['COUNTER', 1, 60]]);
  assert.deepEqual(d.by_category.map((c) => [c.category, c.quantity, c.revenue]), [['No category', 1, 500], ['Drinks', 3, 60]]);
  assert.ok(d.by_hour.every((h) => Number.isInteger(h.hour) && h.hour >= 0 && h.hour <= 23));
});
