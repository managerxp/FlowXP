/*
 * The dashboard: today against yesterday on the business's own date, the
 * two-week trend with every day present, best sellers and the latest bills,
 * which only people who may see reports get.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const dashboard = await import('../src/controllers/dashboard.controller.js');
const { businessToday, addDaysISO } = await import('../src/utils/dates.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let T;
test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Dee','dee@dash.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Dash Co',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const tenant = (role) => ({ businessId: biz, branchId, scopeBranchId: branchId, role, permissions: {} });
  const call = async (fn, role, extra = {}) => { const res = fakeRes(); await fn({ tenant: tenant(role), auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
  const soap = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Soap',5000,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const rice = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Rice',20000,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  T = { biz, call, soap, rice };
});

test('today, yesterday, the trend and best sellers add up to the bills', { skip }, async () => {
  const bill = async (product, qty) => {
    const res = await T.call(invoices.create, 'OWNER', { body: { items: [{ product_id: product, quantity: qty }] } });
    assert.equal(res.code, 201, JSON.stringify(res.body));
    return res.body.data.invoice_id ?? res.body.data.invoice?.invoice_id;
  };
  await bill(T.rice, 2);                        // Rs 400 today
  await bill(T.soap, 3);                        // Rs 150 today
  const old = await bill(T.soap, 1);            // moved to yesterday below
  const today = await businessToday(T.biz);
  await pool.query(`UPDATE invoices SET invoice_date = $1 WHERE invoice_id = $2`, [addDaysISO(today, -1), old]);

  const d = (await T.call(dashboard.getDashboard, 'OWNER')).body.data;
  const totals = (await pool.query(`SELECT invoice_date::text AS d, SUM(total_paise)::bigint AS t, COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND status = 'ISSUED' GROUP BY invoice_date`, [T.biz])).rows;
  const on = (date) => totals.find((r) => r.d === date) || { t: 0, n: 0 };

  assert.equal(d.metrics.today, today);
  assert.equal(d.metrics.today_invoice_count, 2);
  assert.equal(Math.round(d.metrics.today_sales * 100), Number(on(today).t));
  assert.equal(d.metrics.yesterday_invoice_count, 1);
  assert.equal(Math.round(d.metrics.yesterday_sales * 100), Number(on(addDaysISO(today, -1)).t));
  assert.equal(d.metrics.open_orders, 0);

  assert.equal(d.sales.trend.length, 14, 'every one of the 14 days is there, empty ones as zero');
  assert.equal(d.sales.trend.at(-1).date, today);
  assert.equal(d.sales.trend.at(-1).total, d.metrics.today_sales);
  assert.equal(d.sales.trend.at(-2).total, d.metrics.yesterday_sales);
  assert.equal(d.sales.trend[0].total, 0);

  assert.deepEqual(d.sales.top_products.map((p) => p.name), ['Rice', 'Soap'], 'best seller by revenue first');
  assert.equal(d.sales.top_products[1].quantity, 4, 'this week includes yesterday');
  assert.equal(d.sales.recent_invoices.length, 3);
});

test('someone who may not see reports gets today and what needs doing, not the sales detail', { skip }, async () => {
  const d = (await T.call(dashboard.getDashboard, 'CASHIER')).body.data;
  assert.equal(d.sales, null);
  assert.equal(d.metrics.today_invoice_count, 2);
});
