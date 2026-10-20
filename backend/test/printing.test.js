/*
 * Printing support: receipt settings (validated and merged), the invoice data a
 * receipt needs, and a KOT laid out one slip per station. Slips are printed by
 * the browser; these tests cover what the server hands it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { cleanInvoicePrint, INVOICE_PRINT_DEFAULTS, withDefaults } from '../src/modules/invoicePrint.js';
import { cleanPrinter, cleanRouting, pickPrinter } from '../src/modules/printers.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const business = await import('../src/controllers/business.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── settings ───────────────────────────────────────────────────────────── */

test('invoice print settings are checked, ordered and filled with defaults', () => {
  const ok = cleanInvoicePrint({ layout: 'tally', paper: 'A5', text_size: 'large', accent: '#1d4ed8', copies: ['Duplicate for Transporter', 'Original for Recipient'], signature_text: '  For the firm  ', show: { hsn: false, bank: true, evil: true, terms: 'yes' }, junk: 1 });
  assert.deepEqual(ok.settings, { layout: 'tally', paper: 'A5', text_size: 'large', accent: '#1d4ed8', copies: ['Original for Recipient', 'Duplicate for Transporter'], signature_text: 'For the firm', show: { hsn: false, bank: true, terms: false } });
  assert.match(cleanInvoicePrint({ paper: 'Legal' }).error, /Paper size/);
  assert.match(cleanInvoicePrint({ accent: '#123456' }).error, /Colour/);
  assert.match(cleanInvoicePrint({ copies: ['Original for Recipient', 'Original for Recipient'] }).error, /Copies/);
  assert.match(cleanInvoicePrint({ copies: ['Fourth'] }).error, /Copies/);
  assert.match(cleanInvoicePrint({ declaration: 'x'.repeat(401) }).error, /too long/);
  assert.ok(cleanInvoicePrint('x').error);
  // a partial stored object is laid over the defaults
  const merged = withDefaults({ paper: 'A5', show: { hsn: false } });
  assert.equal(merged.paper, 'A5'); assert.equal(merged.show.hsn, false); assert.equal(merged.show.bank, true); assert.deepEqual(merged.copies, []);
  assert.match(business.cleanReceiptSettings({ invoice_print: { paper: 'Legal' } }).error, /Paper size/);
  assert.equal(business.cleanReceiptSettings({ invoice_print: { paper: 'A5' } }).settings.invoice_print.paper, 'A5');
});

test('receipt settings are checked, and unknown keys are dropped', () => {
  const ok = business.cleanReceiptSettings({ paper_width: '58', footer: '  See you soon  ', show_gstin: false, evil: 'x', show_upi_qr: 'yes' });
  assert.deepEqual(ok.settings, { paper_width: 58, footer: 'See you soon', show_gstin: false, show_upi_qr: false });
  assert.match(business.cleanReceiptSettings({ paper_width: 72 }).error, /58 or 80/);
  assert.match(business.cleanReceiptSettings({ footer: 'x'.repeat(201) }).error, /too long/);
  assert.ok(business.cleanReceiptSettings([]).error);
  const tax = business.cleanReceiptSettings({ pan: 'acbfs2635j', bank_ifsc: 'sbin0017178', bank_account: '39485051498', terms: ' Goods once sold are not returned ' });
  assert.deepEqual(tax.settings, { pan: 'ACBFS2635J', bank_ifsc: 'SBIN0017178', bank_account: '39485051498', terms: 'Goods once sold are not returned' });
  assert.match(business.cleanReceiptSettings({ pan: '12345' }).error, /PAN is not valid/);
  assert.match(business.cleanReceiptSettings({ bank_ifsc: 'SBIN1017178' }).error, /IFSC/);
  assert.equal(business.cleanReceiptSettings({ pan: '' }).settings.pan, '', 'empty clears it');
  assert.deepEqual(business.cleanReceiptSettings({ auto_cut: false, copies: '2', extra_lines: 0 }).settings, { auto_cut: false, copies: 2, extra_lines: 0 });
  assert.match(business.cleanReceiptSettings({ copies: 9 }).error, /Copies/);
  assert.match(business.cleanReceiptSettings({ extra_lines: -1 }).error, /Blank lines/);
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
  assert.deepEqual(shown, { paper_width: 58, footer: 'Thanks!', show_gstin: true, show_upi_qr: true, show_loyalty: true, show_logo: true, logo_url: null, auto_cut: true, copies: 1, extra_lines: 3, invoice_print: INVOICE_PRINT_DEFAULTS });
  assert.equal((await patch({ show_upi_qr: false })).code, 200);
  assert.equal((await call(business.getCurrent)).body.data.receipt_settings.show_upi_qr, false);
  assert.equal((await call(business.getCurrent)).body.data.receipt_settings.paper_width, 58, 'still 58 mm');
});

