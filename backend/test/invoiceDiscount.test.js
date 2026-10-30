/*
 * A discount given when a customer pays: it clears part of the balance without counting as money received,
 * can settle a bill on its own, is capped by what is still owed, and shows on the party statement and in Profit & Loss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const ledger = await import('../src/controllers/ledgerReports.controller.js');
const profit = await import('../src/controllers/profitReports.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let customer; let item; let today;
const tenant = () => ({ businessId: biz, branchId: A, scopeBranchId: A, role: 'OWNER', permissions: {} });
const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant: tenant(), auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

test('a discount at payment settles part of a bill, is not takings, and is reported', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('d','d@disc.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  today = (await pool.query(`SELECT business_today($1)::text AS d`, [biz])).rows[0].d;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  customer = (await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1,'Asha') RETURNING customer_id`, [biz])).rows[0].customer_id;
  item = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Bag',50000,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;

  const inv = (await call(invoices.create, { body: { customer_id: customer, items: [{ product_id: item, quantity: 2 }] } })).body.data;   // 1,000
  const pay = (body) => call(invoices.addPayment, { params: { id: inv.invoice_id }, body });

  assert.match((await pay({ amount: 400, discount: 700 })).body.message, /more than the ₹1,000.00 still due/);
  assert.match((await pay({ amount: 100, discount: -5 })).body.message, /cannot be negative/);
  assert.deepEqual((await pay({ amount: 900, discount: 100 })).body.data, { amount_paid: 900, balance_due: 0 });

  const row = (await pool.query(`SELECT payment_status, balance_due_paise FROM invoices WHERE invoice_id = $1`, [inv.invoice_id])).rows[0];
  assert.deepEqual([row.payment_status, Number(row.balance_due_paise)], ['PAID', 0]);
  assert.equal((await pool.query(`SELECT SUM(amount_paise) AS s FROM payments WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].s, '90000', 'only the money received is a payment');

  // a discount alone can close what is left
  const inv2 = (await call(invoices.create, { body: { customer_id: customer, items: [{ product_id: item, quantity: 1 }] } })).body.data;   // 500
  await call(invoices.addPayment, { params: { id: inv2.invoice_id }, body: { amount: 480 } });
  assert.deepEqual((await call(invoices.addPayment, { params: { id: inv2.invoice_id }, body: { discount: 20 } })).body.data, { amount_paid: 480, balance_due: 0 });

  const st = (await call(ledger.partyStatement, { query: { kind: 'customer', id: String(customer), from: today, to: today } })).body.data;
  assert.equal(st.closing_balance, 0, 'sales less payments less discounts');
  assert.equal(st.lines.filter((l) => l.type === 'Discount allowed').length, 2);

  const pl = (await call(profit.profitLoss, { query: { from: today, to: today } })).body.data;
  assert.equal(pl.discounts_at_payment, 120);
});
