/* Start fresh: only during the free trial and only the owner; wipes bills/stock history, keeps products/customers, numbering restarts at 1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const biz = await import('../src/controllers/business.controller.js');
const { requireOwner } = await import('../src/middleware/auth.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('start fresh: trial only, typed confirmation, owner only; bills gone, products and customers kept, numbering back to 1', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Asha','a@sf.test','x') RETURNING user_id`)).rows[0].user_id;
  const b = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, subscription_status) VALUES ('Shop',$1,'RETAIL','Karnataka','TRIAL') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [b])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, tax_rate, track_inventory, current_stock) VALUES ($1,'Soap',5000,0,FALSE,40) RETURNING product_id`, [b])).rows[0].product_id;
  await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi','9876543210')`, [b]);
  const bill = async () => { const c = await pool.connect(); try { await c.query('BEGIN'); const i = await createInvoiceInTransaction(c, { businessId: b, branchId: branch }, owner, { items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' } }); await c.query('COMMIT'); return i; } finally { c.release(); } };
  await bill(); await bill();
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, amount_paise, expense_date) VALUES ($1,$2,'Rent',100000,CURRENT_DATE)`, [b, branch]);
  const n = async (sql) => (await pool.query(sql, [b])).rows[0].n;

  const run = async (body, role = 'OWNER') => { const res = fakeRes(); await biz.startFreshRun({ tenant: { businessId: b, branchId: branch, role }, auth: { userId: owner }, body, headers: {}, get: () => undefined, ip: '127.0.0.1' }, res); return res; };
  const gate = (role) => { let blocked = null; requireOwner({ tenant: { role } }, { status(c) { blocked = c; return { json() {} }; } }, () => {}); return blocked; };

  assert.equal(gate('MANAGER'), 403, 'a manager is turned away by the owner gate');
  assert.equal((await run({ confirm: 'yes' })).code, 400, 'confirmation must be typed');
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`), 2);

  await pool.query(`INSERT INTO subscription_orders (business_id, plan_code, billing_cycle, amount_paise, status, paid_at) VALUES ($1,'STARTER','MONTHLY',99900,'PAID',now())`, [b]).catch(async () => {
    await pool.query(`UPDATE businesses SET subscription_status = 'ACTIVE' WHERE business_id = $1`, [b]);
  });
  assert.equal((await run({ confirm: 'START FRESH' })).code, 409, 'after a paid plan it is refused');
  await pool.query(`DELETE FROM subscription_orders WHERE business_id = $1`, [b]);
  await pool.query(`UPDATE businesses SET subscription_status = 'TRIAL' WHERE business_id = $1`, [b]);

  const res = await run({ confirm: ' start fresh ' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`), 0);
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM payments WHERE business_id = $1`), 0);
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM expenses WHERE business_id = $1`), 0);
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE business_id = $1`), 0);
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1`), 1, 'products stay');
  assert.equal(await n(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1`), 1, 'customers stay');
  assert.equal(Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [product])).rows[0].current_stock), 0, 'stock to be counted again');
  const next = await bill();
  assert.match(next.invoice_number, /-0001$/, 'numbering restarts at 1');
});
