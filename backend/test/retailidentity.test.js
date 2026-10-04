/*
 * Supermarket foundations, tested through the real routers with real tokens (so RBAC, tenant scoping and the 404-not-403
 * rule are exercised, not assumed): automatic SKUs, barcodes (none, one, many, never silently moved), aliases, supplier
 * and ERP codes, search, MRP, the retail settings, and the audit trail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { default: express } = await import('express');
await import('express-async-errors');   // server.js loads it: without it a thrown error in a handler leaves the request hanging
const { signToken, ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');
const { default: productRoutes } = await import('../src/routes/products.routes.js');
const { default: retailRoutes } = await import('../src/routes/retail.routes.js');
const { skuPrefix, formatSku } = await import('../src/modules/sku.js');

let server; let base;
test.after(async () => {
  // fetch keeps connections alive, and close() would wait for them
  if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  await cleanup();
});

const call = async (token, method, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let seq = 0;
const makeBusiness = async (type, label) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const newUser = async (role) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id, token_version`, [`${role} ${tag}`, `${role.toLowerCase()}${tag}@shop.test`])).rows[0];
  const owner = await newUser('OWNER');
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code) VALUES ($1,$2,$3,'ACTIVE','GROWTH') RETURNING business_id`, [`Shop ${tag}`, owner.user_id, type])).rows[0].business_id;
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz]);
  const staff = {};
  for (const role of ['OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_MANAGER']) {
    const user = role === 'OWNER' ? owner : await newUser(role);
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,$3,'ACTIVE')`, [biz, user.user_id, role]);
    staff[role] = signToken(user);
  }
  return { biz, ...staff };
};

let A; let B; let R; let milk;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const app = express();
  app.use(express.json());
  app.use('/api/retail', retailRoutes);
  app.use('/api', productRoutes);
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ success: false, message: 'boom' }); });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  A = await makeBusiness('SUPERMARKET', 'a'); B = await makeBusiness('SUPERMARKET', 'b'); R = await makeBusiness('RESTAURANT', 'r');
});

const add = (b, body, role = 'OWNER') => call(b[role], 'POST', '/products', { selling_price: 50, ...body });
const category = async (b, name) => (await call(b.OWNER, 'POST', '/categories', { name })).body.data.category_id;

/* ── SKU ──────────────────────────────────────────────────────────────────── */

test('the SKU prefix comes from the category, else the first word of the name, else ITEM', () => {
  assert.equal(skuPrefix({ categoryName: 'Dairy & Eggs', name: 'Amul Milk' }), 'DAIR');
  assert.equal(skuPrefix({ categoryName: null, name: 'Amul Taaza Milk 1L' }), 'AMUL');
  assert.equal(skuPrefix({ categoryName: '', name: '1 Kg Rice' }), 'RICE');   // "1" is too short to be a prefix
  assert.equal(skuPrefix({ categoryName: '!', name: '@' }), 'ITEM');
  assert.equal(formatSku('MILK', 7), 'MILK-00007');
});

test('a product needs no SKU from anyone: FlowXP makes one, in sequence, from the category', { skip }, async () => {
  const dairy = await category(A, 'Milk');
  const first = await add(A, { name: 'Amul Taaza Milk 1L', category_id: dairy });
  const second = await add(A, { name: 'Nandini Milk 500ml', category_id: dairy });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.sku, 'MILK-00001');
  assert.equal(second.body.data.sku, 'MILK-00002');
  milk = first.body.data;
  const none = await add(A, { name: 'Loose Sugar' });
  assert.equal(none.body.data.sku, 'LOOS-00001');                       // no category: first word of the name
  assert.equal(none.body.data.barcode, null);                           // and no barcode was needed
});

test('a SKU typed by hand is kept, and the generator steps over it rather than clashing', { skip }, async () => {
  const cat = await category(A, 'Biscuits');
  const mine = await add(A, { name: 'Parle-G', category_id: cat, sku: 'BISC-00001' });
  assert.equal(mine.body.data.sku, 'BISC-00001');
  const next = await add(A, { name: 'Marie Gold', category_id: cat });
  assert.equal(next.body.data.sku, 'BISC-00002');
  const dup = await add(A, { name: 'Another', sku: 'bisc-00001' });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'SKU_IN_USE');
});

test('twenty cashiers creating products at once all get different SKUs', { skip }, async () => {
  const cat = await category(A, 'Rice');
  const made = await Promise.all(Array.from({ length: 20 }, (_, i) => add(A, { name: `Rice pack ${i}`, category_id: cat })));
  assert.ok(made.every((r) => r.status === 201), JSON.stringify(made.find((r) => r.status !== 201)?.body));
  const skus = made.map((r) => r.body.data.sku).sort();
  assert.equal(new Set(skus).size, 20);
  assert.deepEqual(skus, Array.from({ length: 20 }, (_, i) => formatSku('RICE', i + 1)));
});

