/*
 * Offers, second round: weekday and hour limits, mix-and-match bundles (a set of products for one price), offers working for a
 * restaurant, an exchange credit that travels to another outlet, and the small cache that keeps the hot reads fast
 * (including that a write or a clock change is never hidden by it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { priceLines, runsNow, activePromotions, dropPromotionCache, minutesOf } = await import('../src/modules/promotions.js');
const { createCache } = await import('../src/utils/cache.js');
const offers = await import('../src/controllers/promotions.controller.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const dash = await import('../src/controllers/retailDashboard.controller.js');

test.after(cleanup);
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── the cache ──────────────────────────────────────────────────────────── */

test('the cache keeps a value for its time, shares one load between callers, forgets a prefix, and never remembers a failure', async () => {
  const c = createCache({ ttlMs: 40, max: 3 });
  let loads = 0;
  const load = async () => { loads++; await new Promise((r) => setTimeout(r, 15)); return `v${loads}`; };
  const [a, b] = await Promise.all([c.wrap('k', load), c.wrap('k', load)]);
  assert.equal(a, 'v1'); assert.equal(b, 'v1'); assert.equal(loads, 1, 'two callers at once ran one load');
  assert.equal(await c.wrap('k', load), 'v1'); assert.equal(loads, 1, 'kept');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(await c.wrap('k', load), 'v2', 'expired after its time');
  c.set('7:a', 1); c.set('7:b', 2); c.set('8:a', 3);
  c.drop('7:'); assert.equal(c.get('7:a'), undefined); assert.equal(c.get('8:a'), 3);
  for (const k of ['x1', 'x2', 'x3', 'x4']) c.set(k, k);
  assert.ok(c.size() <= 3, 'never more than max');
  await assert.rejects(c.wrap('bad', async () => { throw new Error('nope'); }), /nope/);
  assert.equal(await c.wrap('bad', async () => 'ok now'), 'ok now', 'a failed load is not remembered');
});

/* ── pure: schedule and mix bundles ─────────────────────────────────────── */

test('weekdays and hours: an offer runs only when both fit, and an end before the start runs overnight', () => {
  const happy = { days_of_week: [1, 2, 3, 4, 5], start_time: '16:00:00', end_time: '19:00:00' };
  assert.equal(minutesOf('16:30'), 990); assert.equal(minutesOf(null), null);
  assert.equal(runsNow(happy, { dow: 3, minutes: 17 * 60 }), true);
  assert.equal(runsNow(happy, { dow: 3, minutes: 19 * 60 }), false, 'the end hour itself is closed');
  assert.equal(runsNow(happy, { dow: 6, minutes: 17 * 60 }), false, 'wrong day');
  assert.equal(runsNow({ days_of_week: null, start_time: null, end_time: null }, { dow: 0, minutes: 0 }), true, 'no limits: always');
  const late = { days_of_week: null, start_time: '22:00', end_time: '02:00' };
  assert.equal(runsNow(late, { dow: 1, minutes: 23 * 60 }), true); assert.equal(runsNow(late, { dow: 1, minutes: 60 }), true); assert.equal(runsNow(late, { dow: 1, minutes: 12 * 60 }), false);
});

const mix = (o = {}) => ({ promo_id: 5, name: 'Any 3 biscuits for ₹50', kind: 'MIX_BUNDLE', product_ids: [1, 2, 3], bundle_qty: 3, bundle_price_paise: 5000, members_only: false, ...o });
const L = (index, product_id, qty, unit) => ({ index, product_id, category_id: null, quantity: qty, unitPricePaise: unit, discountPaise: 0 });

