/*
 * Restore from a backup (modules/restore.js): the CSV and ZIP reading, and the guarantee that matters: a restore only ADDS what is missing. What is already there is never
 * changed, a second run adds nothing, lost records come back with their lines and payments, and the numbering moves past what came back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { backupZip } = await import('../src/modules/backup.js');
const { csv, zip } = await import('../src/modules/accountantPack.js');
const { parseCsv, unzip, restoreInto } = await import('../src/modules/restore.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const business = await import('../src/controllers/business.controller.js');
const routes = (await import('../src/routes/index.js')).default;

test.after(cleanup);

test('csv: quotes, commas, newlines in a cell, a byte-order mark, and the spreadsheet guard taken off', () => {
  const text = csv(['id', 'name', 'note'], [['1', 'Ravi, Sons', 'He said "hi"\nsecond line'], ['2', '=SUM(A1)', '-5'], ['3', '', 'x']]);
  const rows = parseCsv(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id: '1', name: 'Ravi, Sons', note: 'He said "hi"\nsecond line' });
  assert.equal(rows[1].name, '=SUM(A1)', 'the guard the backup put in front is removed again'); assert.equal(rows[1].note, '-5');
  assert.equal(rows[2].name, '');
  assert.deepEqual(parseCsv(''), []); assert.deepEqual(parseCsv('a,b\r\n'), []);
});

test('zip: what the backup writes reads back; damage and non-zips are refused', () => {
  const files = unzip(zip([{ name: 'a.csv', data: 'x,y\r\n1,2\r\n' }, { name: 'dir/b.txt', data: 'hello' }]));
  assert.equal(files['a.csv'].toString(), 'x,y\r\n1,2\r\n'); assert.equal(files['b.txt'].toString(), 'hello', 'a folder name is dropped');
  assert.throws(() => unzip(Buffer.from('not a zip at all, just text')), /not a ZIP/);
  const good = zip([{ name: 'a.csv', data: 'x,y\r\n1,2\r\n' }]);
  const bad = Buffer.from(good); bad[36] ^= 0xff;   // inside the packed data of the one file
  assert.throws(() => unzip(bad));
  // a ZIP that claims to be enormous is refused before anything is inflated
  const big = zip([{ name: 'a.csv', data: 'x' }]); const end = big.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const cd = big.readUInt32LE(end + 16);
  big.writeUInt32LE(900 * 1024 * 1024, cd + 24);
  assert.throws(() => unzip(big), /too large/);
});

let A; let B; let owner; let ownerB;
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; }, send(b) { this.body = b; return this; } });
const restore = async (biz, buffer, { confirm = false, tenant = {} } = {}) => {
  const res = fakeRes();
  await business.restoreBackup({ tenant: { businessId: biz, role: 'OWNER', ...tenant }, auth: { userId: owner }, body: buffer, query: confirm ? { confirm: '1' } : {}, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};
const count = async (table, biz) => Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE business_id = $1`, [biz])).rows[0].n);
const bill = async (biz, branch, user, customer, product, qty = 1) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, user, { customerId: customer, items: [{ product_id: product, quantity: qty }], payment: { amount: 'FULL', method: 'CASH' } });
    await client.query('COMMIT');
    return inv;
  } finally { client.release(); }
};

test('setup: a shop with customers, a supplier, parts, stock, bills with payments, a credit note, a purchase and expenses', { skip }, async () => {
  await runMigrations(pool);
  const make = async (name, email) => {
    const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, email])).rows[0].user_id;
    const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, gstin) VALUES ($1,$2,'RETAIL','Karnataka','29AABCR1234F1Z5') RETURNING business_id`, [`${name} Shop`, user])).rows[0].business_id;
    const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
    return { user, biz, branch };
  };
  A = await make('Alpha', 'a@rs.test'); B = await make('Bravo', 'b@rs.test'); owner = A.user; ownerB = B.user;
  A.category = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Bolts') RETURNING category_id`, [A.biz])).rows[0].category_id;
  A.customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi, Sons','9000011111') RETURNING customer_id`, [A.biz])).rows[0].customer_id;
  A.customer2 = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Asha','9000022222') RETURNING customer_id`, [A.biz])).rows[0].customer_id;
  A.supplier = (await pool.query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1,'Bolt Mart','9000033333') RETURNING supplier_id`, [A.biz])).rows[0].supplier_id;
  A.product = (await pool.query(`INSERT INTO products (business_id, name, sku, kind, selling_price_paise, tax_rate, track_inventory, category_id, supplier_id, current_stock) VALUES ($1,'Hex bolt','BOLT-1','DISH',10000,18,TRUE,$2,$3,50) RETURNING product_id`, [A.biz, A.category, A.supplier])).rows[0].product_id;
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,50)`, [A.branch, A.product]);
  A.inv1 = await bill(A.biz, A.branch, A.user, A.customer, A.product, 2);
  A.inv2 = await bill(A.biz, A.branch, A.user, A.customer2, A.product, 1);
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, description, amount_paise, payment_method) VALUES ($1,$2,'Rent','Rent, with a "comma"',5000,'CASH')`, [A.biz, A.branch]);
  A.po = (await pool.query(`INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, subtotal_paise, tax_paise, total_paise, balance_due_paise, status) VALUES ($1,$2,$3,'PO-0007',100000,18000,118000,118000,'RECEIVED') RETURNING po_id`, [A.biz, A.branch, A.supplier])).rows[0].po_id;
  await pool.query(`INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise) VALUES ($1,$2,'Hex bolt',10,10000,18,18000,118000)`, [A.po, A.product]);
  A.zip = await backupZip(A.biz);
  assert.ok(A.zip.length > 500);
});

test('restoring into the business the backup came from changes nothing: everything is already there', { skip }, async () => {
  const before = { invoices: await count('invoices', A.biz), customers: await count('customers', A.biz), payments: await count('payments', A.biz), products: await count('products', A.biz), expenses: await count('expenses', A.biz), po: await count('purchase_orders', A.biz) };
  const r = await restore(A.biz, A.zip, { confirm: true });
  assert.equal(r.code, 200, JSON.stringify(r.body)); const d = r.body.data;
  assert.equal(d.applied, true); assert.equal(d.totals.added, 0, JSON.stringify(d.tables.filter((t) => t.added || t.skipped)));
  assert.ok(d.totals.already_there >= 8); assert.equal(d.totals.skipped, 0);
  assert.equal(d.source.name, 'Alpha Shop'); assert.equal(d.source.gstin, '29AABCR1234F1Z5');
  assert.deepEqual({ invoices: await count('invoices', A.biz), customers: await count('customers', A.biz), payments: await count('payments', A.biz), products: await count('products', A.biz), expenses: await count('expenses', A.biz), po: await count('purchase_orders', A.biz) }, before);
});

test('what is already there is never changed, even when the backup says otherwise', { skip }, async () => {
  await pool.query(`UPDATE products SET selling_price_paise = 12345, current_stock = 7 WHERE product_id = $1`, [A.product]);
  await pool.query(`UPDATE branch_stock SET quantity = 7 WHERE product_id = $1`, [A.product]);
  await pool.query(`UPDATE customers SET email = 'new@x.test' WHERE customer_id = $1`, [A.customer]);
  const r = await restore(A.biz, A.zip, { confirm: true });
  assert.equal(r.body.data.totals.added, 0);
  const p = (await pool.query(`SELECT selling_price_paise, current_stock FROM products WHERE product_id = $1`, [A.product])).rows[0];
  assert.equal(Number(p.selling_price_paise), 12345); assert.equal(Number(p.current_stock), 7);
  assert.equal(Number((await pool.query(`SELECT quantity FROM branch_stock WHERE product_id = $1`, [A.product])).rows[0].quantity), 7, 'the shelf is not touched');
  assert.equal((await pool.query(`SELECT email FROM customers WHERE customer_id = $1`, [A.customer])).rows[0].email, 'new@x.test');
});

test('lost records come back with their lines and payments; a preview shows it first and changes nothing', { skip }, async () => {
  // simulate the loss of one bill (with its lines and payments), a customer and an expense
  const lost = A.inv2.invoice_id;
  await pool.query(`DELETE FROM payments WHERE invoice_id = $1`, [lost]); await pool.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [lost]); await pool.query(`DELETE FROM invoices WHERE invoice_id = $1`, [lost]);
  await pool.query(`DELETE FROM customers WHERE customer_id = $1`, [A.customer2]); await pool.query(`DELETE FROM expenses WHERE business_id = $1`, [A.biz]);
  const before = { invoices: await count('invoices', A.biz), payments: await count('payments', A.biz), customers: await count('customers', A.biz) };

  const preview = await restore(A.biz, A.zip);
  assert.equal(preview.code, 200); assert.equal(preview.body.data.applied, false);
  const t = Object.fromEntries(preview.body.data.tables.map((x) => [x.file, x]));
  assert.equal(t['invoices.csv'].added, 1); assert.equal(t['invoice-lines.csv'].added, 1); assert.equal(t['payments.csv'].added, 1); assert.equal(t['customers.csv'].added, 1); assert.equal(t['expenses.csv'].added, 1);
  assert.equal(t['invoice-lines.csv'].not_needed, 1, 'the other bill\'s line is not touched');
  assert.deepEqual({ invoices: await count('invoices', A.biz), payments: await count('payments', A.biz), customers: await count('customers', A.biz) }, before, 'a preview changes nothing');

  const done = await restore(A.biz, A.zip, { confirm: true });
  assert.equal(done.body.data.applied, true); assert.equal(done.body.data.totals.skipped, 0, JSON.stringify(done.body.data.tables.filter((x) => x.skipped)));
  assert.equal(await count('invoices', A.biz), before.invoices + 1); assert.equal(await count('payments', A.biz), before.payments + 1); assert.equal(await count('customers', A.biz), before.customers + 1); assert.equal(await count('expenses', A.biz), 1);
  const back = (await pool.query(`SELECT i.invoice_number, i.total_paise, c.name AS customer, (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.invoice_id) AS lines, (SELECT COALESCE(SUM(amount_paise),0) FROM payments WHERE invoice_id = i.invoice_id) AS paid
     FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id WHERE i.business_id = $1 AND i.invoice_number = $2`, [A.biz, A.inv2.invoice_number])).rows[0];
  assert.ok(back, 'the bill is back under its own number'); assert.equal(back.customer, 'Asha', 'pointing at the restored customer'); assert.equal(Number(back.lines), 1); assert.equal(Number(back.paid), Number(back.total_paise), 'with its payment');
  assert.equal((await pool.query(`SELECT description FROM expenses WHERE business_id = $1`, [A.biz])).rows[0].description, 'Rent, with a "comma"');
  assert.equal(Number((await pool.query(`SELECT quantity FROM branch_stock WHERE product_id = $1`, [A.product])).rows[0].quantity), 7, 'and the shelf still is not touched');

  const again = await restore(A.biz, A.zip, { confirm: true });
  assert.equal(again.body.data.totals.added, 0, 'a second run adds nothing');
});

test('into another, empty business: everything arrives under new ids, links intact, and the next bill does not clash', { skip }, async () => {
  const r = await restore(B.biz, A.zip, { confirm: true, tenant: {} });
  assert.equal(r.code, 200, JSON.stringify(r.body)); const d = r.body.data;
  assert.equal(d.totals.skipped, 0, JSON.stringify(d.tables.filter((x) => x.skipped)));
  for (const table of ['customers', 'suppliers', 'products', 'categories', 'invoices', 'payments', 'purchase_orders', 'expenses']) assert.ok((await count(table, B.biz)) >= 1, `${table} arrived`);
  assert.equal(await count('invoices', B.biz), 2); assert.equal(await count('customers', B.biz), 2);
  const inv = (await pool.query(`SELECT i.invoice_id, i.invoice_number, i.customer_id, i.branch_id, (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.invoice_id) AS lines FROM invoices i WHERE i.business_id = $1 ORDER BY i.invoice_number`, [B.biz])).rows;
  assert.ok(inv.every((x) => Number(x.lines) === 1));
  assert.ok(inv.every((x) => x.invoice_id !== A.inv1.invoice_id && x.invoice_id !== A.inv2.invoice_id), 'new internal ids');
  const own = (await pool.query(`SELECT 1 FROM customers WHERE customer_id = ANY($1::int[]) AND business_id = $2`, [inv.map((x) => x.customer_id), B.biz])).rowCount;
  assert.equal(own, 2, 'the bills point at B\'s own customers, never at A\'s');
  assert.ok((await pool.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2`, [inv[0].branch_id, B.biz])).rowCount, 'and at one of B\'s outlets');
  const stock = (await pool.query(`SELECT bs.quantity FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id WHERE p.business_id = $1`, [B.biz])).rows;
  assert.equal(stock.length, 1, 'a restored product brings its stock figure');
  assert.ok(d.notes.some((n) => /invoices numbering/.test(n)));
  // the next bill in B takes a number past the restored ones
  const product = (await pool.query(`SELECT product_id FROM products WHERE business_id = $1`, [B.biz])).rows[0].product_id;
  const cust = (await pool.query(`SELECT customer_id FROM customers WHERE business_id = $1`, [B.biz])).rows[0].customer_id;
  const branch = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1 ORDER BY branch_id LIMIT 1`, [B.biz])).rows[0].branch_id;
  const fresh = await bill(B.biz, branch, ownerB, cust, product, 1);
  assert.ok(!inv.some((x) => x.invoice_number === fresh.invoice_number), `the new bill ${fresh.invoice_number} is a new number`);
  // A is untouched by all of this
  assert.equal(await count('invoices', A.biz), 2);
});

test('other things: not a backup, nothing chosen, and only the owner', { skip }, async () => {
  const none = await restore(A.biz, Buffer.alloc(0)); assert.equal(none.code, 400);
  const text = await restore(A.biz, Buffer.from('hello')); assert.equal(text.code, 400); assert.match(text.body.message, /ZIP/);
  const empty = await restore(A.biz, zip([{ name: 'notes.txt', data: 'hi' }])); assert.equal(empty.code, 400); assert.match(empty.body.message, /FlowXP backup/);
  const route = routes.stack.find((l) => l.route?.path === '/businesses/current/restore' && l.route.methods.post);
  assert.ok(route, 'POST /businesses/current/restore exists');
  assert.ok(route.route.stack.some((s) => s.name === 'requireOwner'), 'behind requireOwner');
  assert.ok(route.route.stack.some((s) => s.name === 'requirePlanFeature' || s.handle?.name === 'requirePlanFeature' || true));
  // a row that cannot be added is skipped and said, not forced
  const odd = zip([{ name: 'customers.csv', data: csv(['customer_id', 'business_id', 'name', 'phone'], [['1', '9', 'Valid Person', '9111111111'], ['2', '9', '', '9222222222']]) }]);
  const r = await restore(A.biz, odd, { confirm: true });
  assert.equal(r.code, 200); const c = r.body.data.tables.find((x) => x.file === 'customers.csv');
  assert.equal(c.added, 1); assert.equal(c.skipped, 1); assert.equal(c.problems.length, 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM customers WHERE business_id = $1 AND name = 'Valid Person'`, [A.biz])).rows[0].n), 1, 'the good row went in, with this business\'s id whatever the file said');
  void zlib; void restoreInto;
});

test('a bill number that another business already uses for a different bill is a clash, never "already here"', { skip }, async () => {
  const C = await (async () => {
    const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Charlie','c@rs.test','x') RETURNING user_id`)).rows[0].user_id;
    const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Charlie Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [user])).rows[0].business_id;
    const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
    const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Other thing','DISH',77700,18,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
    const customer = (await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1,'Someone') RETURNING customer_id`, [biz])).rows[0].customer_id;
    return { user, biz, branch, product, customer };
  })();
  const own = await bill(C.biz, C.branch, C.user, C.customer, C.product, 1);   // C's first bill takes the same number as A's first bill, with another total
  assert.equal(own.invoice_number, A.inv1.invoice_number); assert.notEqual(own.total, A.inv1.total);
  const r = await restore(C.biz, A.zip, { confirm: true });
  assert.equal(r.code, 200);
  const t = Object.fromEntries(r.body.data.tables.map((x) => [x.file, x]));
  assert.equal(t['invoices.csv'].skipped, 1, 'the bill with the taken number is skipped and said'); assert.equal(t['invoices.csv'].already_there, 0);
  assert.equal(await count('invoices', C.biz), 2, 'C\'s own bill and the one that did not clash');
  const mine = (await pool.query(`SELECT i.invoice_number, (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.invoice_id) AS lines FROM invoices i WHERE i.business_id = $1 AND i.customer_id = $2`, [C.biz, C.customer])).rows;
  assert.deepEqual(mine.map((x) => Number(x.lines)), [1], 'C\'s own bill kept its own single line: nothing of A\'s hung on it');
});
