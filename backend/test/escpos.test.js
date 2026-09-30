/*
 * Silent printing: the ESC/POS builders, the endpoints that serve them, the print agent that carries them
 * to a printer (against a real TCP "printer"), and the receipt logo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { ascii, receiptBytes, kotSlips, testPage, drawerBytes } = await import('../src/modules/escpos.js');
const { createAgent, send } = await import('../../print-agent/agent.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const escpos = await import('../src/controllers/escpos.controller.js');
const business = await import('../src/controllers/business.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const has = (buf, ...bytes) => buf.includes(Buffer.from(bytes));
const textOf = (buf) => buf.toString('latin1');

/* ── the builders ───────────────────────────────────────────────────────── */

test('text is reduced to what a printer can show', () => {
  assert.equal(ascii('₹ 1,200 × 2 — café “ok”'), 'Rs  1,200 x 2 - cafe "ok"');
  assert.equal(ascii('日本'), '??');
});

const invoice = (extra = {}) => ({
  invoice_number: 'INV-0042', invoice_date: '2026-09-26', created_at: '2026-09-26T13:05:00Z', table_name: 'T4', cashier: 'Sneha',
  customer_name: 'Asha', status: 'ISSUED', outlet: { name: 'MG Road', address: '12 MG Road', city: 'Bengaluru', phone: '99999', gstin: '29ABCDE1234F1Z5' },
  items: [{ description: 'Butter Chicken with a rather long description that must wrap', quantity: 2, unit_price: 320, line_total: 640 }, { description: 'Naan', quantity: 4, unit_price: 60, line_total: 240 }],
  subtotal: 880, cgst: 22, sgst: 22, igst: 0, discount: 50, coupon_discount: 0, coupon_code: null, loyalty_discount: 0, points_discount: 0, points_redeemed: 0, round_off: 0.5,
  total: 875, payments: [{ method: 'CASH', amount: 500 }], refunded: 0, balance_due: 375, loyalty_message: '3 more visits, then a free dessert', points_earned: 40, ...extra
});
const business1 = { name: 'Spice Hub', gstin: '29ABCDE1234F1Z5', gst_enabled: true, upi_vpa: 'spice@upi' };

test('a receipt has the shop, the lines, the totals, the payments and a cut', () => {
  const out = receiptBytes({ business: business1, settings: { footer: 'Thank you!' }, invoice: invoice() }, { cols: 32 });
  const text = textOf(out);
  for (const want of ['Spice Hub', 'MG Road', 'GSTIN: 29ABCDE1234F1Z5', 'Bill INV-0042', 'Table T4', 'Served by Sneha', 'Naan', 'CGST', 'Round off', 'TOTAL', '875.00', 'Paid (CASH)', 'BALANCE DUE', 'Thank you!', 'Points earned: 40']) {
    assert.ok(text.includes(want), `missing ${want}`);
  }
  assert.deepEqual([...out.subarray(0, 2)], [0x1b, 0x40]);                       // starts with a reset
  assert.ok(has(out, 0x1d, 0x56, 0x42, 0x03));                                    // ends with a cut
  assert.ok(!has(out, 0x1b, 0x70, 0x00, 0x19, 0xfa));                             // no drawer unless asked
});

test('no line is longer than the paper, and long names wrap', () => {
  for (const cols of [32, 48]) {
    const out = receiptBytes({ business: business1, settings: {}, invoice: invoice({ balance_due: 0 }) }, { cols });
    // strip the QR block (binary), then check the printable lines
    const lines = textOf(out).split('\n').map((l) => l.replace(/[^\x20-\x7e]/g, ''));
    assert.ok(lines.every((l) => l.length <= cols + 12), `a line is too long at ${cols} columns`);   // + the few command bytes that print as text
    const total = lines.find((l) => l.includes('TOTAL'));
    assert.ok(total.replace(/[^A-Za-z0-9. ]/g, '').length <= cols / 2 + 4, 'the double-width TOTAL line fits in half the columns');
    assert.ok(textOf(out).includes('Butter Chicken with a rather'));
  }
  const narrow = textOf(receiptBytes({ business: business1, settings: {}, invoice: invoice() }, { cols: 32 }));
  assert.ok(!narrow.includes('Butter Chicken with a rather long description'));   // wrapped, not on one line
});