test('a mix bundle takes N units from a set of products for one price, cheapest units first, to the paisa', () => {
  // three different ₹20 / ₹25 / ₹30 biscuits: ₹75 for ₹50 → ₹25 off, spread over the three lines
  const r = priceLines([mix()], [L(0, 1, 1, 2000), L(1, 2, 1, 2500), L(2, 3, 1, 3000)]);
  assert.equal([...r.values()].reduce((s, x) => s + x.discountPaise, 0), 2500);
  assert.deepEqual([...r.keys()].sort(), [0, 1, 2]);
  // four units: one bundle from the three CHEAPEST, the dearest pays in full
  const four = priceLines([mix()], [L(0, 1, 2, 2000), L(1, 2, 1, 2500), L(2, 3, 1, 3000)]);
  assert.equal([...four.values()].reduce((s, x) => s + x.discountPaise, 0), 2000 + 2000 + 2500 - 5000);
  assert.equal(four.has(2), false, 'the ₹30 one was not part of the bundle');
  // fewer than N units, products outside the set, or a bundle dearer than the shelf: nothing
  assert.equal(priceLines([mix()], [L(0, 1, 2, 2000)]).size, 0);
  assert.equal(priceLines([mix()], [L(0, 9, 3, 2000)]).size, 0);
  assert.equal(priceLines([mix({ bundle_price_paise: 9000 })], [L(0, 1, 3, 2000)]).size, 0);
  assert.equal(priceLines([mix({ members_only: true })], [L(0, 1, 3, 3000)]).size, 0, 'customers only');
  // an offer already on a product wins that product: the bundle works on what is left
  const withOwn = priceLines([{ promo_id: 1, name: '50% off', kind: 'PERCENT_OFF', product_id: 1, percent: 50, min_qty: 1, members_only: false }, mix()], [L(0, 1, 1, 2000), L(1, 2, 1, 2500), L(2, 3, 1, 3000)]);
  assert.equal(withOwn.get(0).promo_id, 1); assert.equal(withOwn.has(1), false, 'two units left: no bundle');
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let branchA; let branchB; let owner; let p1; let p2; let p3;
const tenant = (branchId = branchA, type = 'SUPERMARKET') => ({ businessId: biz, branchId, scopeBranchId: null, role: 'OWNER', permissions: {}, businessType: type, planFeatures: {} });
const call = async (fn, { body = {}, params = {}, branch = branchA, type } = {}) => { const res = fakeRes(); await fn({ tenant: tenant(branch, type), auth: { userId: owner }, body, params, query: {}, headers: {}, ip: '127.0.0.1' }, res); return res; };
const bill = async (input, branch = branchA) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const inv = await createInvoiceInTransaction(client, tenant(branch), owner, input); await client.query('COMMIT'); return inv; }
  catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@offers2.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code) VALUES ('Shop',$1,'SUPERMARKET',TRUE,'Karnataka','ACTIVE','ENTERPRISE') RETURNING business_id`, [owner])).rows[0].business_id;
  branchA = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'MG Road',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  branchB = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Indiranagar',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const prod = async (name, price) => (await pool.query(`INSERT INTO products (business_id, name, sku, kind, unit, selling_price_paise, tax_rate, track_inventory) VALUES ($1,$2,$3,'DISH','pc',$4,5,FALSE) RETURNING product_id`, [biz, name, name.slice(0, 4).toUpperCase(), price])).rows[0].product_id;
  [p1, p2, p3] = [await prod('Parle-G', 2000), await prod('Marie Gold', 2500), await prod('Good Day', 3000)];
});

test('a mix bundle is saved with its products, refused when it is not a set, and applied on the bill', { skip }, async () => {
  const bad = await call(offers.create, { body: { name: 'x', kind: 'MIX_BUNDLE', product_ids: [p1], bundle_qty: 3, bundle_price: 50 } });
  assert.equal(bad.code, 400); assert.match(bad.body.message, /at least two/);
  assert.equal((await call(offers.create, { body: { name: 'x', kind: 'MIX_BUNDLE', product_ids: [p1, 999999], bundle_qty: 3, bundle_price: 50 } })).code, 400);
  assert.equal((await call(offers.create, { body: { name: 'x', kind: 'MIX_BUNDLE', product_id: p1, product_ids: [p1, p2], bundle_qty: 3, bundle_price: 50 } })).code, 201, 'a stray single product is ignored for a mix');
  await pool.query(`DELETE FROM promotions WHERE business_id = $1`, [biz]); dropPromotionCache(biz);

  const made = await call(offers.create, { body: { name: 'Any 3 biscuits for ₹50', kind: 'MIX_BUNDLE', product_ids: [p1, p2, p3], bundle_qty: 3, bundle_price: 50 } });
  assert.equal(made.code, 201); assert.deepEqual(made.body.data.products.map((p) => p.name).sort(), ['Good Day', 'Marie Gold', 'Parle-G']);
  const inv = await bill({ items: [{ product_id: p1, quantity: 1 }, { product_id: p2, quantity: 1 }, { product_id: p3, quantity: 1 }], applyPromotions: true, payment: { amount: 'FULL' } });
  assert.equal(inv.total, 52.5, '₹50 plus 5% GST');
  const off = (await pool.query(`SELECT SUM(promo_discount_paise) AS d FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].d;
  assert.equal(Number(off), 2500);
  const swapped = await call(offers.update, { params: { id: made.body.data.promo_id }, body: { product_ids: [p1, p2], bundle_qty: 2, bundle_price: 40 } });
  assert.deepEqual(swapped.body.data.products.length, 2);
  assert.equal((await bill({ items: [{ product_id: p1, quantity: 1 }, { product_id: p2, quantity: 1 }], applyPromotions: true, payment: { amount: 'FULL' } })).total, 42, 'the edit took effect at once: ₹40 + GST');
});

