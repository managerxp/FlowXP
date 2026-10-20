/*
 * The backup: one CSV per table with this business's records only, every column as stored except the secret in a bill's public link, and the
 * owner-only route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
// imported after setupTestDb so the app's pool points at the throwaway database, not the dev one
const { backupZip } = await import('../src/modules/backup.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { shareLink } = await import('../src/modules/messaging/index.js');
const routes = (await import('../src/routes/index.js')).default;

test.after(cleanup);

const unzip = (buf) => {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16); const out = {};
  for (let i = 0; i < count; i++) {
    const csize = buf.readUInt32LE(at + 20); const crc = buf.readUInt32LE(at + 16); const nlen = buf.readUInt16LE(at + 28); const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(start, start + csize));
    assert.equal(zlib.crc32(data), crc, `CRC of ${name}`);
    out[name] = data.toString('utf8'); at += 46 + nlen;
  }
  return out;
};
const rowsOf = (text) => text.replace(/^﻿/, '').trim().split('\r\n');

test('the backup holds this business only, and nothing secret', { skip }, async () => {
  await runMigrations(pool);
  const make = async (name, email, customerName) => {
    const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, email])).rows[0].user_id;
    const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ($1,$2,'RETAIL','Karnataka') RETURNING business_id`, [`${name} Shop`, owner])).rows[0].business_id;
    const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
    const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,$2,'DISH',10000,18,FALSE) RETURNING product_id`, [biz, `${name} bolt`])).rows[0].product_id;
    const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,'9000011111') RETURNING customer_id`, [biz, customerName])).rows[0].customer_id;
    const client = await pool.connect();
    let invoiceId;
    try { await client.query('BEGIN'); invoiceId = (await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId: customer, items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' } })).invoice_id; await client.query('COMMIT'); } finally { client.release(); }
    await pool.query(`INSERT INTO expenses (business_id, branch_id, category, description, amount_paise, payment_method) VALUES ($1,$2,'Rent','Rent, with a "comma"',5000,'CASH')`, [biz, branch]);
    return { biz, invoiceId };
  };
  const a = await make('Alpha', 'a@bk.test', 'Ravi, Sons');
  const b = await make('Bravo', 'b@bk.test', 'Other Person');
  await shareLink(pool, a.invoiceId);   // the bill has a public link: its token is the secret

  const files = unzip(await backupZip(a.biz));
  assert.ok(files['README.txt'].startsWith('Alpha Shop - backup of your data'));
  assert.match(files['README.txt'], /customers\.csv: 1 rows/);
  for (const name of ['customers', 'suppliers', 'products', 'invoices', 'invoice-lines', 'payments', 'expenses', 'stock-movements', 'branches']) assert.ok(files[`${name}.csv`], `${name}.csv`);

  const customers = rowsOf(files['customers.csv']);
  assert.equal(customers.length, 2, 'a header and one customer');
  assert.ok(customers[1].includes('"Ravi, Sons"'), 'quoted where it holds a comma');
  assert.ok(!files['customers.csv'].includes('Other Person'), 'the other business is not in it');
  assert.ok(!files['products.csv'].includes('Bravo'), 'nor are its products');

  const invoices = rowsOf(files['invoices.csv']);
  assert.equal(invoices.length, 2);
  assert.ok(!invoices[0].split(',').includes('share_token'), 'the public-link secret is not a column');
  const token = (await pool.query('SELECT share_token FROM invoices WHERE invoice_id = $1', [a.invoiceId])).rows[0].share_token;
  assert.ok(token && !files['invoices.csv'].includes(token), 'and not a value either');

  assert.equal(rowsOf(files['invoice-lines.csv']).length, 2, 'the bill line of this business only');
  assert.ok(rowsOf(files['payments.csv']).length === 2);
  assert.ok(files['expenses.csv'].includes('"Rent, with a ""comma"""'));

  // the route is the owner's alone
  const route = routes.stack.find((l) => l.route?.path === '/businesses/current/backup' && l.route.methods.get);
  assert.ok(route, 'GET /businesses/current/backup exists');
  assert.ok(route.route.stack.some((s) => s.name === 'requireOwner'), 'behind requireOwner');
  void b;
});
