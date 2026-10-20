/*
 * Reverse charge on purchases (modules/gstOptions.js): a purchase marked "tax payable on reverse charge" owes its supplier the taxable value only; the tax is the
 * buyer's own to pay to the government and to claim back (GSTR-3B 3.1(d) and 4A(3)). Refused while the option is off; every other purchase stays as it was.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { purchaseTotal } from '../src/modules/gstOptions.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const purchases = await import('../src/controllers/purchases.controller.js');
const orders = await import('../src/controllers/purchaseOrders.controller.js');
const gst = await import('../src/controllers/gst.controller.js');

test.after(cleanup);

test('what a supplier is owed', () => {
  assert.equal(purchaseTotal(100000, 18000, false), 118000);
  assert.equal(purchaseTotal(100000, 18000, true), 100000, 'the tax is not the supplier\'s');
  assert.equal(purchaseTotal('100000', '18000', true), 100000);
});

let biz; let branch; let owner; let supplier; let product;
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const call = async (fn, { body = {}, params = {}, query = {} } = {}) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, branchId: branch, scopeBranchId: null, role: 'OWNER', permissions: {} }, auth: { userId: owner }, body, params, query, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};
const setOptions = (gst_settings) => pool.query(`UPDATE businesses SET gst_settings = $2::jsonb WHERE business_id = $1`, [biz, JSON.stringify(gst_settings)]);
const row = async (id) => (await pool.query(`SELECT * FROM purchase_orders WHERE po_id = $1`, [id])).rows[0];
const item = (qty = 10) => ({ product_id: product, quantity: qty, unit_cost: 1000, tax_rate: 18 });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Raj','o@rcmbuy.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gstin, gst_enabled, state) VALUES ('Raj Traders',$1,'RETAIL','29AABCR1234F1Z5',TRUE,'Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, gstin) VALUES ($1,'Main',TRUE,'29AABCR1234F1Z5') RETURNING branch_id`, [biz])).rows[0].branch_id;
  supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Local lorry agency') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  product = (await pool.query(`INSERT INTO products (business_id, name, kind, track_inventory, purchase_price_paise, tax_rate) VALUES ($1,'Freight','INGREDIENT',FALSE,100000,18) RETURNING product_id`, [biz])).rows[0].product_id;
});

test('asking for reverse charge while the option is off is refused, not ignored', { skip }, async () => {
  const r = await call(purchases.create, { body: { supplier_id: supplier, items: [item()], reverse_charge: true } });
  assert.equal(r.code, 400); assert.match(r.body.message, /Reverse charge/);
  const d = await call(orders.createDraft, { body: { supplier_id: supplier, items: [item()], reverse_charge: true } });
  assert.equal(d.code, 400);
  const plain = await call(purchases.create, { body: { supplier_id: supplier, items: [item()] } });
  assert.equal(plain.code, 201); assert.equal(plain.body.data.reverse_charge, false); assert.equal(plain.body.data.total, 11800);
  await pool.query(`UPDATE businesses SET gst_enabled = FALSE WHERE business_id = $1`, [biz]);
  await setOptions({ reverse_charge: true });
  const nogst = await call(purchases.create, { body: { supplier_id: supplier, items: [item()], reverse_charge: true } });
  assert.equal(nogst.code, 400); assert.match(nogst.body.message, /GST/);
  await pool.query(`UPDATE businesses SET gst_enabled = TRUE WHERE business_id = $1`, [biz]);
});

test('a direct purchase on reverse charge owes the supplier the taxable value only', { skip }, async () => {
  await setOptions({ reverse_charge: true });
  const r = await call(purchases.create, { body: { supplier_id: supplier, items: [item()], reverse_charge: true, payment: { amount: 4000, method: 'CASH' } } });
  assert.equal(r.code, 201); const po = r.body.data;
  assert.equal(po.reverse_charge, true); assert.equal(po.subtotal, 10000); assert.equal(po.tax, 1800, 'the tax is still worked out'); assert.equal(po.total, 10000, 'but is not owed to the supplier');
  assert.equal(po.balance_due, 6000);
});

test('a purchase order can be marked, changed and received on reverse charge', { skip }, async () => {
  const d = await call(orders.createDraft, { body: { supplier_id: supplier, items: [item()], reverse_charge: true } });
  assert.equal(d.code, 201); const id = d.body.data.po_id;
  assert.equal(d.body.data.total, 10000); assert.equal((await row(id)).balance_due_paise, '1000000');
  const off = await call(orders.update, { params: { id }, body: { reverse_charge: false } });
  assert.equal(off.body.data.total, 11800, 'switching it off puts the tax back on what is owed'); assert.equal(off.body.data.reverse_charge, false);
  const on = await call(orders.update, { params: { id }, body: { reverse_charge: true, items: [item(20)] } });
  assert.equal(on.body.data.subtotal, 20000); assert.equal(on.body.data.tax, 3600); assert.equal(on.body.data.total, 20000);
  const sent = await call(orders.send, { params: { id }, body: { email: false } }); assert.equal(sent.code, 200);
  const got = await call(orders.receive, { params: { id }, body: {} });
  assert.equal(got.code, 200, JSON.stringify(got.body));
  const after = await row(id);
  assert.equal(after.reverse_charge, true); assert.equal(Number(after.total_paise), 2000000, 'receiving keeps the reverse-charge total'); assert.equal(Number(after.tax_paise), 360000);
  assert.equal(after.status, 'RECEIVED');
});

test('GSTR-3B shows reverse charge purchases, claims their credit, and asks for the cash', { skip }, async () => {
  const month = new Date().toISOString().slice(0, 7);
  const r = (await call(gst.gstr3b, { query: { period: month } })).body.data;
  // two reverse-charge purchases: 10,000 + 20,000 taxable, 1,800 + 3,600 tax; one ordinary purchase from a supplier with no GSTIN (no credit)
  assert.equal(r.reverse_charge_inward.taxable, 30000); assert.equal(r.reverse_charge_inward.cgst + r.reverse_charge_inward.sgst, 5400);
  assert.equal(r.itc.eligible, 5400, 'reverse charge credit counts although the supplier has no GSTIN');
  assert.equal(r.total_cash_with_reverse_charge.cgst + r.total_cash_with_reverse_charge.sgst, 5400, 'the tax is paid in cash first');
  assert.match(r.notes.join(' '), /reverse charge/);
});

/* ── wholesale buying ───────────────────────────────────────────────────── */

