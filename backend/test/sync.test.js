/*
 * The backend half of the mobile app (MOBILE.md, phase 0): a sale replayed with its Idempotency-Key is the same invoice even
 * after the 48-hour key table has forgotten it or when two copies arrive at once, an offline sale is recorded rather than
 * refused for stock, the app can slide its Bearer token forward, and the change log hands a phone only what changed for its
 * own business and outlet (collapsed, paged, with a resync when it has been away too long).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const sync = await import('../src/controllers/sync.controller.js');
const auth = await import('../src/controllers/auth.controller.js');
const { moveStock } = await import('../src/modules/stock.js');

test.after(cleanup);
const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; }, cookie() { return this; } });

let owner; let biz; let branchA; let branchB; let other; let otherBranch; let shirt; let tracked;
const tenant = (b = biz, branchId = branchA) => ({ businessId: b, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {}, businessType: 'SUPERMARKET', planFeatures: {}, currency: 'INR' });
const req = (extra = {}) => {
  const headers = Object.fromEntries(Object.entries(extra.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { tenant: tenant(), auth: { userId: owner }, body: {}, params: {}, query: {}, ip: '127.0.0.1', ...extra, headers, get: (h) => headers[h.toLowerCase()] };
};
const run = async (fn, r) => { const res = fakeRes(); await fn(r, res); return res; };
const sell = (key, body, t = tenant()) => run(invoices.create, req({ tenant: t, headers: key ? { 'Idempotency-Key': key } : {}, body }));
const changes = async (since, { limit, t = tenant() } = {}) => run(sync.changes, req({ tenant: t, query: { since: String(since), ...(limit ? { limit: String(limit) } : {}) } }));
const head = async (t = tenant()) => (await run(sync.getHead, req({ tenant: t }))).body.data.head;
const stockMove = async (branchId, productId, delta) => { const c = await pool.connect(); try { await moveStock(c, { businessId: biz, branchId, productId, delta }); } finally { c.release(); } };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@sync.test','x') RETURNING user_id`)).rows[0].user_id;
  const mk = async (name) => {
    const b = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code) VALUES ($1,$2,'SUPERMARKET',TRUE,'Karnataka','ACTIVE','ENTERPRISE') RETURNING business_id`, [name, owner])).rows[0].business_id;
    const a = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [b])).rows[0].branch_id;
    return [b, a];
  };
  [biz, branchA] = await mk('Shop');
  branchB = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Second',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  [other, otherBranch] = await mk('Other');
  const prod = async (name, track) => (await pool.query(`INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory) VALUES ($1,$2,$3,'DISH','pc',10000,5,$4) RETURNING product_id`, [biz, name, name.toUpperCase().slice(0, 5), track])).rows[0].product_id;
  shirt = await prod('Shirt', false);
  tracked = await prod('Tracked tin', true);
});

test('a sale replayed with its key is the same invoice, even after the 48-hour key table has forgotten it', { skip }, async () => {
  const body = { items: [{ product_id: shirt, quantity: 2 }], payment: { amount: 'FULL' } };
  const first = await sell('sale-0001', body);
  assert.equal(first.code, 201);
  await pool.query(`DELETE FROM idempotency_keys`);               // 48 hours later
  const again = await sell('sale-0001', body);
  assert.equal(again.code, 201); assert.equal(again.headers['Idempotent-Replay'], 'true');
  assert.equal(again.body.data.invoice_number, first.body.data.invoice_number);
  assert.equal(again.body.data.invoice_id, first.body.data.invoice_id);
  assert.equal(again.body.data.payments_taken.length, 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM invoices WHERE business_id = $1 AND client_key = 'sale-0001'`, [biz])).rows[0].count), 1);
  // a different business may use the same key for its own sale
  const theirs = await sell('sale-0001', { items: [{ description: 'Thing', unit_price: 50, quantity: 1 }], payment: { amount: 'FULL' } }, tenant(other, otherBranch));
  assert.equal(theirs.code, 201); assert.notEqual(theirs.body.data.invoice_id, first.body.data.invoice_id);
});

test('two copies of one sale arriving at once make one invoice', { skip }, async () => {
  const body = { items: [{ product_id: shirt, quantity: 1 }], payment: { amount: 'FULL' } };
  const [a, b] = await Promise.all([sell('sale-race', body), sell('sale-race', body)]);
  assert.deepEqual([a.code, b.code], [201, 201]);
  assert.equal(a.body.data.invoice_id, b.body.data.invoice_id);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM invoices WHERE business_id = $1 AND client_key = 'sale-race'`, [biz])).rows[0].count), 1);
});

test('an offline sale is recorded even when stock is short; an ordinary one is still refused', { skip }, async () => {
  await stockMove(branchA, tracked, 1);
  const items = [{ product_id: tracked, quantity: 3 }];
  const refused = await sell('sale-short', { items, payment: { amount: 'FULL' } });
  assert.equal(refused.code, 409); assert.match(refused.body.message, /Not enough stock/);
  const kept = await sell('sale-offline', { items, payment: { amount: 'FULL' }, offline: true });
  assert.equal(kept.code, 201);
  const left = Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branchA, tracked])).rows[0].quantity);
  assert.equal(left, -2, 'the shelf shows the shortfall');
});

test('an offline sale keeps the day it was taken within a week; a wrong phone clock is dated today', { skip }, async () => {
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  const dated = async (key, d) => (await pool.query(`SELECT invoice_date::text AS d FROM invoices WHERE client_key = $1`, [(await sell(key, { items: [{ product_id: shirt, quantity: 1 }], payment: { amount: 'FULL' }, offline: true, invoice_date: d })).code === 201 ? key : 'x'])).rows[0].d;
  const today = (await pool.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0].d;
  assert.equal(await dated('d-3', day(3)), day(3), 'three days ago is believed');
  assert.equal(await dated('d-30', day(30)), today, 'a month ago is a wrong clock');
  assert.equal(await dated('d-future', day(-30)), today, 'a month ahead is a wrong clock');
  assert.equal(await dated('d-junk', 'yesterday'), today);
});

test('the offline marks can ride in headers, so the retry body matches the first attempt', { skip }, async () => {
  const body = { items: [{ product_id: tracked, quantity: 50 }], payment: { amount: 'FULL' } };
  const sent = await run(invoices.create, req({ headers: { 'Idempotency-Key': 'h-1', 'X-Offline-Sale': '1', 'X-Sale-Date': new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }, body }));
  assert.equal(sent.code, 201, 'short of stock but offline by header');
  assert.equal((await pool.query(`SELECT (CURRENT_DATE - invoice_date) AS age FROM invoices WHERE client_key = 'h-1'`)).rows[0].age >= 1, true);
});

test('a sale from a café till goes to the kitchen with a token; the same sale taken offline is billed only', { skip }, async () => {
  const cafe = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code) VALUES ('Cafe',$1,'CAFE',TRUE,'Karnataka','ACTIVE','ENTERPRISE') RETURNING business_id`, [owner])).rows[0].business_id;
  const cb = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [cafe])).rows[0].branch_id;
  const latte = (await pool.query(`INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Latte','LAT','DISH','pc',16000,5,FALSE) RETURNING product_id`, [cafe])).rows[0].product_id;
  const t = { ...tenant(cafe, cb), businessType: 'CAFE' };
  const body = { items: [{ product_id: latte, quantity: 1 }], payment: { amount: 'FULL' }, send_to_kitchen: true };
  const live = await sell('c-live', body, t);
  assert.equal(live.code, 201); assert.match(live.body.data.order.order_number, /\d/, 'the token to call out');
  const late = await run(invoices.create, req({ tenant: t, headers: { 'Idempotency-Key': 'c-late', 'X-Offline-Sale': '1' }, body }));
  assert.equal(late.code, 201); assert.equal(late.body.data.order, undefined, 'no kitchen ticket for an offline sale');
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM orders WHERE business_id = $1`, [cafe])).rows[0].count), 1);
});

test('/auth/me hands a Bearer caller a fresh token, and a cookie caller none', { skip }, async () => {
  const user = { user_id: owner, name: 'o', email: 'o@sync.test', token_version: 0 };
  const viaHeader = await run(auth.me, { authVia: 'header', auth: { user }, memberships: [] });
  assert.ok(viaHeader.body.data.token);
  const viaCookie = await run(auth.me, { authVia: 'cookie', auth: { user }, memberships: [] });
  assert.equal(viaCookie.body.data.token, undefined);
});

test('the change log: what changed arrives once, as its current row; archived things arrive as deletes', { skip }, async () => {
  const start = await head();
  const { rows: [p] } = await pool.query(`INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Cap','CAP1','DISH','pc',9900,5,FALSE) RETURNING product_id`, [biz]);
  await pool.query(`UPDATE products SET selling_price_paise = 12000 WHERE product_id = $1`, [p.product_id]);
  await pool.query(`INSERT INTO product_barcodes (business_id, product_id, barcode) VALUES ($1,$2,'8901234567890')`, [biz, p.product_id]);
  const got = await changes(start);
  assert.equal(got.code, 200);
  const caps = got.body.data.changes.filter((c) => c.entity === 'product' && c.id === p.product_id);
  assert.equal(caps.length, 1, 'three changes, one row');
  assert.equal(caps[0].op, 'upsert'); assert.equal(caps[0].row.selling_price, 120); assert.deepEqual(caps[0].row.barcodes, ['8901234567890']);
  assert.equal(got.body.data.has_more, false); assert.ok(got.body.data.next > start);

  await pool.query(`UPDATE products SET status = 'ARCHIVED' WHERE product_id = $1`, [p.product_id]);
  const gone = (await changes(got.body.data.next)).body.data.changes.find((c) => c.id === p.product_id);
  assert.deepEqual(gone, { entity: 'product', op: 'delete', id: p.product_id });

  // asked again from the new position there is nothing new, and the position never goes backwards
  const quiet = (await changes(got.body.data.next + 0)).body.data;
  assert.ok(quiet.next >= got.body.data.next);
});

test('the option groups a product offers travel with it, and changing them counts as a change to the product', { skip }, async () => {
  const group = (await pool.query(`INSERT INTO modifier_groups (business_id, name, is_variant, min_select, max_select) VALUES ($1,'Size',TRUE,1,1) RETURNING group_id`, [biz])).rows[0].group_id;
  const start = await head();
  await pool.query(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2)`, [shirt, group]);
  const got = (await changes(start)).body.data.changes.find((c) => c.entity === 'product' && c.id === shirt);
  assert.deepEqual(got.row.modifier_group_ids, [group]);
  const next = await head();
  await pool.query(`DELETE FROM product_modifier_groups WHERE product_id = $1`, [shirt]);
  assert.deepEqual((await changes(next)).body.data.changes.find((c) => c.id === shirt).row.modifier_group_ids, []);
});

test('customers and categories travel too; a customer who is archived is removed from the phone', { skip }, async () => {
  const start = await head();
  const cat = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Shirts') RETURNING category_id`, [biz])).rows[0].category_id;
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Asha','9876543210') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const got = (await changes(start)).body.data;
  assert.equal(got.changes.find((c) => c.entity === 'category' && c.id === cat).row.name, 'Shirts');
  assert.equal(got.changes.find((c) => c.entity === 'customer' && c.id === cust).row.phone, '9876543210');
  await pool.query(`UPDATE customers SET status = 'ARCHIVED' WHERE customer_id = $1`, [cust]);
  const next = (await changes(got.next)).body.data.changes.find((c) => c.entity === 'customer' && c.id === cust);
  assert.equal(next.op, 'delete');
});

test('an outlet keeps its own stock figure; another business hears nothing', { skip }, async () => {
  const start = await head(); const startB = await head(tenant(biz, branchB)); const startOther = await head(tenant(other, otherBranch));
  await stockMove(branchB, shirt, 5);
  // the shared product row moved, so outlet A hears about the shirt, but the stock it is shown is its own (none), not B's five
  const a = (await changes(start)).body.data.changes.find((x) => x.id === shirt);
  assert.equal(a.row.current_stock, 0);
  const b = (await changes(startB, { t: tenant(biz, branchB) })).body.data.changes.find((x) => x.id === shirt);
  assert.equal(b.row.current_stock, 5);
  assert.equal((await changes(startOther, { t: tenant(other, otherBranch) })).body.data.changes.length, 0, 'another business hears nothing');
});

test('an outlet stock change that touches only that outlet is not sent to the other outlet', { skip }, async () => {
  const startA = await head();
  // write outlet B's stock row directly, without touching the shared product row
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,7) ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = 7`, [branchB, tracked]);
  assert.equal((await changes(startA)).body.data.changes.filter((x) => x.id === tracked).length, 0, 'outlet A is not told about outlet B\'s shelf');
});

test('paging: has_more and next walk through a long log without losing a change', { skip }, async () => {
  const start = await head();
  for (let i = 0; i < 5; i++) await pool.query(`INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory) VALUES ($1,$2,$3,'DISH','pc',100,5,FALSE)`, [biz, `Item ${i}`, `ITM${i}`]);
  let since = start; const seen = new Set(); let pages = 0;
  for (;;) {
    const r = (await changes(since, { limit: 2 })).body.data; pages++;
    r.changes.forEach((c) => seen.add(c.row?.name));
    since = r.next; if (!r.has_more) break;
    assert.ok(pages < 20);
  }
  for (let i = 0; i < 5; i++) assert.ok(seen.has(`Item ${i}`), `Item ${i} arrived`);
  assert.ok(pages >= 3);
});

test('away too long (or from a different database) means resync, not a silent gap', { skip }, async () => {
  const now = await head();
  await pool.query(`UPDATE sync_state SET floor_seq = $1`, [now + 10]);
  const old = await changes(now);
  assert.equal(old.code, 409); assert.equal(old.body.code, 'RESYNC'); assert.ok(old.body.data.head >= now + 10, 'it says where to start again from');
  assert.equal((await changes(old.body.data.head)).code, 200, 'from there it works');
  assert.equal((await changes(old.body.data.head + 1000)).code, 409, 'a position the log never reached');
  assert.equal((await changes(-1)).code, 400); assert.equal((await run(sync.changes, req({ query: {} }))).code, 400);
});