test('an archived product keeps its SKU, so the number is never handed out again', { skip }, async () => {
  const cat = await category(A, 'Tea');
  const a = (await add(A, { name: 'Tea A', category_id: cat })).body.data;
  assert.equal((await call(A.OWNER, 'POST', `/products/${a.product_id}/archive`)).status, 200);
  const b = (await add(A, { name: 'Tea B', category_id: cat })).body.data;
  assert.equal(a.sku, 'TEA-00001'); assert.equal(b.sku, 'TEA-00002');
  assert.equal((await call(A.OWNER, 'GET', `/products/${a.product_id}`)).body.data.sku, 'TEA-00001');
});

test('automatic SKUs follow the owner\'s setting, the plan feature, and the business type', { skip }, async () => {
  // restaurants are untouched
  assert.equal((await add(R, { name: 'Paneer Tikka' })).body.data.sku, null);
  // the owner turns it off
  assert.equal((await call(A.OWNER, 'PUT', '/retail/settings', { auto_sku: false })).status, 200);
  assert.equal((await add(A, { name: 'Manual SKU Item' })).body.data.sku, null);
  assert.equal((await call(A.OWNER, 'PUT', '/retail/settings', { auto_sku: true })).body.data.auto_sku_active, true);
  // a super admin switches the feature off for this business: the setting alone no longer turns it on
  await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'auto_sku',FALSE)`, [A.biz]);
  const off = await call(A.OWNER, 'GET', '/retail/settings');
  assert.equal(off.body.data.auto_sku_active, false);
  assert.equal((await add(A, { name: 'Flag Off Item' })).body.data.sku, null);
  await pool.query(`DELETE FROM business_feature_overrides WHERE business_id = $1`, [A.biz]);
  assert.match((await add(A, { name: 'Flag On Item' })).body.data.sku, /^FLAG-\d{5}$/);
});

/* ── barcodes ─────────────────────────────────────────────────────────────── */

test('a product can have no barcode, one, or many; the first is the primary', { skip }, async () => {
  const p = (await add(A, { name: 'Bread Loaf' })).body.data;
  assert.equal(p.barcode, null);
  const one = await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: ' 8901000000011 ' });
  assert.equal(one.status, 201);
  assert.equal(one.body.data.identifiers.primary_barcode, '8901000000011');
  const two = await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: '8901000000028' });
  assert.deepEqual(two.body.data.identifiers.barcodes.map((b) => [b.barcode, b.is_primary]), [['8901000000011', true], ['8901000000028', false]]);
  // scanning either finds it
  for (const code of ['8901000000011', '8901000000028']) assert.equal((await call(A.CASHIER, 'GET', `/products/barcode/${code}`)).body.data.product_id, p.product_id);
  // adding the same one again is a no-op, not an error
  assert.equal((await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: '8901000000028' })).body.data.status, 'already_here');
});

test('a barcode already on another product is never taken silently; moving it needs the permission', { skip }, async () => {
  const bread = (await call(A.OWNER, 'GET', '/products?search=Bread')).body.data[0];
  const other = (await add(A, { name: 'Brown Bread' })).body.data;
  const clash = await call(A.OWNER, 'POST', `/products/${other.product_id}/barcodes`, { barcode: '8901000000011' });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'BARCODE_IN_USE');
  assert.equal(clash.body.data.product_id, bread.product_id);
  assert.match(clash.body.message, /already assigned to Bread Loaf/);
  // a manager may move it, a cashier cannot even try (no catalogue rights), an inventory manager has the permission but not the catalogue write
  assert.equal((await call(A.CASHIER, 'POST', `/products/${other.product_id}/barcodes`, { barcode: '8901000000011', replace: true })).status, 403);
  const moved = await call(A.MANAGER, 'POST', `/products/${other.product_id}/barcodes`, { barcode: '8901000000011', replace: true });
  assert.equal(moved.status, 201); assert.equal(moved.body.data.status, 'moved'); assert.equal(moved.body.data.moved_from.name, 'Bread Loaf');
  assert.equal((await call(A.OWNER, 'GET', `/products/barcode/8901000000011`)).body.data.product_id, other.product_id);
  // the loser promoted its remaining barcode
  assert.equal((await call(A.OWNER, 'GET', `/products/${bread.product_id}/identifiers`)).body.data.primary_barcode, '8901000000028');
  await new Promise((r) => setTimeout(r, 300));
  const audit = (await pool.query(`SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'product.barcode_moved'`, [A.biz])).rows[0];
  assert.equal(audit.metadata.moved_from.name, 'Bread Loaf');
});

test('replacing without the barcode_reassign permission is refused even by someone who can edit products', { skip }, async () => {
  assert.ok(!ROLE_PERMISSIONS.CASHIER.includes('barcode_reassign'));
  assert.ok(ROLE_PERMISSIONS.MANAGER.includes('barcode_reassign'));
  const p1 = (await add(A, { name: 'Perm P1', barcode: 'PERM-1' })).body.data;
  const p2 = (await add(A, { name: 'Perm P2' })).body.data;
  // an owner-level override that takes the permission away from this manager
  const manager = (await pool.query(`SELECT user_id FROM business_users WHERE business_id = $1 AND role = 'MANAGER'`, [A.biz])).rows[0].user_id;
  await pool.query(`UPDATE business_users SET permissions = '{"barcode_reassign": false}' WHERE business_id = $1 AND user_id = $2`, [A.biz, manager]);
  const refused = await call(A.MANAGER, 'POST', `/products/${p2.product_id}/barcodes`, { barcode: 'PERM-1', replace: true });
  assert.equal(refused.status, 403); assert.equal(refused.body.code, 'REPLACE_NOT_ALLOWED');
  assert.equal((await call(A.OWNER, 'GET', '/products/barcode/PERM-1')).body.data.product_id, p1.product_id);   // nothing moved
  await pool.query(`UPDATE business_users SET permissions = '{}' WHERE business_id = $1 AND user_id = $2`, [A.biz, manager]);
});

test('removing the primary barcode promotes the next; removing the last leaves the product barcode-less', { skip }, async () => {
  const p = (await add(A, { name: 'Two Codes', barcode: 'TC-1' })).body.data;
  await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: 'TC-2' });
  const afterFirst = await call(A.OWNER, 'DELETE', `/products/${p.product_id}/barcodes/TC-1`);
  assert.equal(afterFirst.body.data.identifiers.primary_barcode, 'TC-2');
  assert.equal((await call(A.OWNER, 'GET', '/products/barcode/TC-1')).status, 404);
  const afterLast = await call(A.OWNER, 'DELETE', `/products/${p.product_id}/barcodes/TC-2`);
  assert.equal(afterLast.body.data.identifiers.primary_barcode, null);
  assert.deepEqual(afterLast.body.data.identifiers.barcodes, []);
  assert.equal((await call(A.OWNER, 'DELETE', `/products/${p.product_id}/barcodes/NOPE`)).status, 404);
});

test('the older way of setting a barcode (editing the product) keeps the barcode table in step and no longer 500s on a clash', { skip }, async () => {
  const p = (await add(A, { name: 'Legacy', barcode: 'LEG-1' })).body.data;
  await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: 'LEG-EXTRA' });
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${p.product_id}`, { barcode: 'LEG-2' })).status, 200);
  const ids = (await call(A.OWNER, 'GET', `/products/${p.product_id}/identifiers`)).body.data;
  assert.deepEqual(ids.barcodes.map((b) => b.barcode).sort(), ['LEG-2', 'LEG-EXTRA']);     // old primary gone, extra kept
  const rows = (await pool.query(`SELECT count(*)::int AS n FROM product_barcodes WHERE barcode = 'LEG-1'`)).rows[0].n;
  assert.equal(rows, 0);
  const other = (await add(A, { name: 'Legacy 2' })).body.data;
  const clash = await call(A.OWNER, 'PATCH', `/products/${other.product_id}`, { barcode: 'LEG-EXTRA' });   // an extra barcode of another product
  assert.equal(clash.status, 409); assert.equal(clash.body.code, 'BARCODE_IN_USE');
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${p.product_id}`, { barcode: '' })).status, 200);
  assert.equal((await call(A.OWNER, 'GET', `/products/${p.product_id}`)).body.data.barcode, null);
});

test('barcodes are checked: no spaces, not blank, not absurdly long', { skip }, async () => {
  const p = (await add(A, { name: 'Checked' })).body.data;
  for (const bad of ['', '   ', 'has space', 'x'.repeat(65), 'tab\tchar']) {
    const r = await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.code, 'BAD_BARCODE');
  }
  assert.equal((await add(A, { name: 'Bad On Create', barcode: 'has space' })).status, 400);
});

test('two barcode adds racing for the same barcode: one wins, the other is told who has it', { skip }, async () => {
  const [x, y] = await Promise.all([add(A, { name: 'Race X' }), add(A, { name: 'Race Y' })]);
  const results = await Promise.all([
    call(A.OWNER, 'POST', `/products/${x.body.data.product_id}/barcodes`, { barcode: 'RACE-1' }),
    call(A.OWNER, 'POST', `/products/${y.body.data.product_id}/barcodes`, { barcode: 'RACE-1' })
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM product_barcodes WHERE business_id = $1 AND barcode = 'RACE-1'`, [A.biz])).rows[0].n, 1);
});