test('a wholesale purchase order and a direct goods receipt keep the reverse-charge total', { skip }, async () => {
  const { addProduct, addSupplier, makeWholesaler } = await import('./helpers/wholesale.js');
  const purchasing = (await import('../src/controllers/wholesalePurchasing.controller.js')).default;
  const w = await makeWholesaler(pool, 'rcm1');
  const sup = await addSupplier(pool, w);
  const p = await addProduct(pool, w, { name: 'Sugar', price: 50, cost: 40, tax: 18 });
  const refused = await w.call(purchasing.createPO, { body: { supplier_id: sup, items: [{ product_id: p, quantity: 10, unit_cost: 100 }], reverse_charge: true } });
  assert.equal(refused.code, 400, 'refused while the option is off');
  await pool.query(`UPDATE businesses SET gst_enabled = TRUE, gst_settings = '{"reverse_charge": true}'::jsonb WHERE business_id = $1`, [w.businessId]);
  const po = await w.call(purchasing.createPO, { body: { supplier_id: sup, items: [{ product_id: p, quantity: 10, unit_cost: 100 }], reverse_charge: true } });
  assert.equal(po.code, 201, JSON.stringify(po.body));
  assert.equal(po.body.data.reverse_charge, true); assert.equal(po.body.data.subtotal, 1000); assert.equal(po.body.data.tax, 180); assert.equal(po.body.data.total, 1000);
  const id = po.body.data.po_id; const itemId = po.body.data.items[0].item_id;
  const off = await w.call(purchasing.updatePO, { params: { id }, body: { reverse_charge: false } });
  assert.equal(off.body.data.total, 1180); assert.equal(off.body.data.balance, 1180);
  const on = await w.call(purchasing.updatePO, { params: { id }, body: { reverse_charge: true } });
  assert.equal(on.body.data.total, 1000);
  assert.equal((await w.call(purchasing.approvePO, { params: { id } })).body.data.status, 'ORDERED');
  const g = await w.call(purchasing.createGRN, { body: { po_id: id, items: [{ po_item_id: itemId, received: 10 }] } });
  assert.equal(g.code, 201, JSON.stringify(g.body));
  const got = (await w.call(purchasing.getPO, { params: { id } })).body.data;
  assert.equal(got.reverse_charge, true); assert.equal(got.total, 1000, 'receiving keeps what the supplier is owed'); assert.equal(got.tax, 180); assert.equal(got.balance, 1000);
  const direct = await w.call(purchasing.createGRN, { body: { supplier_id: sup, reverse_charge: true, items: [{ product_id: p, received: 5, unit_cost: 100 }] } });
  assert.equal(direct.code, 201, JSON.stringify(direct.body));
  const d = (await w.call(purchasing.getPO, { params: { id: direct.body.data.po_id } })).body.data;
  assert.equal(d.reverse_charge, true); assert.equal(d.total, 500); assert.equal(d.tax, 90);
});
