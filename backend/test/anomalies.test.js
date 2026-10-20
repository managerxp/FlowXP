/*
 * Unusual-number alerts: each detector speaks only when the numbers really are out of line and the history is long enough to judge, and the
 * scan tells each person once per day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const A = await import('../src/modules/anomalies.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { businessToday } = await import('../src/utils/dates.js');
const { addDaysISO } = await import('../src/utils/dates.js');

test.after(cleanup);

test('sales: a drop or spike against the same weekday, never on thin history', () => {
  const day = { date: '2026-10-13', sales: 3000, bills: 6 };   // a Tuesday
  assert.equal(A.salesAlert(day, [10000, 9000, 11000, 10000]).type, 'sales_drop');
  assert.match(A.salesAlert(day, [10000, 9000, 11000, 10000]).title, /down 70% on Tuesday/);
  assert.equal(A.salesAlert({ ...day, sales: 0, bills: 0 }, [10000, 9000, 11000]).title, 'No sales were recorded on Tuesday');
  assert.equal(A.salesAlert({ ...day, sales: 17000, bills: 20 }, [10000, 10000, 10000]).severity, 'positive');
  assert.equal(A.salesAlert({ ...day, sales: 8000 }, [10000, 9000, 11000]), null, 'down 20%: ordinary');
  assert.equal(A.salesAlert(day, [10000, 9000]), null, 'two weeks of history is not a pattern');
  assert.equal(A.salesAlert(day, [300, 200, 400]), null, 'a typical day this small proves nothing');
  assert.equal(A.salesAlert({ ...day, sales: 17000, bills: 2 }, [10000, 10000, 10000]), null, 'a spike from two bills is not news');
});

test('margin, discounts, expenses and below-cost items', () => {
  const base = { net: 100000, cogs: 70000, discount: 2000, bills: 100 };            // 30% margin, discounts 2%
  assert.equal(A.marginAlert({ net: 5000, cogs: 4000, bills: 8 }, base, 'd').type, 'margin_drop');        // 20%
  assert.equal(A.marginAlert({ net: 5000, cogs: 3600, bills: 8 }, base, 'd'), null, '28%: within the usual');
  assert.equal(A.marginAlert({ net: 5000, cogs: 4000, bills: 2 }, base, 'd'), null, 'two bills prove nothing');
  assert.equal(A.discountAlert({ discount: 1200, gross: 10000, bills: 9 }, { discount: 2000, gross: 102000 }, 'd').type, 'discount_spike');   // 12% vs 2%
  assert.equal(A.discountAlert({ discount: 300, gross: 10000, bills: 9 }, { discount: 2000, gross: 102000 }, 'd'), null, 'under the floor');
  assert.equal(A.discountAlert({ discount: 600, gross: 10000, bills: 9 }, { discount: 5000, gross: 100000 }, 'd'), null, '6% when 5% is usual');
  const quiet = Array(28).fill(500);
  assert.equal(A.expenseAlert({ total: 18000, top: { category: 'Rent', amount: 15000 } }, quiet, 'd').type, 'expense_spike');
  assert.equal(A.expenseAlert({ total: 1200, top: { category: 'Tea', amount: 1200 } }, quiet, 'd'), null, 'big against nothing, but small in rupees');
  assert.equal(A.expenseAlert({ total: 18000, top: { category: 'Rent', amount: 15000 } }, [500, 500], 'd'), null, 'not enough days to know what is usual');
  assert.match(A.belowCostAlert([{ name: 'Bolt', loss: 150 }, { name: 'Nut', loss: 80 }], 'd').title, /2 items were sold below cost/);
  assert.equal(A.belowCostAlert([{ name: 'Nut', loss: 20 }], 'd'), null);
  assert.equal(A.belowCostAlert([], 'd'), null);
});

test('the scan finds an item sold below cost and tells each person once', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@an.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz, owner]);
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  // sells for ₹40, costs ₹60
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,'Bolt','DISH',4000,6000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const yesterday = addDaysISO(await businessToday(biz), -1);
  const client = await pool.connect();
  try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { items: [{ product_id: product, quantity: 10 }], payment: { amount: 'FULL' }, invoiceDate: yesterday }); await client.query('COMMIT'); } finally { client.release(); }

  const found = await A.findAnomalies(biz, await businessToday(biz));
  assert.deepEqual(found.map((a) => a.type), ['below_cost'], 'a new shop with one day of history gets only what needs no history');
  assert.match(found[0].body, /₹200 lost in total\. Worst: Bolt/);

  assert.equal(await A.scanAnomalies(biz), 1);
  assert.equal(await A.scanAnomalies(biz), 0, 'not again the same day');
  const n = (await pool.query(`SELECT category, type FROM notifications WHERE business_id = $1`, [biz])).rows;
  assert.deepEqual(n.map((r) => [r.category, r.type]), [['unusual', 'below_cost']]);
});