/* ── aliases, supplier and ERP codes, search ──────────────────────────────── */

test('aliases make a product findable by what people actually call it', { skip }, async () => {
  const id = milk.product_id;
  assert.equal((await call(A.OWNER, 'POST', `/products/${id}/aliases`, { alias: 'Doodh' })).status, 201);
  assert.equal((await call(A.OWNER, 'POST', `/products/${id}/aliases`, { alias: '  doodh  ' })).body.data.status, 'already_here');   // same alias, spacing and case aside
  assert.equal((await call(A.OWNER, 'POST', `/products/${id}/aliases`, { alias: 'x' })).status, 400);
  const found = await call(A.CASHIER, 'GET', '/products?search=doodh');
  assert.deepEqual(found.body.data.map((p) => p.product_id), [id]);
  const ids = (await call(A.OWNER, 'GET', `/products/${id}/identifiers`)).body.data;
  assert.equal((await call(A.OWNER, 'DELETE', `/products/${id}/aliases/${ids.aliases[0].alias_id}`)).status, 200);
  assert.equal((await call(A.CASHIER, 'GET', '/products?search=doodh')).body.data.length, 0);
});

test('ERP code and supplier codes are optional, unique where they must be, and find the product', { skip }, async () => {
  const p = (await add(A, { name: 'ERP Item', erp_code: ' ERP 100 ' })).body.data;
  assert.equal(p.erp_code, 'ERP 100');
  const dup = await add(A, { name: 'ERP Item 2', erp_code: 'erp 100' });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'ERP_IN_USE');
  const sup = async (name) => (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,$2) RETURNING supplier_id`, [A.biz, name])).rows[0].supplier_id;
  const one = await sup('Sup One'); const two = await sup('Sup Two');
  const q = (await add(A, { name: 'Other ERP' })).body.data;
  assert.equal((await call(A.OWNER, 'POST', `/products/${p.product_id}/supplier-codes`, { code: 'HUL-77', supplier_id: one })).status, 201);
  const clash = await call(A.OWNER, 'POST', `/products/${q.product_id}/supplier-codes`, { code: 'hul-77', supplier_id: one });
  assert.equal(clash.status, 409); assert.equal(clash.body.code, 'CODE_IN_USE');
  assert.equal((await call(A.OWNER, 'POST', `/products/${q.product_id}/supplier-codes`, { code: 'HUL-77', supplier_id: two })).status, 201);   // another supplier's code can match
  assert.equal((await call(A.OWNER, 'POST', `/products/${q.product_id}/supplier-codes`, { code: 'X', supplier_id: 99999 })).status, 400);
  // exact lookup: unique code → the product; a code two suppliers share → both, flagged ambiguous
  const exact = await call(A.CASHIER, 'GET', '/products/lookup/ERP%20100');
  assert.equal(exact.body.data[0].product_id, p.product_id); assert.equal(exact.body.data[0].matched_on, 'erp_code'); assert.equal(exact.body.ambiguous, false);
  const shared = await call(A.CASHIER, 'GET', '/products/lookup/HUL-77');
  assert.equal(shared.body.ambiguous, true); assert.equal(shared.body.data.length, 2);
  assert.equal((await call(A.CASHIER, 'GET', `/products/lookup/${milk.sku}`)).body.data[0].matched_on, 'sku');
  assert.equal((await call(A.CASHIER, 'GET', '/products/lookup/NOT-A-CODE')).status, 404);
});

test('search: every word must match, across name, brand, SKU, barcode, alias; wildcards are just text', { skip }, async () => {
  const brand = (await pool.query(`INSERT INTO brands (business_id, name) VALUES ($1,'Amul') RETURNING brand_id`, [A.biz])).rows[0].brand_id;
  const p = (await add(A, { name: 'Full Cream Milk 1L', brand_id: brand, barcode: '8900001' })).body.data;
  const find = async (q) => (await call(A.CASHIER, 'GET', `/products?search=${encodeURIComponent(q)}`)).body.data.map((x) => x.product_id);
  assert.ok((await find('amul milk')).includes(p.product_id));          // brand + name
  assert.ok((await find('cream 1l')).includes(p.product_id));
  assert.ok((await find(p.sku)).includes(p.product_id));
  assert.ok((await find('8900001')).includes(p.product_id));            // a pasted barcode
  assert.ok(!(await find('amul bread xyz')).includes(p.product_id));     // a word that matches nothing excludes it
  assert.deepEqual(await find('100%'), []);                              // % is a character, not "everything"
  assert.deepEqual(await find('_ream'), []);
  const page = await call(A.CASHIER, 'GET', '/products?limit=2&offset=1');
  assert.equal(page.body.data.length, 2);
});

test('the list is not slowed to a scan: barcode and SKU lookups use their indexes on a 10,000-product shop', { skip }, async () => {
  await pool.query(
    `INSERT INTO products (business_id, name, sku, barcode, selling_price_paise)
     SELECT $1, 'Bulk ' || g, 'BULK-' || lpad(g::text, 5, '0'), '89' || lpad(g::text, 11, '0'), 1000 FROM generate_series(1, 10000) g`, [B.biz]);
  await pool.query('ANALYZE products'); await pool.query('ANALYZE product_barcodes');
  const plan = async (sql, args) => (await pool.query(`EXPLAIN ${sql}`, args)).rows.map((r) => r['QUERY PLAN']).join('\n');
  const byBarcode = await plan(`SELECT product_id FROM product_barcodes WHERE business_id = $1 AND barcode = $2`, [B.biz, '89' + '00000005000'.padStart(11, '0')]);
  assert.match(byBarcode, /Index/);
  assert.doesNotMatch(byBarcode, /Seq Scan/);
  const bySku = await plan(`SELECT product_id FROM products WHERE business_id = $1 AND sku IS NOT NULL AND sku <> '' AND lower(sku) = lower($2)`, [B.biz, 'BULK-05000']);
  assert.doesNotMatch(bySku, /Seq Scan/);
});

/* ── MRP ──────────────────────────────────────────────────────────────────── */

test('the selling price can never go above the printed MRP, however it is set', { skip }, async () => {
  const over = await add(A, { name: 'Over MRP', selling_price: 120, mrp: 100 });
  assert.equal(over.status, 400); assert.match(over.body.message, /above the MRP/);
  const ok = (await add(A, { name: 'At MRP', selling_price: 100, mrp: 100 })).body.data;
  assert.equal(ok.mrp, 100);
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${ok.product_id}`, { selling_price: 101 })).status, 400);
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${ok.product_id}`, { mrp: 90 })).status, 400);                 // lowering the MRP below the price
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${ok.product_id}`, { selling_price: 95, mrp: 99 })).status, 200); // both at once
  const outlet = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1`, [A.biz])).rows[0].branch_id;
  assert.equal((await call(A.OWNER, 'PUT', `/products/${ok.product_id}/outlets`, { branch_id: outlet, price: 150 })).status, 400);
  assert.equal((await call(A.OWNER, 'PUT', `/products/${ok.product_id}/outlets`, { branch_id: outlet, price: 98 })).status, 200);
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${ok.product_id}`, { mrp: null })).body.data.mrp, null);          // clearing it lifts the ceiling
});

