/*
 * GST reports: the HSN summary must add up to the GST report that already exists, tax splits CGST + SGST inside the state, a purchase
 * from a supplier in another state is IGST, and a supplier with no GSTIN gives no claimable input credit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const gstR = await import('../src/controllers/gstReports.controller.js');
const reports = await import('../src/controllers/reports.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let biz; let A; let owner;
const call = async (fn, query = {}) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, branchId: A, scopeBranchId: null, role: 'OWNER', permissions: {} }, auth: { userId: owner }, query: { from: '2000-01-01', to: '2100-01-01', ...query }, params: {}, body: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res.body.data;
};

test('HSN summary, rate report and purchase register agree with the books', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@gs.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, gstin) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka','29AABCS1234F1Z5') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, hsn_sac, track_inventory) VALUES ($1,'Bolt','DISH',10000,18,'73181500',FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const client = await pool.connect();
  try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: A }, owner, { items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' } }); await client.query('COMMIT'); } finally { client.release(); }

  const hsn = await call(gstR.summary, { by: 'hsn', kind: 'sales' });
  assert.equal(hsn.rows.length, 1);
  assert.deepEqual([hsn.rows[0].code, hsn.rows[0].rate, hsn.rows[0].taxable, hsn.rows[0].cgst, hsn.rows[0].sgst, hsn.rows[0].igst], ['73181500', 18, 200, 18, 18, 0]);
  const existing = await call(reports.gst);
  assert.equal(hsn.totals.taxable, existing.taxable_value, 'matches the GST report that already existed');
  assert.equal(hsn.totals.tax, existing.total_tax);
  assert.equal((await call(gstR.summary, { by: 'sac', kind: 'sales' })).rows.length, 0, 'no service codes');

  // the code is kept on the bill line: changing the product's HSN later must not rewrite the bill that was already issued
  await pool.query(`UPDATE products SET hsn_sac = '99999999' WHERE product_id = $1`, [product]);
  const after = await call(gstR.summary, { by: 'hsn', kind: 'sales' });
  assert.deepEqual(after.rows.map((r) => r.code), ['73181500'], 'the old bill keeps the HSN it was sold under');
  assert.equal((await call(gstR.summary, { by: 'sac', kind: 'sales' })).rows.length, 0, 'and does not turn into a service code');
  await pool.query(`UPDATE products SET hsn_sac = '73181500' WHERE product_id = $1`, [product]);

  // two purchases: from a registered supplier in Maharashtra (IGST) and from one with no GSTIN
  const supplier = async (name, gstin) => (await pool.query(`INSERT INTO suppliers (business_id, name, gstin) VALUES ($1,$2,$3) RETURNING supplier_id`, [biz, name, gstin])).rows[0].supplier_id;
  const buy = async (supplierId, no) => {
    const po = (await pool.query(`INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, subtotal_paise, tax_paise, total_paise, balance_due_paise, status, supplier_invoice_no) VALUES ($1,$2,$3,$4,10000,1800,11800,11800,'RECEIVED',$5) RETURNING po_id`, [biz, A, supplierId, `PO-${no}`, `B-${no}`])).rows[0].po_id;
    await pool.query(`INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise) VALUES ($1,$2,'Bolt',2,5000,18,1800,11800)`, [po, product]);
  };
  await buy(await supplier('Pune Steel', '27AAACP1234A1Z5'), 1);
  await buy(await supplier('Local Hardware', null), 2);

  const g2 = await call(gstR.gstr2);
  assert.equal(g2.rows.length, 2);
  assert.equal(g2.totals.tax, 36);
  const pune = g2.rows.find((r) => r.party === 'Pune Steel');
  assert.deepEqual([pune.igst, pune.cgst, pune.sgst], [18, 0, 0], 'another state: IGST');
  assert.equal(g2.totals.claimable_tax, 18, 'only the registered supplier gives input credit');
  assert.equal(g2.totals.unregistered_tax, 18);

  const rates = await call(gstR.rates);
  assert.deepEqual(rates.rows, [{ rate: 18, sales_taxable: 200, output_tax: 36, purchase_taxable: 200, input_tax: 36, net_tax: 0 }]);
});
