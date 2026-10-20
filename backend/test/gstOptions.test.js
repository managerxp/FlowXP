/*
 * GST options (modules/gstOptions.js): the validator, and what a bill does when composite, cess, TCS, TDS and reverse charge are switched on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { cleanGstSettings, cessOn, levyOn, withGstDefaults } from '../src/modules/gstOptions.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const business = await import('../src/controllers/business.controller.js');

test.after(cleanup);

test('GST options are checked, merged over defaults and unknown keys dropped', () => {
  assert.deepEqual(cleanGstSettings({ tcs: true, tcs_rate: '1.5', evil: 1, composite: 'yes' }).settings, { composite: false, tcs: true, tcs_rate: 1.5 });
  assert.match(cleanGstSettings({ tds_rate: 31 }).error, /TDS rate/);
  assert.match(cleanGstSettings({ composite_rate: -1 }).error, /composite rate/);
  assert.ok(cleanGstSettings([]).error);
  assert.deepEqual(withGstDefaults({ cess: true }), { composite: false, composite_rate: 1, cess: true, tcs: false, tcs_rate: 1, tds: false, tds_rate: 2, reverse_charge: false });
  assert.equal(cessOn(10000, 12, true), 1200); assert.equal(cessOn(10000, 12, false), 0); assert.equal(levyOn(100000, 1), 1000);
});

let biz; let branch; let owner; let product; let cessProduct;
const bill = async (extra = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { items: [{ product_id: extra.product || product, quantity: 1 }], ...extra.input });
    await client.query('COMMIT');
    return inv;
  } finally { client.release(); }
};
const setOptions = (gst_settings) => pool.query(`UPDATE businesses SET gst_settings = $2::jsonb WHERE business_id = $1`, [biz, JSON.stringify(gst_settings)]);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Raj','o@gstopt.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, round_off_enabled) VALUES ('Raj Auto',$1,'AUTO_PARTS',TRUE,'Karnataka',FALSE) RETURNING business_id`, [owner])).rows[0].business_id;
  branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Brake pad','DISH',100000,18,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  cessProduct = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, cess_rate, track_inventory) VALUES ($1,'Cola','DISH',100000,28,12,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
});

test('with every option off a bill is exactly as before', { skip }, async () => {
  const inv = await bill({ product: cessProduct, input: { tcs: true, tds: true, reverse_charge: true, reverseCharge: true } });
  assert.equal(inv.total, 1280, '₹1000 + 28% GST, no cess, no TCS');
  assert.equal(inv.cess, 0); assert.equal(inv.tcs, 0); assert.equal(inv.bill_of_supply, false); assert.equal(inv.reverse_charge, false);
});

test('cess is added on the taxable value, TCS on top, TDS taken off what the customer pays', { skip }, async () => {
  await setOptions({ cess: true, tcs: true, tcs_rate: 1, tds: true, tds_rate: 2, reverse_charge: true });
  const plain = await bill({ product: cessProduct });
  assert.equal(plain.cess, 120); assert.equal(plain.total, 1400, '1000 + 280 GST + 120 cess');
  const full = await bill({ product: cessProduct, input: { tcs: true, tds: true, reverseCharge: true, payment: { amount: 'FULL', method: 'CASH' } } });
  assert.equal(full.tcs, 10, '1% of the ₹1000 taxable value'); assert.equal(full.tds, 20);
  assert.equal(full.total, 1410, 'TCS is added to the bill'); assert.equal(full.reverse_charge, true);
  assert.equal(full.balance_due, 0, 'the cash plus the TDS the customer holds back settle it');
  assert.deepEqual(full.payments_taken.map((p) => [p.method, p.amount]), [['OTHER', 20], ['CASH', 1390]]);
  const asked = await bill({ input: { tcs: false } });
  assert.equal(asked.tcs, 0, 'the till did not ask for TCS on this bill');
});

test('a composite dealer charges no tax and issues a Bill of Supply', { skip }, async () => {
  await setOptions({ composite: true, cess: true });
  const inv = await bill({ product: cessProduct });
  assert.equal(inv.total, 1000); assert.equal(inv.tax, 0); assert.equal(inv.cess, 0); assert.equal(inv.bill_of_supply, true);
});

test('saving one GST option keeps the others (merged)', { skip }, async () => {
  await setOptions({ cess: true });
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await business.updateCurrent({ tenant: { businessId: biz, role: 'OWNER', permissions: {} }, auth: { userId: owner }, body: { gst_settings: { tcs: true, tcs_rate: 0.1 } }, params: {}, query: {}, headers: {}, ip: '127.0.0.1' }, res);
  assert.equal(res.code, 200);
  const stored = (await pool.query(`SELECT gst_settings FROM businesses WHERE business_id = $1`, [biz])).rows[0].gst_settings;
  assert.deepEqual(stored, { cess: true, tcs: true, tcs_rate: 0.1 });
});
