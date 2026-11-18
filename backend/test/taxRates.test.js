/*
 * Named GST rates: the default list, checks, a product on a named rate, renaming a rate moving its products, the name and kind kept on the bill,
 * and nil / exempt / non-GST supplies reported in GSTR-1 table 8 and GSTR-3B 3.1(c) / 3.1(e) instead of as 0% sales.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const rates = await import('../src/controllers/taxRates.controller.js');
const products = await import('../src/controllers/products.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { loadDocs, shape, buildGstr1, buildGstr3b, buildGstr9 } = await import('../src/modules/gst/returns.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('named GST rates: list, product, bill and returns', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@tr.test','x') RETURNING user_id`)).rows[0].user_id;
  const GSTIN = '29AABCT1234F1Z5';
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, gstin) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka',$2) RETURNING business_id`, [owner, GSTIN])).rows[0].business_id;
  const br = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const tenant = { businessId: biz, branchId: br, scopeBranchId: br, role: 'OWNER', businessType: 'RETAIL', permissions: {} };
  const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

  // the default list, made the first time it is read
  const list = (await call(rates.list)).body.data;
  const byName = Object.fromEntries(list.map((r) => [r.name, r]));
  assert.ok(byName['GST 5%'] && byName.Exempt && byName['Nil rated'] && byName['Non-GST']);
  assert.equal(byName.Exempt.kind, 'EXEMPT'); assert.equal(byName.Exempt.rate, 0);
  assert.equal((await call(rates.list)).body.data.length, list.length, 'made once');

  // checks: a name, a kind, and a 0% for anything outside GST
  assert.equal((await call(rates.create, { body: { name: '', rate: 5 } })).code, 400);
  assert.equal((await call(rates.create, { body: { name: 'gst 5%', rate: 5 } })).code, 409, 'names are unique, ignoring case');
  const mine = (await call(rates.create, { body: { name: 'Hotel room 12%', rate: 12 } })).body.data;
  assert.equal(mine.kind, 'TAXABLE'); assert.equal(mine.rate, 12);
  assert.equal((await call(rates.create, { body: { name: 'Odd exempt', kind: 'EXEMPT', rate: 9 } })).body.data.rate, 0, 'an exempt rate is always 0%');

  // a product on a named rate takes its number; changing the rate moves the product
  const made = await call(products.create, { body: { name: 'Room', selling_price: 1000, tax_rate_id: mine.tax_rate_id, track_inventory: false, price_includes_tax: false } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  const roomId = made.body.data.product_id;
  assert.equal(Number((await pool.query(`SELECT tax_rate FROM products WHERE product_id = $1`, [roomId])).rows[0].tax_rate), 12);
  await call(rates.update, { params: { id: String(mine.tax_rate_id) }, body: { rate: 18 } });
  assert.equal(Number((await pool.query(`SELECT tax_rate FROM products WHERE product_id = $1`, [roomId])).rows[0].tax_rate), 18);
  const other = (await pool.query(`INSERT INTO tax_rates (business_id, name, rate) VALUES ($1,'Theirs',5) RETURNING tax_rate_id`, [biz + 100000]).catch(() => ({ rows: [{ tax_rate_id: 999999 }] }))).rows[0].tax_rate_id;
  assert.equal((await call(products.create, { body: { name: 'Bad', selling_price: 1, tax_rate_id: other } })).code, 400, 'another business\'s rate cannot be used');

  // an exempt item and a non-GST item on one bill with a taxed item
  const exempt = (await call(products.create, { body: { name: 'Fresh milk', selling_price: 50, tax_rate_id: byName.Exempt.tax_rate_id, track_inventory: false } })).body.data.product_id;
  const nonGst = (await call(products.create, { body: { name: 'Petrol', selling_price: 100, tax_rate_id: byName['Non-GST'].tax_rate_id, track_inventory: false } })).body.data.product_id;
  const client = await pool.connect();
  let inv;
  try {
    await client.query('BEGIN');
    inv = await createInvoiceInTransaction(client, tenant, owner, { items: [{ product_id: roomId, quantity: 1 }, { product_id: exempt, quantity: 2 }, { product_id: nonGst, quantity: 1 }], payment: { amount: 'FULL' } });
    await client.query('COMMIT');
  } finally { client.release(); }
  const lines = (await pool.query(`SELECT tax_name, tax_kind, tax_amount_paise FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [inv.invoice_id])).rows;
  assert.deepEqual(lines.map((l) => [l.tax_name, l.tax_kind, Number(l.tax_amount_paise)]), [['Hotel room 12%', 'TAXABLE', 18000], ['Exempt', 'EXEMPT', 0], ['Non-GST', 'NON_GST', 0]]);

  // the returns: the room in B2CS at 18%, the milk in table 8 as exempt, the petrol as non-GST; 3B splits them the same way
  const data = await loadDocs(pool, { businessId: biz, gstin: GSTIN, from: '2000-01-01', to: '2100-01-01' });
  const shaped = shape(data);
  const g1 = buildGstr1({ data, shaped, gstin: GSTIN, fp: '012026' });
  assert.deepEqual(g1.json.b2cs.map((r) => [r.rt, r.txval]), [[18, 1000]]);
  assert.deepEqual(g1.json.nil.inv, [{ sply_ty: 'INTRAB2C', nil_amt: 0, expt_amt: 100, ngsup_amt: 100 }]);
  const g3 = buildGstr3b({ shaped, purchases: [], debits: [], gstin: GSTIN, fp: '012026' });
  assert.equal(g3.outward_taxable.taxable, 1000);
  assert.equal(g3.outward_nil_or_exempt.taxable, 100);
  assert.equal(g3.outward_non_gst.taxable, 100);

  // the annual return from the same documents: taxable B2C sales in table 4, exempt and non-GST in table 5, the HSN table filled
  const g9 = buildGstr9({ data, shaped, purchases: [], debits: [], gstin: GSTIN, fy: '2026-27' });
  assert.deepEqual([g9.table4.b2c.taxable, g9.table4.b2c.cgst + g9.table4.b2c.sgst], [1000, 180]);
  assert.deepEqual([g9.table5.exempted, g9.table5.non_gst, g9.table5.nil_rated], [100, 100, 0]);
  assert.equal(g9.turnover, 1200);
  assert.equal(g9.table9.tax_payable.cgst + g9.table9.tax_payable.sgst, 180);
});