test('tax-invoice print details are trimmed, bounded and only the known fields', async () => {
  const { cleanPrintExtra } = await import('../src/controllers/invoices.controller.js');
  assert.deepEqual(cleanPrintExtra({ destination: ' Tushnabad ', payment_terms: 'UPI', evil: 'x' }).details, { destination: 'Tushnabad', payment_terms: 'UPI' });
  assert.match(cleanPrintExtra({ consignee_name: 'x'.repeat(161) }).error, /too long/);
  assert.ok(cleanPrintExtra([]).error);
});

test('tax-invoice details entered at billing are saved with the new invoice, and a bad one refuses the sale', { skip }, async () => {
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Brake pad','DISH',8000,18,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const made = await call(invoices.create, { body: { items: [{ product_id: product, quantity: 1 }], payment: { amount: 'FULL' }, print_details: { destination: ' Pune ', consignee_name: 'Ravi Motors', evil: 'x' } } });
  assert.equal(made.code, 201);
  const shown = (await call(invoices.get, { params: { id: made.body.data.invoice_id } })).body.data;
  assert.deepEqual(shown.print_extra, { destination: 'Pune', consignee_name: 'Ravi Motors' });
  const bad = await call(invoices.create, { body: { items: [{ product_id: product, quantity: 1 }], payment: { amount: 'FULL' }, print_details: { destination: 'x'.repeat(121) } } });
  assert.equal(bad.code, 400);
});

/* ── printers and routing ───────────────────────────────────────────────── */

