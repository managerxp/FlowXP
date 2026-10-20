/*
 * The accountant pack: a real ZIP (headers, CRC and deflate all read back correctly), CSV cells that cannot run as spreadsheet formulas, and
 * a pack whose files carry the same numbers as the reports they come from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// a test never sends real email: with no mail host the mailer only logs what it would send
const { default: config } = await import('../src/config/env.js');
config.mail.host = '';
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const { buildPack, csv, zip } = await import('../src/modules/accountantPack.js');
const accountant = await import('../src/controllers/accountantPack.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

/* a small reader of what zip() writes: the end record, then each central-directory entry, inflated and checked against its CRC */
const unzip = (buf) => {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const csize = buf.readUInt32LE(at + 20); const usize = buf.readUInt32LE(at + 24); const crc = buf.readUInt32LE(at + 16);
    const nlen = buf.readUInt16LE(at + 28); const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nlen);
    const lname = buf.readUInt16LE(local + 26); const lextra = buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(local + 30 + lname + lextra, local + 30 + lname + lextra + csize));
    assert.equal(data.length, usize); assert.equal(zlib.crc32(data), crc, `CRC of ${name}`);
    out[name] = data.toString('utf8'); at += 46 + nlen;
  }
  return out;
};

test('the ZIP writer round-trips files, including non-English text', () => {
  const files = unzip(zip([{ name: 'a.csv', data: 'x,y\r\n1,2\r\n' }, { name: 'हिन्दी.txt', data: '₹100 - रवि मोटर्स'.repeat(50) }]));
  assert.deepEqual(Object.keys(files), ['a.csv', 'हिन्दी.txt']);
  assert.equal(files['a.csv'], 'x,y\r\n1,2\r\n');
  assert.equal(files['हिन्दी.txt'], '₹100 - रवि मोटर्स'.repeat(50));
});

test('CSV cells are quoted, and a formula cannot get through', () => {
  const text = csv(['Name', 'Note'], [['Ravi, Sons', 'said "hi"'], ['=HYPERLINK("x")', '-12.5'], ['+91 98765', '@SUM(A1)']]);
  assert.ok(text.startsWith('﻿'));
  assert.ok(text.includes('"Ravi, Sons","said ""hi"""'));
  assert.ok(text.includes(`"'=HYPERLINK(""x"")",-12.5`), 'a leading = is defused, a number is not');
  assert.ok(text.includes(`'+91 98765,'@SUM(A1)`));
});

test('the pack carries the books for the period, and can be emailed to the accountant', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@ap.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, gstin) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka','29AABCS1234F1Z5') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, hsn_sac, track_inventory) VALUES ($1,'Bolt','DISH',10000,6000,18,'73181500',FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone, gstin) VALUES ($1,'Ravi Motors','9000066666','29AAACR1234A1Z5') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const client = await pool.connect();
  try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId: customer, items: [{ product_id: product, quantity: 2 }] }); await client.query('COMMIT'); } finally { client.release(); }
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, description, amount_paise, payment_method) VALUES ($1,$2,'Rent','Shop rent',5000,'CASH')`, [biz, branch]);

  const tenant = { businessId: biz, branchId: branch, scopeBranchId: null, role: 'OWNER', permissions: {} };
  const files = unzip(zip(await buildPack(tenant, '2000-01-01', '2100-01-01')));
  assert.deepEqual(Object.keys(files), ['README.txt', '1-sales-register.csv', '2-purchase-register.csv', '3-hsn-summary-sales.csv', '4-gst-by-rate.csv', '5-profit-and-loss.csv', '6-expenses.csv', '7-all-transactions.csv', '8-customers-receivable.csv', '9-suppliers-payable.csv']);
  assert.match(files['README.txt'], /Shop - accountant pack\r\nGSTIN 29AABCS1234F1Z5\r\nPeriod: 2000-01-01 to 2100-01-01/);
  assert.match(files['1-sales-register.csv'], /Invoice,[^,]+,[^,]+,Ravi Motors,29AAACR1234A1Z5,.*,B2B,18,200,18,18,0,236/);
  assert.match(files['3-hsn-summary-sales.csv'], /73181500,18,2,200,18,18,0,36,236/);
  assert.match(files['4-gst-by-rate.csv'], /18,200,36,0,0,36/);
  assert.match(files['5-profit-and-loss.csv'], /Net sales,200\r\nCost of goods,-120\r\nGross profit,80\r\nRent,-50\r\nTotal expenses,-50\r\nNet profit,30/);
  assert.match(files['6-expenses.csv'], /Rent,Shop rent,CASH,50/);
  assert.match(files['8-customers-receivable.csv'], /Ravi Motors,9000066666,29AAACR1234A1Z5,1,236,236,/);

  // emailed: the address is checked, the date range is checked, and the accountant's address is remembered
  const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const call = async (body) => { const res = fakeRes(); await accountant.email({ tenant, auth: { userId: owner }, body, query: {}, headers: {}, ip: '127.0.0.1' }, res); return res; };
  assert.equal((await call({ email: 'not an email' })).code, 400);
  assert.equal((await call({ email: 'ca@firm.test', from: '2026-12-01', to: '2026-01-01' })).code, 400);
  assert.equal((await call({ email: 'ca@firm.test', from: '2000-01-01', to: '2100-01-01' })).code, 400, 'over a year at a time is refused');
  const sent = await call({ email: 'ca@firm.test', from: '2026-04-01', to: '2027-03-31' });
  assert.equal(sent.body.data.sent_to, 'ca@firm.test');
  assert.equal((await pool.query('SELECT receipt_settings FROM businesses WHERE business_id = $1', [biz])).rows[0].receipt_settings.accountant_email, 'ca@firm.test');
});