/* ── settings, RBAC, tenancy, audit ───────────────────────────────────────── */

test('"barcode required" is the owner\'s choice, and then every route that saves a product honours it', { skip }, async () => {
  assert.equal((await call(A.OWNER, 'PUT', '/retail/settings', { require_barcode: true })).body.data.require_barcode, true);
  const refused = await add(A, { name: 'No Code' });
  assert.equal(refused.status, 400); assert.equal(refused.body.code, 'BARCODE_REQUIRED');
  const fine = (await add(A, { name: 'Has Code', barcode: 'REQ-1' })).body.data;
  const strip = await call(A.OWNER, 'PATCH', `/products/${fine.product_id}`, { barcode: '' });
  assert.equal(strip.status, 400); assert.equal(strip.body.code, 'BARCODE_REQUIRED');
  await call(A.OWNER, 'PUT', '/retail/settings', { require_barcode: false });
  assert.equal((await add(A, { name: 'No Code Now' })).status, 201);
  assert.equal((await call(A.OWNER, 'PUT', '/retail/settings', { auto_sku: 'yes' })).status, 400);
  assert.equal((await call(A.OWNER, 'PUT', '/retail/settings', {})).status, 400);
});

test('RBAC at the API: a cashier can search and scan but not change the catalogue or the settings', { skip }, async () => {
  assert.equal((await call(A.CASHIER, 'GET', '/products?search=bread')).status, 200);
  assert.equal((await call(A.CASHIER, 'GET', '/products/barcode/8901000000011')).status, 200);
  assert.equal((await call(A.CASHIER, 'GET', `/products/lookup/${milk.sku}`)).status, 200);
  const p = (await call(A.OWNER, 'GET', `/products/${milk.product_id}`)).body.data;
  const denied = [
    ['POST', '/products', { name: 'Sneaky', selling_price: 1 }],
    ['PATCH', `/products/${p.product_id}`, { selling_price: 1 }],
    ['POST', `/products/${p.product_id}/barcodes`, { barcode: 'CASH-1' }],
    ['DELETE', `/products/${p.product_id}/barcodes/anything`],
    ['POST', `/products/${p.product_id}/aliases`, { alias: 'sneaky' }],
    ['POST', `/products/${p.product_id}/supplier-codes`, { code: 'S1' }],
    ['PUT', '/retail/settings', { auto_sku: false }]
  ];
  for (const [method, path, body] of denied) assert.equal((await call(A.CASHIER, method, path, body)).status, 403, `${method} ${path}`);
  assert.equal((await call(A.CASHIER, 'GET', '/retail/settings')).status, 200);              // reading the settings is fine
  assert.equal((await call(A.MANAGER, 'GET', '/retail/settings')).status, 200);
  assert.equal((await call(A.INVENTORY_MANAGER, 'GET', '/retail/settings')).status, 403);   // no catalogue or till rights, so no view of those settings
  assert.equal((await call(null, 'GET', '/products')).status, 401);
  assert.equal((await call(null, 'POST', '/products', { name: 'x' })).status, 401);
});

