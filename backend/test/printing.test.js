/*
 * Printing support: receipt settings (validated and merged), the invoice data a
 * receipt needs, and a KOT laid out one slip per station. Slips are printed by
 * the browser; these tests cover what the server hands it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const business = await import('../src/controllers/business.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── settings ───────────────────────────────────────────────────────────── */

test('receipt settings are checked, and unknown keys are dropped', () => {
  const ok = business.cleanReceiptSettings({ paper_width: '58', footer: '  See you soon  ', show_gstin: false, evil: 'x', show_upi_qr: 'yes' });
  assert.deepEqual(ok.settings, { paper_width: 58, footer: 'See you soon', show_gstin: false, show_upi_qr: false });
  assert.match(business.cleanReceiptSettings({ paper_width: 72 }).error, /58 or 80/);
  assert.match(business.cleanReceiptSettings({ footer: 'x'.repeat(201) }).error, /too long/);
  assert.ok(business.cleanReceiptSettings([]).error);
  assert.ok(business.cleanReceiptSettings(null).error);
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let A; let B; let owner; let stationTandoor; let stationCurry; let kot; let cancelledKot;
const tenant = (branchId, extra = {}) => ({ businessId: biz, branchId, scopeBranchId: null, role: 'OWNER', permissions: {}, ...extra });
const call = async (fn, { branch = A, params = {}, body = {}, t = {} } = {}) => { const res = fakeRes(); await fn({ tenant: tenant(branch, t), auth: { userId: owner }, params, body, query: {}, headers: {}, ip: '127.0.0.1' }, res); return res; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@pr.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, upi_vpa) VALUES ('Spice House',$1,'RESTAURANT',TRUE,'Karnataka','spice@bank') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, address, phone, gstin) VALUES ($1,'MG Road',TRUE,'12 MG Road','9800000001','29ABCDE1234F1Z5') RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Indiranagar',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  stationTandoor = (await pool.query(`INSERT INTO kitchen_stations (business_id, name, sort_order) VALUES ($1,'Tandoor',2) RETURNING station_id`, [biz])).rows[0].station_id;
  stationCurry = (await pool.query(`INSERT INTO kitchen_stations (business_id, name, sort_order) VALUES ($1,'Curry',1) RETURNING station_id`, [biz])).rows[0].station_id;
  const table = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'T4','pr-t4') RETURNING table_id`, [biz, A])).rows[0].table_id;
  const order = (await pool.query(`INSERT INTO orders (business_id, branch_id, order_number, order_type, table_id, notes) VALUES ($1,$2,'ORD-0001','DINE_IN',$3,'Birthday table') RETURNING order_id`, [biz, A, table])).rows[0].order_id;
  kot = (await pool.query(`INSERT INTO kot_tickets (business_id, order_id, kot_number, priority) VALUES ($1,$2,'KOT-0001','RUSH') RETURNING kot_id`, [biz, order])).rows[0].kot_id;
  const line = (description, quantity, station, extra = {}) => pool.query(
    `INSERT INTO order_items (order_id, description, quantity, unit_price_paise, kot_id, status, station_id, modifiers, kitchen_notes) VALUES ($1,$2,$3,10000,$4,$5,$6,$7,$8)`,
    [order, description, quantity, kot, extra.status || 'PREPARING', station, JSON.stringify(extra.modifiers || []), extra.notes || null]);
  await line('Butter Naan', 4, stationTandoor);
  await line('Butter Chicken', 2, stationCurry, { modifiers: [{ name: 'Extra spicy' }], notes: 'no onion' });
  await line('Dal Tadka', 1, stationCurry);
  await line('Paneer Tikka', 1, stationTandoor, { status: 'CANCELLED' });
  await line('Cold Water', 3, null);
  cancelledKot = kot;
});

test('a KOT is laid out one slip per station, in station order, without cancelled lines', { skip }, async () => {
  const res = await call(kitchen.printableKot, { params: { id: kot } });
  assert.equal(res.code, 200);
  const k = res.body.data;
  assert.deepEqual([k.kot_number, k.priority, k.order_number, k.table_name, k.outlet, k.order_notes], ['KOT-0001', 'RUSH', 'ORD-0001', 'T4', 'MG Road', 'Birthday table']);
  assert.deepEqual(k.stations.map((s) => s.name), ['Curry', 'Tandoor', 'Kitchen'], 'by station order, unrouted lines last');
  const curry = k.stations[0].items;
  assert.deepEqual(curry.map((i) => [i.description, i.quantity]), [['Butter Chicken', 2], ['Dal Tadka', 1]]);
  assert.deepEqual([curry[0].modifiers, curry[0].kitchen_notes], [['Extra spicy'], 'no onion']);
  assert.deepEqual(k.stations[1].items.map((i) => i.description), ['Butter Naan'], 'the cancelled Paneer Tikka is not cooked');
});

test('a KOT can only be printed by the outlet and business it belongs to', { skip }, async () => {
  assert.equal((await call(kitchen.printableKot, { params: { id: 999999 } })).code, 404);
  assert.equal((await call(kitchen.printableKot, { branch: B, params: { id: kot }, t: { scopeBranchId: B, pinned: true } })).code, 404, 'another outlet');
  const foreign = fakeRes();
  await kitchen.printableKot({ tenant: { businessId: biz + 999, scopeBranchId: null }, params: { id: kot } }, foreign);
  assert.equal(foreign.code, 404, 'another business');
  assert.equal((await call(kitchen.printableKot, { params: { id: kot }, t: { scopeBranchId: A, pinned: true } })).code, 200, 'its own outlet');
  void cancelledKot;
});

test('the invoice carries what a receipt prints: outlet, cashier, table, tax and the loyalty line', { skip }, async () => {
  // a visit card so the receipt can say where the customer stands
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Jamun','DISH',8000,5,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  await pool.query(`INSERT INTO loyalty_programs (business_id, is_enabled, visits_required, reward_product_id) VALUES ($1,TRUE,7,$2)`, [biz, product]);
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Asha','9000011111') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const client = await pool.connect();
  let inv;
  try {
    await client.query('BEGIN');
    inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: A }, owner, { customerId: customer, items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' } });
    await client.query('COMMIT');
  } finally { client.release(); }

  const res = await call(invoices.get, { params: { id: inv.invoice_id } });
  assert.equal(res.code, 200);
  const d = res.body.data;
  assert.deepEqual(d.outlet, { name: 'MG Road', address: '12 MG Road', phone: '9800000001', gstin: '29ABCDE1234F1Z5', city: null });
  assert.equal(d.cashier, 'Priya');
  assert.ok(d.created_at);
  assert.equal(d.cgst + d.sgst, 8, '5% on ₹160, split between CGST and SGST');
  assert.match(d.loyalty_message, /5 more visits/, 'one stamp so far, six needed');
  assert.equal(d.items[0].description, 'Jamun');
  // an outlet's user can't fetch another outlet's receipt
  assert.equal((await call(invoices.get, { branch: B, params: { id: inv.invoice_id }, t: { scopeBranchId: B, pinned: true } })).code, 404);
});

test('saving one receipt option keeps the others, and the defaults fill the gaps', { skip }, async () => {
  const patch = async (receipt_settings) => call(business.updateCurrent, { body: { receipt_settings } });
  assert.equal((await patch({ paper_width: 58 })).code, 200);
  assert.equal((await patch({ footer: 'Thanks!' })).code, 200);
  assert.equal((await patch({ paper_width: 99 })).code, 400);
  const shown = (await call(business.getCurrent)).body.data.receipt_settings;
  assert.deepEqual(shown, { paper_width: 58, footer: 'Thanks!', show_gstin: true, show_upi_qr: true, show_loyalty: true });
  assert.equal((await patch({ show_upi_qr: false })).code, 200);
  assert.equal((await call(business.getCurrent)).body.data.receipt_settings.show_upi_qr, false);
  assert.equal((await call(business.getCurrent)).body.data.receipt_settings.paper_width, 58, 'still 58 mm');
});
