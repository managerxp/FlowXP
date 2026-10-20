/*
 * Party reports: All Parties lists every active party (with or without activity) with what they owe, credit limits flag, and the party / item
 * cross adds up to the party's bills from either side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const parties = await import('../src/controllers/partyReports.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let biz;
const call = async (fn, query) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, scopeBranchId: null, role: 'OWNER', permissions: {} }, query: { from: '2000-01-01', to: '2100-01-01', ...query }, params: {}, body: {}, headers: {} }, res);
  return res;
};

test('all parties and the party / item cross agree', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@pr2.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const item = async (name) => (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,$2,'DISH',10000,6000,0,FALSE) RETURNING product_id`, [biz, name])).rows[0].product_id;
  const bolt = await item('Bolt'); const nut = await item('Nut');
  const customer = async (name, limit = 0) => (await pool.query(`INSERT INTO customers (business_id, name, credit_limit_paise) VALUES ($1,$2,$3) RETURNING customer_id`, [biz, name, limit * 100])).rows[0].customer_id;
  const ravi = await customer('Ravi Motors', 150); const asha = await customer('Asha'); await customer('Idle Co');
  const bill = async (customerId, items, payment) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId, items, ...(payment ? { payment } : {}) }); await client.query('COMMIT'); } finally { client.release(); }
  };
  await bill(ravi, [{ product_id: bolt, quantity: 2 }, { product_id: nut, quantity: 1 }]);       // ₹300 on credit
  await bill(ravi, [{ product_id: bolt, quantity: 1 }], { amount: 'FULL' });                      // ₹100 paid
  await bill(asha, [{ product_id: nut, quantity: 3 }], { amount: 'FULL' });                       // ₹300 paid

  const all = (await call(parties.all, { kind: 'customers' })).body.data;
  assert.equal(all.rows.length, 3, 'Idle Co is listed though it never bought');
  const r = all.rows.find((x) => x.name === 'Ravi Motors');
  assert.deepEqual([r.docs, r.total, r.due, r.credit_limit, r.over_limit], [2, 400, 300, 150, true], '₹300 owed against a ₹150 limit');
  assert.equal(all.rows[0].name, 'Ravi Motors', 'who owes most comes first');
  assert.deepEqual([all.totals.parties, all.totals.active_in_period, all.totals.owing, all.totals.over_limit, all.totals.due], [3, 2, 1, 1, 300]);

  // what Ravi bought, and who bought Bolt: both add up
  const byParty = (await call(parties.items, { kind: 'customers', party_id: String(ravi) })).body.data;
  assert.equal(byParty.subject, 'Ravi Motors');
  assert.equal(byParty.totals.total, 400, 'the party\'s bills, line by line');
  assert.deepEqual(byParty.rows.map((x) => [x.name, x.qty, x.total]), [['Bolt', 3, 300], ['Nut', 1, 100]]);
  const byItem = (await call(parties.items, { kind: 'customers', product_id: String(bolt) })).body.data;
  assert.equal(byItem.subject, 'Bolt');
  assert.deepEqual(byItem.rows.map((x) => [x.name, x.qty]), [['Ravi Motors', 3]]);
  assert.equal((await call(parties.items, { kind: 'customers' })).code, 400, 'choose a party or an item');

  // suppliers: a received purchase
  const supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Pune Steel') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Quiet Supplier')`, [biz]);
  const po = (await pool.query(`INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, subtotal_paise, total_paise, balance_due_paise, status) VALUES ($1,$2,$3,'PO-1',10000,10000,10000,'RECEIVED') RETURNING po_id`, [biz, branch, supplier])).rows[0].po_id;
  await pool.query(`INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise) VALUES ($1,$2,'Bolt',2,5000,0,0,10000)`, [po, bolt]);
  const sup = (await call(parties.all, { kind: 'suppliers' })).body.data;
  assert.deepEqual(sup.rows.map((x) => [x.name, x.due]), [['Pune Steel', 100], ['Quiet Supplier', 0]]);
  const supItems = (await call(parties.items, { kind: 'suppliers', party_id: String(supplier) })).body.data;
  assert.deepEqual(supItems.rows.map((x) => [x.name, x.qty, x.total]), [['Bolt', 2, 100]]);
});