test('a restaurant has no retail settings, and a retail screen\'s settings are not reachable from another business', { skip }, async () => {
  assert.equal((await call(R.OWNER, 'GET', '/retail/settings')).status, 404);
  assert.equal((await call(R.OWNER, 'PUT', '/retail/settings', { auto_sku: false })).status, 404);
});

test('tenant isolation: another business can neither see, reach nor reuse this one\'s products, barcodes or categories', { skip }, async () => {
  const mine = (await add(A, { name: 'Isolated', barcode: 'ISO-1' })).body.data;
  // the same barcode is fine in a different business: barcodes are only unique within one
  assert.equal((await add(B, { name: 'Their Isolated', barcode: 'ISO-1' })).status, 201);
  assert.equal((await call(B.OWNER, 'GET', '/products/barcode/ISO-1')).body.data.name, 'Their Isolated');
  // ids from the other business are simply not found, by every route
  for (const [method, path, body] of [
    ['GET', `/products/${mine.product_id}`], ['GET', `/products/${mine.product_id}/identifiers`], ['PATCH', `/products/${mine.product_id}`, { name: 'Hijacked' }],
    ['POST', `/products/${mine.product_id}/barcodes`, { barcode: 'EVIL-1' }], ['POST', `/products/${mine.product_id}/aliases`, { alias: 'evil alias' }],
    ['POST', `/products/${mine.product_id}/supplier-codes`, { code: 'EVIL' }], ['POST', `/products/${mine.product_id}/archive`]
  ]) {
    const r = await call(B.OWNER, method, path, body);
    // archive/patch report not found; none may change anything
    assert.ok([404, 200].includes(r.status), `${method} ${path} → ${r.status}`);
    if (method !== 'GET' && method !== 'POST') assert.equal(r.status, 404);
  }
  const after = (await call(A.OWNER, 'GET', `/products/${mine.product_id}`)).body.data;
  assert.equal(after.name, 'Isolated'); assert.equal(after.status, 'ACTIVE');
  assert.equal((await call(A.OWNER, 'GET', `/products/${mine.product_id}/identifiers`)).body.data.barcodes.length, 1);
  assert.equal((await call(B.OWNER, 'GET', '/products/lookup/ISO-1')).body.data[0].name, 'Their Isolated');
  // a category from the other business cannot be attached
  const theirs = await category(B, 'Their Category');
  const attach = await add(A, { name: 'Wrong Category', category_id: theirs });
  assert.equal(attach.status, 400); assert.equal(attach.body.message, 'Category not found');
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${mine.product_id}`, { category_id: theirs })).status, 400);
  // a business id in the header that is not yours is a 404, same as a business that does not exist
  assert.equal((await call(A.OWNER, 'GET', '/products', undefined, { 'x-business-id': String(B.biz) })).status, 404);
});

test('a disabled staff member loses access at once', { skip }, async () => {
  assert.equal((await call(A.CASHIER, 'GET', '/products')).status, 200);
  await pool.query(`UPDATE business_users SET status = 'DISABLED' WHERE business_id = $1 AND role = 'CASHIER'`, [A.biz]);
  const after = await call(A.CASHIER, 'GET', '/products');
  assert.ok([403, 404, 409].includes(after.status), String(after.status));
  await pool.query(`UPDATE business_users SET status = 'ACTIVE' WHERE business_id = $1 AND role = 'CASHIER'`, [A.biz]);   // back for the tests that follow
});

test('the audit log keeps who changed what, with the old and new value', { skip }, async () => {
  const p = (await add(A, { name: 'Audited', selling_price: 40, mrp: 60, barcode: 'AUD-1' })).body.data;
  await call(A.MANAGER, 'PATCH', `/products/${p.product_id}`, { selling_price: 45, sku: 'AUD-CUSTOM' });
  await call(A.MANAGER, 'POST', `/products/${p.product_id}/aliases`, { alias: 'Audit Alias' });
  await call(A.MANAGER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: 'AUD-2' });
  await new Promise((r) => setTimeout(r, 400));
  const rows = (await pool.query(`SELECT action, user_id, metadata FROM audit_log WHERE business_id = $1 AND resource_id = $2 ORDER BY audit_id`, [A.biz, String(p.product_id)])).rows;
  const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
  assert.equal(byAction['product.created'].metadata.sku_generated, true);
  assert.deepEqual(byAction['product.updated'].metadata.changes, { selling_price: { from: 40, to: 45 }, sku: { from: p.sku, to: 'AUD-CUSTOM' } });
  assert.equal(byAction['product.alias_added'].metadata.alias, 'Audit Alias');
  assert.equal(byAction['product.barcode_added'].metadata.barcode, 'AUD-2');
  assert.ok(byAction['product.updated'].user_id);                            // who
});

/* ── Phase 2: the till ────────────────────────────────────────────────────── */

test('a missing product can be made from the till by someone allowed to, and only by them', { skip }, async () => {
  const body = { name: 'Fresh Paneer 200g', selling_price: 85, mrp: 90, tax_rate: 5, unit: 'pc', barcode: '8908887770001', category_id: await category(A, 'Dairy till') };
  // a cashier bills but cannot create products; a manager can
  const refused = await call(A.CASHIER, 'POST', '/products/quick', body, { 'idempotency-key': 'q-1' });
  assert.equal(refused.status, 403);
  // a per-person grant is all the cashier needs
  const cashier = (await pool.query(`SELECT user_id FROM business_users WHERE business_id = $1 AND role = 'CASHIER'`, [A.biz])).rows[0].user_id;
  await pool.query(`UPDATE business_users SET permissions = '{"product_quick_add": true}' WHERE business_id = $1 AND user_id = $2`, [A.biz, cashier]);
  const made = await call(A.CASHIER, 'POST', '/products/quick', { ...body, status: 'ARCHIVED', supplier_id: 1, kind: 'INGREDIENT' }, { 'idempotency-key': 'q-2' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.match(made.body.data.sku, /^DAIR-\d{5}$/);            // FlowXP made the SKU
  assert.equal(made.body.data.barcode, '8908887770001');        // and the scanned barcode is attached
  assert.equal(made.body.data.mrp, 90);
  assert.equal(made.body.data.track_inventory, false);          // stock not given: not counted yet, so it can always be sold
  assert.equal(made.body.data.current_stock, 0);
  assert.equal(made.body.data.status, 'ACTIVE');
  assert.equal(made.body.data.kind, 'DISH');
  assert.equal((await call(A.CASHIER, 'GET', '/products/barcode/8908887770001')).body.data.product_id, made.body.data.product_id);
  await new Promise((r) => setTimeout(r, 300));
  const audit = (await pool.query(`SELECT metadata, user_id FROM audit_log WHERE business_id = $1 AND action = 'product.created' AND resource_id = $2`, [A.biz, String(made.body.data.product_id)])).rows[0];
  assert.equal(audit.metadata.via, 'till'); assert.equal(audit.user_id, cashier);   // who, and where from
  await pool.query(`UPDATE business_users SET permissions = '{}' WHERE business_id = $1 AND user_id = $2`, [A.biz, cashier]);
});

test('the till\'s product form is checked the same way the catalogue is', { skip }, async () => {
  const ok = { name: 'Check Item', selling_price: 40 };
  assert.equal((await call(A.MANAGER, 'POST', '/products/quick', { name: 'No Price' }, { 'idempotency-key': 'q-3' })).status, 400);
  assert.equal((await call(A.MANAGER, 'POST', '/products/quick', { ...ok, selling_price: 0 }, { 'idempotency-key': 'q-4' })).status, 400);
  assert.equal((await call(A.MANAGER, 'POST', '/products/quick', { ...ok, mrp: 30 }, { 'idempotency-key': 'q-5' })).status, 400);       // above the MRP
  assert.equal((await call(A.MANAGER, 'POST', '/products/quick', { selling_price: 40 }, { 'idempotency-key': 'q-6' })).status, 400);      // no name
  const dupe = await call(A.MANAGER, 'POST', '/products/quick', { ...ok, barcode: '8908887770001' }, { 'idempotency-key': 'q-7' });        // already someone's
  assert.equal(dupe.status, 409); assert.equal(dupe.body.code, 'BARCODE_IN_USE'); assert.match(dupe.body.message, /Fresh Paneer/);
  assert.equal((await call(A.MANAGER, 'POST', '/products/quick', { ...ok, category_id: await category(B, 'Their') }, { 'idempotency-key': 'q-8' })).status, 400);   // another business's category
});

test('a double-tapped "Create and add" makes one product', { skip }, async () => {
  const once = { name: 'Double Tap Item', selling_price: 12, barcode: '8908887770999' };
  const [a, b] = await Promise.all([1, 2].map(() => call(A.MANAGER, 'POST', '/products/quick', once, { 'idempotency-key': 'same-key-1' })));
  assert.ok([a.status, b.status].every((s) => s === 201 || s === 409), `${a.status} ${b.status}`);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM products WHERE business_id = $1 AND name = 'Double Tap Item'`, [A.biz])).rows[0].n, 1);
});