test('a printer is checked and its address made ready for the agent', () => {
  const ok = (i, o) => cleanPrinter(i, o).printer;
  assert.deepEqual(ok({ name: ' Kitchen ', connection: 'NETWORK', address: '192.168.1.50' }), { name: 'Kitchen', connection: 'NETWORK', address: 'tcp://192.168.1.50:9100', paper_width: 80 });
  assert.equal(ok({ name: 'Bar', connection: 'NETWORK', address: 'tcp://10.0.0.9:9200', paper_width: 58 }).address, 'tcp://10.0.0.9:9200');
  assert.equal(ok({ name: 'Counter', connection: 'USB', address: 'share://localhost/POS80' }).address, 'share://localhost/POS80');
  assert.equal(ok({ name: 'Dialog', connection: 'BROWSER', address: 'ignored' }).address, '');
  assert.match(cleanPrinter({ name: '', connection: 'USB', address: 'lp://x' }).error, /name/);
  assert.match(cleanPrinter({ name: 'A', connection: 'WIFI', address: 'x' }).error, /connected/);
  assert.match(cleanPrinter({ name: 'A', connection: 'USB', address: 'POS80' }).error, /share:\/\//);
  assert.match(cleanPrinter({ name: 'A', connection: 'NETWORK', address: '' }).error, /address/);
  assert.match(cleanPrinter({ name: 'A', connection: 'USB', address: 'lp://x', paper_width: 72 }).error, /58 or 80/);
  assert.deepEqual(cleanPrinter({ is_active: false }, { partial: true }).printer, { is_active: false }, 'an edit checks only what it sends');
  assert.deepEqual(cleanRouting({ receipt: '3', takeaway: 'x', stations: { 5: 7, bad: 1 }, evil: 1 }).routing, { receipt: 3, takeaway: null, drawer: null, kot: null, stations: { 5: 7 } });
  // fallbacks: takeaway and drawer fall back to the receipt printer, a station to the kitchen default
  const list = [1, 2, 3].map((n) => ({ printer_id: n, is_active: true })); const routing = { receipt: 1, kot: 2, stations: { 9: 3 } };
  assert.equal(pickPrinter(routing, list, 'takeaway').printer_id, 1); assert.equal(pickPrinter(routing, list, 'drawer').printer_id, 1);
  assert.equal(pickPrinter(routing, list, 'kot', 9).printer_id, 3); assert.equal(pickPrinter(routing, list, 'kot', 4).printer_id, 2);
  assert.equal(pickPrinter({}, list, 'receipt'), null); assert.equal(pickPrinter(routing, [{ printer_id: 1, is_active: false }], 'receipt'), null);
});

test('each station\'s slip goes to its own printer, and a bill to the routed one', { skip }, async () => {
  const printersApi = await import('../src/controllers/printers.controller.js');
  const escpos = await import('../src/controllers/escpos.controller.js');
  const make = async (body) => (await call(printersApi.create, { body })).body.data.printer_id;
  const counter = await make({ name: 'Counter', connection: 'USB', address: 'share://localhost/POS80' });
  const tandoor = await make({ name: 'Tandoor printer', connection: 'NETWORK', address: '192.168.1.60', paper_width: 58 });
  const kitchen = await make({ name: 'Kitchen', connection: 'NETWORK', address: '192.168.1.61' });
  assert.equal((await call(printersApi.create, { body: { name: 'counter', connection: 'BROWSER' } })).code, 409, 'names are unique, ignoring case');
  assert.equal((await call(printersApi.create, { body: { name: 'X', connection: 'USB', address: 'nope' } })).code, 400);

  // nothing routed yet: the device's own addresses apply (no target)
  const before = await call(escpos.kot, { params: { id: kot } });
  assert.ok(before.body.data.slips.every((s) => s.target === null));

  assert.equal((await call(printersApi.saveRouting, { body: { receipt: counter, kot: kitchen, stations: { [stationTandoor]: tandoor } } })).code, 200);
  const after = (await call(escpos.kot, { params: { id: kot } })).body.data.slips;
  assert.equal(after.find((s) => s.station_id === stationTandoor).target, 'tcp://192.168.1.60:9100', 'the tandoor slip goes to the tandoor printer');
  assert.equal(after.find((s) => s.station_id === stationCurry).target, 'tcp://192.168.1.61:9100', 'the curry slip to the kitchen default');
  assert.notEqual(after.find((s) => s.station_id === stationTandoor).data, '');
  const test58 = (await call(escpos.test, { body: {} })).body.data; assert.equal(test58.target, 'share://localhost/POS80');
  assert.equal((await call(escpos.test, { body: {} , t: {} })).body.data.printer, 'Counter');
  assert.equal((await call(escpos.drawer)).body.data.target, 'share://localhost/POS80', 'the drawer follows the receipt printer');

  // a printer from another business cannot be routed to
  assert.equal((await call(printersApi.saveRouting, { body: { receipt: 99999 } })).code, 400);
  // deleting a routed printer falls back instead of breaking the print
  assert.equal((await call(printersApi.remove, { params: { id: tandoor } })).code, 200);
  assert.equal((await call(escpos.kot, { params: { id: kot } })).body.data.slips.find((s) => s.station_id === stationTandoor).target, 'tcp://192.168.1.61:9100');
});
