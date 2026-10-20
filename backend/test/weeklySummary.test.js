/*
 * The weekly summary: which week it covers, when it goes out, what it says, and that a person is told once per week however often the
 * scan runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const { inWeeklyWindow, scanWeekly, weekRanges, weeklyAlert } = await import('../src/modules/weeklySummary.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

test('the summary covers the last full Monday to Sunday', () => {
  // Wednesday 14 Oct 2026 -> Mon 5 to Sun 11 Oct, compared with Mon 28 Sep to Sun 4 Oct
  assert.deepEqual(weekRanges('2026-10-14'), { from: '2026-10-05', to: '2026-10-11', prevFrom: '2026-09-28', prevTo: '2026-10-04' });
  assert.equal(weekRanges('2026-10-12').from, '2026-10-05', 'on the Monday itself, the week that just ended');
  assert.equal(weekRanges('2026-10-11').from, '2026-09-28', 'on the Sunday, still the week before');
});

test('it goes out on Monday or Tuesday from 8 am, business time', () => {
  const at = (iso) => new Date(iso);
  assert.equal(inWeeklyWindow('Asia/Kolkata', at('2026-10-12T02:00:00Z')), false, 'Monday 7:30 am IST is too early');
  assert.equal(inWeeklyWindow('Asia/Kolkata', at('2026-10-12T03:00:00Z')), true, 'Monday 8:30 am IST');
  assert.equal(inWeeklyWindow('Asia/Kolkata', at('2026-10-13T05:00:00Z')), true, 'Tuesday still counts, in case Monday was missed');
  assert.equal(inWeeklyWindow('Asia/Kolkata', at('2026-10-14T05:00:00Z')), false, 'Wednesday does not');
  assert.equal(inWeeklyWindow('Asia/Kolkata', at('2026-10-11T20:00:00Z')), false, 'that is Monday 1:30 am in India: not yet');
});

test('it reads like a summary, and is silent for a week with no bills', () => {
  const w = { from: '2026-10-05', to: '2026-10-11', bills: 12, net_sales: 27461, gross_profit: 7000, gross_margin_pct: 25.5, total_expenses: 2000, net_profit: 5000, best_item: { name: 'Battery', profit: 1200 }, net_tax: 4000, low: 3, out_of_stock: 1, money_in: 20000, money_out: 8000 };
  const a = weeklyAlert(w, { net_sales: 20000 }, { gstOn: true });
  assert.equal(a.category, 'weekly');
  assert.equal(a.severity, 'positive', 'up 37%');
  assert.match(a.title, /₹27,461/);
  assert.match(a.body, /up 37% on the week before/);
  assert.match(a.body, /Expenses ₹2,000, leaving ₹5,000/);
  assert.match(a.body, /3 items are low on stock \(1 out\)/);
  assert.match(a.body, /GST for the week: ₹4,000/);
  assert.equal(a.dedupeKey, 'weekly:2026-10-05');
  assert.ok(!weeklyAlert(w, { net_sales: 20000 }, { gstOn: false }).body.includes('GST'));
  assert.equal(weeklyAlert({ ...w, bills: 0 }, null), null);
  assert.equal(weeklyAlert(w, { net_sales: 40000 }).severity, 'warning', 'down 31%');
});

test('the scan tells each person once per week', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@wk.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz, owner]);
  const A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,'Bolt','DISH',10000,6000,18,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;

  // a bill dated inside last week
  const { businessToday } = await import('../src/utils/dates.js');
  const { from } = weekRanges(await businessToday(biz));
  const client = await pool.connect();
  try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: A }, owner, { items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' }, invoiceDate: from }); await client.query('COMMIT'); } finally { client.release(); }

  assert.equal(await scanWeekly(biz), 1, 'the owner is told');
  assert.equal(await scanWeekly(biz), 0, 'and not again for the same week');
  const n = (await pool.query(`SELECT title, body, category FROM notifications WHERE business_id = $1`, [biz])).rows;
  assert.equal(n.length, 1);
  assert.equal(n[0].category, 'weekly');
  assert.match(n[0].title, /₹200 in sales/);
});