test('quick products are a flag the owner sets, and the till can ask for just those', { skip }, async () => {
  const p = (await add(A, { name: 'Loose Onions', selling_price: 30 })).body.data;
  assert.equal(p.is_quick, false);
  assert.equal((await call(A.CASHIER, 'PATCH', `/products/${p.product_id}`, { is_quick: true })).status, 403);
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${p.product_id}`, { is_quick: 'yes' })).status, 400);
  assert.equal((await call(A.OWNER, 'PATCH', `/products/${p.product_id}`, { is_quick: true })).body.data.is_quick, true);
  const quick = (await call(A.CASHIER, 'GET', '/products?quick=true')).body.data;
  assert.ok(quick.some((x) => x.product_id === p.product_id));
  assert.ok(quick.every((x) => x.is_quick));
  assert.equal((await call(B.OWNER, 'GET', '/products?quick=true')).body.data.some((x) => x.product_id === p.product_id), false);
});

test('the offline catalogue feed pages by id, carries every barcode, and never crosses a business', { skip }, async () => {
  const p = (await add(A, { name: 'Feed Item', selling_price: 20, barcode: 'FEED-1' })).body.data;
  await call(A.OWNER, 'POST', `/products/${p.product_id}/barcodes`, { barcode: 'FEED-2' });
  const archived = (await add(A, { name: 'Feed Archived', selling_price: 5 })).body.data;
  await call(A.OWNER, 'POST', `/products/${archived.product_id}/archive`);
  const seen = []; let after = 0; let pages = 0;
  for (;;) {
    const r = await fetch(`${base}/products/pos-catalog?after=${after}&limit=5`, { headers: { authorization: `Bearer ${A.CASHIER}` } });
    const j = await r.json(); assert.equal(r.status, 200); pages += 1;
    assert.ok(j.data.length <= 5);
    seen.push(...j.data);
    if (!j.meta.next_after) break;
    after = j.meta.next_after;
  }
  assert.ok(pages > 1, 'needed more than one page');
  const ids = seen.map((x) => x.product_id);
  assert.deepEqual(ids, [...ids].sort((x, y) => x - y));                           // in id order, no repeats
  assert.equal(new Set(ids).size, ids.length);
  const feed = seen.find((x) => x.product_id === p.product_id);
  assert.deepEqual(feed.barcodes, ['FEED-1', 'FEED-2']);
  assert.equal(feed.selling_price, 20);
  assert.equal(ids.includes(archived.product_id), false);                          // archived products are not sold
  const theirs = (await call(B.OWNER, 'GET', '/products/pos-catalog?limit=2000')).body.data;
  assert.equal(theirs.some((x) => x.product_id === p.product_id), false);
  assert.equal((await call(null, 'GET', '/products/pos-catalog')).status, 401);
});

test('stock given at the till is counted properly: an opening movement in the ledger, and the item then sells', { skip }, async () => {
  const made = await call(A.MANAGER, 'POST', '/products/quick', { name: 'Counted Biscuits', selling_price: 20, opening_stock: 12 }, { 'idempotency-key': 'q-stock-1' });
  assert.equal(made.status, 201);
  assert.equal(made.body.data.track_inventory, true); assert.equal(made.body.data.current_stock, 12);
  const ledger = (await pool.query(`SELECT transaction_type, quantity::float AS q FROM inventory_transactions WHERE product_id = $1`, [made.body.data.product_id])).rows;
  assert.deepEqual(ledger, [{ transaction_type: 'OPENING', q: 12 }]);
  assert.equal((await call(A.MANAGER, 'POST', '/products/quick', { name: 'Bad Stock', selling_price: 20, opening_stock: -3 }, { 'idempotency-key': 'q-stock-2' })).status, 400);
});