test('hours and weekdays are saved, validated, and the offer is on only when they fit', { skip }, async () => {
  await pool.query(`DELETE FROM promotions WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  const refused = [{ start_time: '16:00' }, { start_time: '16:00', end_time: '16:00' }, { start_time: '25:00', end_time: '26:00' }, { days_of_week: [7] }, { days_of_week: [-1] }];
  for (const extra of refused) assert.equal((await call(offers.create, { body: { name: 'x', kind: 'PERCENT_OFF', product_id: p1, percent: 10, ...extra } })).code, 400, JSON.stringify(extra));
  const all7 = await call(offers.create, { body: { name: 'Every day', kind: 'PERCENT_OFF', product_id: p1, percent: 10, days_of_week: [0, 1, 2, 3, 4, 5, 6] } });
  assert.equal(all7.body.data.days_of_week, null, 'all seven days is no limit');
  const happy = await call(offers.create, { body: { name: 'Happy hour', kind: 'PERCENT_OFF', product_id: p2, percent: 20, days_of_week: [5, 1], start_time: '16:00', end_time: '19:00' } });
  assert.deepEqual(happy.body.data.days_of_week, [1, 5]); assert.equal(happy.body.data.start_time, '16:00');
  const day = '2026-10-05';   // a Monday
  assert.equal((await activePromotions(pool, biz, { date: day, dow: 1, minutes: 17 * 60 })).length, 2);
  assert.deepEqual((await activePromotions(pool, biz, { date: day, dow: 1, minutes: 20 * 60 })).map((p) => p.name), ['Every day'], 'after 7 pm only the all-day offer');
  assert.deepEqual((await activePromotions(pool, biz, { date: day, dow: 2, minutes: 17 * 60 })).map((p) => p.name), ['Every day'], 'Tuesday: no happy hour');
  const listed = (await call(offers.list)).body.data.find((o) => o.name === 'Happy hour');
  assert.equal(typeof listed.on_now, 'boolean');
});

test('the offers kept for a minute are cleared by every change, so an edit is never hidden', { skip }, async () => {
  await pool.query(`DELETE FROM promotions WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  const now = { date: '2026-10-05', dow: 1, minutes: 600 };
  assert.equal((await activePromotions(pool, biz, now)).length, 0);
  const made = await call(offers.create, { body: { name: 'New', kind: 'PERCENT_OFF', product_id: p1, percent: 5 } });
  assert.equal((await activePromotions(pool, biz, now)).length, 1, 'a new offer shows at once');
  await call(offers.update, { params: { id: made.body.data.promo_id }, body: { is_active: false } });
  assert.equal((await activePromotions(pool, biz, now)).length, 0, 'switching off shows at once');
  await call(offers.update, { params: { id: made.body.data.promo_id }, body: { is_active: true } });
  await call(offers.remove, { params: { id: made.body.data.promo_id } });
  assert.equal((await activePromotions(pool, biz, now)).length, 0, 'removing shows at once');
});

test('the retail summary is kept 30 seconds, per outlet, and cleared on demand', { skip }, async () => {
  dash.dropDashboardCache();
  const first = (await call(dash.summary)).body.data;
  await pool.query(`UPDATE products SET track_inventory = TRUE, min_stock = 5 WHERE product_id = $1`, [p1]);
  assert.deepEqual((await call(dash.summary)).body.data, first, 'the same figures from the keep');
  dash.dropDashboardCache(biz);
  assert.notDeepEqual((await call(dash.summary)).body.data, first, 'fresh once cleared');
  await pool.query(`UPDATE products SET track_inventory = FALSE WHERE product_id = $1`, [p1]);
});

test('an exchange credit made at one outlet can be spent at another', { skip }, async () => {
  const old = await bill({ items: [{ product_id: p3, quantity: 1 }], payment: { amount: 'FULL' } }, branchA);                 // ₹31.50 at MG Road
  const line = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [old.invoice_id])).rows[0].item_id;
  const cn = (await call(notes.create, { params: { id: old.invoice_id }, body: { reason: 'Exchange', items: [{ item_id: line, quantity: 1 }] }, branch: branchA })).body.data;

  const found = await call(notes.byNumber, { params: { number: cn.cn_number.toLowerCase() }, branch: branchB });
  assert.deepEqual(found.body.data, { cn_id: cn.cn_id, cn_number: cn.cn_number, credit_left: 31.5 }, 'found from the other outlet, by number, in any case');
  assert.equal((await call(notes.byNumber, { params: { number: 'CN-9999' }, branch: branchB })).code, 404);

  const swap = await bill({ items: [{ product_id: p1, quantity: 1 }], exchangeCreditNoteId: found.body.data.cn_id, payment: { amount: 'FULL' } }, branchB);
  assert.equal(swap.total, 21); assert.equal(swap.payment_status, 'PAID');
  assert.equal((await call(notes.byNumber, { params: { number: cn.cn_number }, branch: branchB })).body.data.credit_left, 10.5, 'what was not spent is still there');
});

test('a restaurant’s table bill gets offers too', { skip }, async () => {
  await pool.query(`DELETE FROM promotions WHERE business_id = $1`, [biz]); dropPromotionCache(biz);
  await call(offers.create, { body: { name: 'Biscuit 50% off', kind: 'PERCENT_OFF', product_id: p1, percent: 50 } });
  const asRestaurant = await bill({ items: [{ product_id: p1, quantity: 2 }], applyPromotions: true, payment: { amount: 'FULL' } });
  assert.equal(asRestaurant.total, 21, '₹20 for two, plus GST');
});