test('the drawer pulse is added only when asked', () => {
  assert.ok(has(receiptBytes({ business: business1, settings: {}, invoice: invoice() }, { drawer: true }), 0x1b, 0x70, 0x00, 0x19, 0xfa));
  assert.deepEqual([...drawerBytes().subarray(-5)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});

test('the QR for an unpaid balance is the printers own, and only when something is owed', () => {
  const due = receiptBytes({ business: business1, settings: { show_upi_qr: true }, invoice: invoice() });
  assert.ok(has(due, 0x1d, 0x28, 0x6b));                                            // GS ( k
  assert.ok(due.includes(Buffer.from('upi://pay?pa=spice%40upi')));
  assert.ok(!has(receiptBytes({ business: business1, settings: {}, invoice: invoice({ balance_due: 0 }) }), 0x1d, 0x28, 0x6b));
  assert.ok(!has(receiptBytes({ business: business1, settings: { show_upi_qr: false }, invoice: invoice() }), 0x1d, 0x28, 0x6b));
});

test('a cancelled bill says so; settings can hide the GSTIN', () => {
  const t = textOf(receiptBytes({ business: business1, settings: { show_gstin: false }, invoice: invoice({ status: 'CANCELLED' }) }));
  assert.ok(t.includes('*** CANCELLED ***'));
  assert.ok(!t.includes('GSTIN'));
});

test('a kitchen ticket is one slip per station, showing combos, options and notes', () => {
  const kot = {
    kot_number: 'KOT-0007', order_number: 'ORD-9', order_type: 'DINE_IN', table_name: 'T4', priority: 'RUSH', created_at: '2026-09-26T13:05:00Z', outlet: 'MG Road',
    stations: [
      { station_id: 1, name: 'Grill', items: [{ description: 'Meal Combo', quantity: 2, combo: ['1 x Burger', '1 x Fries'], modifiers: ['No onion'], kitchen_notes: 'allergy: nuts' }] },
      { station_id: null, name: 'Bar', items: [{ description: 'Lime soda', quantity: 1, modifiers: [] }] }
    ]
  };
  const slips = kotSlips(kot, { cols: 32 });
  assert.deepEqual(slips.map((s) => s.station), ['Grill', 'Bar']);
  const grill = textOf(slips[0].bytes);
  for (const want of ['KOT-0007', 'TABLE T4', 'RUSH', '2 x Meal Combo', '1 x Burger, 1 x Fries', '+ No onion', 'NOTE: allergy: nuts']) assert.ok(grill.includes(want), `missing ${want}`);
  assert.ok(!grill.includes('Lime soda'));
  assert.ok(textOf(slips[1].bytes).includes('Lime soda'));
});

test('the test page prints, and pops the drawer on request', () => {
  assert.ok(textOf(testPage()).includes('If you can read this'));
  assert.ok(!has(testPage(), 0x1b, 0x70));
  assert.ok(has(testPage({ drawer: true }), 0x1b, 0x70, 0x00, 0x19, 0xfa));
});

/* ── the endpoints ──────────────────────────────────────────────────────── */

let A; let B;
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@esc.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled) VALUES ($1,$2,'RESTAURANT',TRUE) RETURNING business_id`, [`${label} Kitchen`, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory, tax_rate) VALUES ($1,'Thali ₹',25000,FALSE,5) RETURNING product_id`, [biz.business_id])).rows[0].product_id;
  return { tenant, biz: biz.business_id, branchId, call, dish };
};
const decode = (res) => Buffer.from(res.body.data.data, 'base64');

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
});

test('a bill comes back as printer bytes built from the same data as the screen', { skip }, async () => {
  const inv = (await A.call(invoices.create, { body: { items: [{ product_id: A.dish, quantity: 2 }], payment: { amount: 200, method: 'CASH' } } })).body.data;
  const res = await A.call(escpos.receipt, { params: { id: inv.invoice_id }, query: {} });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const out = decode(res);
  const t = textOf(out);
  assert.ok(t.includes(inv.invoice_number));
  assert.ok(t.includes('Thali Rs'));                                       // the rupee sign became "Rs"
  assert.ok(t.includes('BALANCE DUE'));
  assert.equal(res.body.data.bytes, out.length);
  assert.ok(!has(out, 0x1b, 0x70));
  assert.ok(has(decode(await A.call(escpos.receipt, { params: { id: inv.invoice_id }, query: { drawer: '1' } })), 0x1b, 0x70, 0x00, 0x19, 0xfa));

  await pool.query(`UPDATE businesses SET receipt_settings = receipt_settings || '{"paper_width":58}'::jsonb WHERE business_id = $1`, [A.biz]);
  const narrow = textOf(decode(await A.call(escpos.receipt, { params: { id: inv.invoice_id }, query: {} })));
  const wide = textOf(decode(await A.call(escpos.receipt, { params: { id: inv.invoice_id }, query: { cols: '48' } })));
  assert.ok(wide.includes('-'.repeat(48)) && !narrow.includes('-'.repeat(48)) && narrow.includes('-'.repeat(32)));   // paper width follows the setting unless overridden

  assert.equal((await B.call(escpos.receipt, { params: { id: inv.invoice_id }, query: {} })).code, 404);   // not another business's bill
});

test('a kitchen ticket comes back as one job per station', { skip }, async () => {
  const table = (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,'T1','esc-t1') RETURNING table_id`, [A.biz, A.branchId])).rows[0].table_id;
  const order = (await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: table } })).body.data.order_id;
  await A.call(orders.addItems, { params: { id: order }, body: { items: [{ product_id: A.dish, quantity: 1, kitchen_notes: 'less spicy' }] } });
  await A.call(orders.sendKot, { params: { id: order }, body: {} });
  const kotId = (await pool.query(`SELECT kot_id FROM kot_tickets WHERE order_id = $1`, [order])).rows[0].kot_id;

  const res = await A.call(escpos.kot, { params: { id: kotId }, query: { cols: '32' } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.slips.length, 1);
  const t = textOf(Buffer.from(res.body.data.slips[0].data, 'base64'));
  assert.ok(t.includes('TABLE T1') && t.includes('1 x Thali Rs') && t.includes('NOTE: less spicy'));
  assert.equal((await B.call(escpos.kot, { params: { id: kotId }, query: {} })).code, 404);
});

test('the test page and the drawer kick are served', { skip }, async () => {
  assert.ok(textOf(decode(await A.call(escpos.test, { query: {} }))).includes('Print test'));
  assert.deepEqual([...Buffer.from((await A.call(escpos.drawer)).body.data.data, 'base64').subarray(-5)], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
});

/* ── the print agent ────────────────────────────────────────────────────── */

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const TOKEN = 'a-long-test-token';

test('the agent sends bytes to a network printer exactly as given', async () => {
  const got = [];
  const printer = net.createServer((s) => { const chunks = []; s.on('data', (c) => chunks.push(c)); s.on('end', () => got.push(Buffer.concat(chunks))); });
  const printerPort = await listen(printer);
  const agent = createAgent({ token: TOKEN, origins: ['https://app.example.com'] });
  const port = await listen(agent);
  try {
    const payload = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0x0a, 0x1d, 0x56, 0x42, 0x03]);
    const post = (body, headers = {}) => fetch(`http://127.0.0.1:${port}/print`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://app.example.com', ...headers }, body: JSON.stringify(body) });

    const ok = await post({ target: `tcp://127.0.0.1:${printerPort}`, data: payload.toString('base64') });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).bytes, payload.length);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(got[0], payload);

    assert.equal((await post({ target: `tcp://127.0.0.1:${printerPort}`, data: '' })).status, 400);                   // nothing to print
    const dead = await post({ target: 'tcp://127.0.0.1:1', data: payload.toString('base64') });
    assert.equal(dead.status, 502);
    assert.match((await dead.json()).error, /Could not reach the printer/);
    assert.equal((await post({ target: 'ftp://x', data: payload.toString('base64') })).status, 502);
    assert.equal((await post({ target: 'file:///etc/passwd', data: payload.toString('base64') })).status, 502);       // only /dev devices
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404);
  } finally { agent.close(); printer.close(); }
});

test('the agent refuses the wrong token and websites that are not allowed, and answers the browser preflight', async () => {
  const agent = createAgent({ token: TOKEN, origins: ['https://app.example.com'] });
  const port = await listen(agent);
  const url = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${url}/status`)).status, 401);
    assert.equal((await fetch(`${url}/status`, { headers: { authorization: 'Bearer wrong-token-here' } })).status, 401);
    assert.equal((await fetch(`${url}/status`, { headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example.com' } })).status, 403);
    const ok = await fetch(`${url}/status`, { headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://app.example.com' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
    assert.equal((await ok.json()).ok, true);

    const pre = await fetch(`${url}/print`, { method: 'OPTIONS', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
    assert.equal((await fetch(`${url}/print`, { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } })).status, 403);
  } finally { agent.close(); }
  assert.throws(() => createAgent({ token: 'short' }), /at least 8/);
});

test('printer types that do not apply on this computer say so', async () => {
  await assert.rejects(send('share://PC/Printer', Buffer.from('x')), process.platform === 'win32' ? /./ : /for Windows/);
  await assert.rejects(send('nonsense', Buffer.from('x')), /not valid/);
  await assert.rejects(send('lp://bad;name', Buffer.from('x')), /not allowed/);
});

/* ── the logo ───────────────────────────────────────────────────────────── */

test('a logo is stored, replaced and removed, and shows in the receipt settings', { skip }, async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = await A.call(business.uploadLogo, { file: { buffer: png, mimetype: 'image/png' } });
  assert.equal(up.code, 200, JSON.stringify(up.body));
  assert.match(up.body.data.logo_url, /logos\/\d+\/logo-\d+\.png$/);
  const stored = (await pool.query(`SELECT receipt_settings FROM businesses WHERE business_id = $1`, [A.biz])).rows[0].receipt_settings;
  assert.equal(stored.logo_url, up.body.data.logo_url);
  assert.equal(stored.paper_width, 58);                                     // other receipt settings survive

  assert.equal((await A.call(business.uploadLogo, {})).code, 400);           // no file
  const again = await A.call(business.uploadLogo, { file: { buffer: png, mimetype: 'image/png' } });
  assert.notEqual(again.body.data.logo_url, up.body.data.logo_url);

  assert.equal((await A.call(business.removeLogo)).body.data.logo_url, null);
  const after = (await pool.query(`SELECT receipt_settings FROM businesses WHERE business_id = $1`, [A.biz])).rows[0].receipt_settings;
  assert.equal('logo_url' in after, false);
  assert.equal(business.cleanReceiptSettings({ show_logo: false }).settings.show_logo, false);
});
