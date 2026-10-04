/*
 * Schemes and free quantity, distributor pricing.
 *
 * Buy-X-get-Y, quantity and value discounts; who is eligible (dates, retailers, territories, customer types); best
 * scheme wins unless stackable; free goods are real stock and real cost but earn nothing; the right price is picked
 * by the configured rules, including territory prices.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, dayFromNow, invoiceRow, makeInvoice, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const schemes = (await import('../src/controllers/distributorSchemes.controller.js')).default;
const territories = (await import('../src/controllers/distributorTerritories.controller.js')).default;
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const catalog = (await import('../src/controllers/wholesaleCatalog.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const { priceOne } = await import('../src/modules/wholesale/pricing.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const dist = (tag) => makeWholesaler(pool, tag, { type: 'DISTRIBUTOR' });
const scheme = async (w, body) => { const r = await w.call(schemes.create, { body }); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
const draft = async (w, customer, lines, extra = {}) => { const r = await w.call(orders.create, { body: { customer_id: customer, lines, ...extra } }); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };
const freeOf = (o) => o.items.filter((i) => i.is_free);
const paidOf = (o) => o.items.filter((i) => !i.is_free);

t('buy 10 cartons, get 1 carton free: repeats for every ten, free is its own ₹0 line, stock and cost are real', async () => {
  const w = await dist('s1');
  const p = await addProduct(pool, w, { name: 'Parle-G', unit: 'pcs', price: 10, cost: 7, tax: 0, stock: 10000, units: [{ name: 'carton', factor: 100 }] });
  const c = await addCustomer(pool, w, { name: 'Retailer' });
  const s = await scheme(w, { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_unit_name: 'carton', buy_min_qty: 10, free_qty: 1, free_unit_name: 'carton' });
  assert.equal(s.description, 'Buy 10 carton of Parle-G, get 1 carton of Parle-G free (for every multiple)');
  const o = await draft(w, c, [{ product_id: p, unit_name: 'carton', quantity: 25 }]);
  assert.equal(paidOf(o).length, 1); assert.equal(freeOf(o).length, 1);
  assert.equal(freeOf(o)[0].quantity, 2); assert.equal(freeOf(o)[0].base_qty, 200); assert.equal(freeOf(o)[0].price, 0); assert.equal(freeOf(o)[0].scheme_id, s.scheme_id);
  assert.equal(o.total, 25 * 1000, 'the customer pays for 25 cartons only');
  assert.equal(o.schemes[0].name, 'Buy 10 get 1'); assert.equal(o.schemes[0].free_base, 200);
  // the 27 cartons are reserved, picked and dispatched; stock falls by 2,700 pieces
  const made = await makeInvoice(w, { customer: c, lines: [{ product_id: p, unit_name: 'carton', quantity: 25 }] });
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 10000 - 2700);
  assert.equal(made.invoiceTotal, 25000);
  const lines = (await pool.query(`SELECT quantity, unit_price_paise, line_total_paise, unit_cost_paise, unit_factor FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [made.invoiceId])).rows;
  assert.equal(lines.length, 2); assert.equal(Number(lines[1].quantity), 2); assert.equal(Number(lines[1].unit_price_paise), 0); assert.equal(Number(lines[1].line_total_paise), 0);
  assert.equal(Number(lines[1].unit_cost_paise), 7 * 100 * 100, 'free goods carry their cost');
  // paid and free quantity are told apart: 2,500 sold, 200 free; the free cartons cost ₹1,400 and earn nothing
  const { FACTS } = await import('../src/modules/distributor/facts.js');
  const f = (await pool.query(`SELECT SUM(units) FILTER (WHERE paid) AS paid_units, SUM(units) FILTER (WHERE NOT paid) AS free_units, SUM(revenue) AS revenue, SUM(cost) AS cost FROM ${FACTS} WHERE f.business_id = $1`, [w.businessId])).rows[0];
  assert.equal(Number(f.paid_units), 2500); assert.equal(Number(f.free_units), 200); assert.equal(Number(f.revenue), 2500000); assert.equal(Number(f.cost), 2700 * 700);
});

t('a scheme can be once-only, capped, or give a different product free', async () => {
  const w = await dist('s2');
  const a = await addProduct(pool, w, { name: 'Product A', price: 100, cost: 60, tax: 0, stock: 1000 });
  const b = await addProduct(pool, w, { name: 'Product B', price: 40, cost: 25, tax: 0, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'R' });
  const once = await scheme(w, { name: 'Once', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: a, buy_min_qty: 10, free_qty: 1, repeat: false });
  let o = await draft(w, c, [{ product_id: a, quantity: 35 }]);
  assert.equal(freeOf(o)[0].quantity, 1, 'once only');
  await w.call(schemes.update, { params: { id: once.scheme_id }, body: { repeat: true, max_free_qty: 2 } });
  o = await draft(w, c, [{ product_id: a, quantity: 55 }]);
  assert.equal(freeOf(o)[0].quantity, 2, 'five multiples but capped at two');
  await w.call(schemes.update, { params: { id: once.scheme_id }, body: { is_active: false } });
  // buy product A, get product B free
  await scheme(w, { name: 'A gets B', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: a, buy_min_qty: 5, free_qty: 3, free_product_id: b });
  o = await draft(w, c, [{ product_id: a, quantity: 12 }]);
  assert.equal(freeOf(o).length, 1); assert.equal(freeOf(o)[0].product_id, b); assert.equal(freeOf(o)[0].quantity, 6, 'two multiples of 5 → 2 × 3');
  assert.equal(o.total, 1200);
  assert.equal((await draft(w, c, [{ product_id: a, quantity: 4 }])).items.filter((i) => i.is_free).length, 0, 'below the threshold: nothing');
  // a brand scheme counts every product of the brand
  const brand = (await pool.query(`INSERT INTO brands (business_id, name) VALUES ($1,'BrandX') RETURNING brand_id`, [w.businessId])).rows[0].brand_id;
  const x1 = await addProduct(pool, w, { name: 'X1', price: 10, tax: 0, stock: 1000 }); const x2 = await addProduct(pool, w, { name: 'X2', price: 20, tax: 0, stock: 1000 });
  await pool.query(`UPDATE products SET brand_id = $2 WHERE product_id = ANY($1::int[])`, [[x1, x2], brand]);
  await scheme(w, { name: 'Brand 50', kind: 'BUY_X_GET_Y', buy_scope: 'BRAND', buy_scope_id: brand, buy_min_qty: 50, free_qty: 5, free_product_id: x1 });
  o = await draft(w, c, [{ product_id: x1, quantity: 30 }, { product_id: x2, quantity: 25 }]);
  assert.equal(freeOf(o)[0].quantity, 5); assert.equal(freeOf(o)[0].product_id, x1);
});

t('quantity discount and value discount', async () => {
  const w = await dist('s3');
  const p = await addProduct(pool, w, { name: 'Oil', price: 100, cost: 70, tax: 0, stock: 5000 });
  const c = await addCustomer(pool, w, { name: 'R' });
  await scheme(w, { name: '100+ gets 5%', kind: 'QTY_DISCOUNT', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 100, discount_pct: 5 });
  let o = await draft(w, c, [{ product_id: p, quantity: 99 }]);
  assert.equal(o.items[0].discount_pct, 0); assert.equal(o.total, 9900);
  o = await draft(w, c, [{ product_id: p, quantity: 100 }]);
  assert.equal(o.items[0].discount_pct, 5); assert.equal(o.total, 9500);
  // order above ₹50,000 gets ₹2,000 off
  await scheme(w, { name: 'Big order', kind: 'VALUE_DISCOUNT', min_value: 50000, discount: 2000 });
  o = await draft(w, c, [{ product_id: p, quantity: 400 }]);       // 400 × 100 × 0.95 = 38,000 — under ₹50,000
  assert.equal(o.scheme_discount, 0); assert.equal(o.total, 38000);
  o = await draft(w, c, [{ product_id: p, quantity: 600 }]);       // 57,000 after the 5% → over
  assert.equal(o.scheme_discount, 2000); assert.equal(o.total, 55000);
  assert.equal(o.schemes.length, 2);
  // the manual discount and the scheme discount stay apart, and survive an edit
  const edited = await w.call(orders.update, { params: { id: o.order_id }, body: { discount: 500, lines: [{ product_id: p, quantity: 600 }] } });
  assert.equal(edited.code, 200, JSON.stringify(edited.body)); assert.equal(edited.body.data.discount, 500); assert.equal(edited.body.data.scheme_discount, 2000); assert.equal(edited.body.data.total, 54500);
  const headerOnly = await w.call(orders.update, { params: { id: o.order_id }, body: { notes: 'call before delivery' } });
  assert.equal(headerOnly.body.data.total, 54500); assert.equal(headerOnly.body.data.scheme_discount, 2000);
  // a percentage value discount
  const pct = await dist('s3b');
  const q = await addProduct(pool, pct, { name: 'Q', price: 100, tax: 0, stock: 5000 });
  const c2 = await addCustomer(pool, pct, { name: 'R' });
  await scheme(pct, { name: '5% over 10k', kind: 'VALUE_DISCOUNT', min_value: 10000, discount_pct: 5 });
  assert.equal((await draft(pct, c2, [{ product_id: q, quantity: 120 }])).total, 11400);
});

t('GST is worked out on what the customer pays, and free goods add none', async () => {
  const w = await dist('s4');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 18, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'R' });
  await scheme(w, { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 });
  const o = await draft(w, c, [{ product_id: p, quantity: 20 }]);
  assert.equal(o.subtotal, 2000); assert.equal(o.tax, 360); assert.equal(o.total, 2360);
  assert.equal(freeOf(o)[0].quantity, 2);
});

t('eligibility: only the right retailers, territories, customer types and dates get a scheme', async () => {
  const w = await dist('e1');
  const p = await addProduct(pool, w, { name: 'Tea', price: 100, cost: 60, tax: 0, stock: 5000 });
  const region = (await w.call(territories.create, { body: { level: 'REGION', name: 'South' } })).body.data;
  const terr = (await w.call(territories.create, { body: { level: 'TERRITORY', name: 'Sec', parent_id: region.territory_id } })).body.data;
  const area = (await w.call(territories.create, { body: { level: 'AREA', name: 'Ameerpet', parent_id: terr.territory_id } })).body.data;
  const other = (await w.call(territories.create, { body: { level: 'REGION', name: 'North' } })).body.data;
  const [inArea, elsewhere, dealer] = [await addCustomer(pool, w, { name: 'In area' }), await addCustomer(pool, w, { name: 'Elsewhere' }), await addCustomer(pool, w, { name: 'Dealer', type: 'DEALER' })];
  await pool.query(`UPDATE wholesale_customer_profiles SET territory_id = $2 WHERE customer_id = $1`, [inArea, area.territory_id]);
  await pool.query(`UPDATE wholesale_customer_profiles SET territory_id = $2 WHERE customer_id = $1`, [elsewhere, other.territory_id]);
  const base = { kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 };
  const hasFree = async (c) => (await draft(w, c, [{ product_id: p, quantity: 10 }])).items.some((i) => i.is_free);

  const terrScheme = await scheme(w, { ...base, name: 'South only', territory_ids: [region.territory_id] });
  assert.equal(await hasFree(inArea), true, 'a region reaches the areas inside it');
  assert.equal(await hasFree(elsewhere), false); assert.equal(await hasFree(dealer), false, 'no territory at all: not eligible');
  await w.call(schemes.update, { params: { id: terrScheme.scheme_id }, body: { is_active: false } });

  const named = await scheme(w, { ...base, name: 'Named', customer_ids: [elsewhere] });
  assert.equal(await hasFree(elsewhere), true); assert.equal(await hasFree(inArea), false);
  await w.call(schemes.update, { params: { id: named.scheme_id }, body: { is_active: false } });

  const types = await scheme(w, { ...base, name: 'Dealers', customer_types: ['DEALER'] });
  assert.equal(await hasFree(dealer), true); assert.equal(await hasFree(inArea), false);
  await w.call(schemes.update, { params: { id: types.scheme_id }, body: { is_active: false } });

  const expired = await scheme(w, { ...base, name: 'Old', starts_on: dayFromNow(-30), ends_on: dayFromNow(-1) });
  assert.equal(await hasFree(inArea), false);
  const upcoming = await scheme(w, { ...base, name: 'Soon', starts_on: dayFromNow(2) });
  assert.equal(await hasFree(inArea), false);
  const live = await scheme(w, { ...base, name: 'Live', starts_on: dayFromNow(-1), ends_on: dayFromNow(5) });
  assert.equal(await hasFree(inArea), true);
  const list = (await w.call(schemes.list, { query: {} })).body.data;
  const by = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.equal(by.Old.status, 'EXPIRED'); assert.equal(by.Soon.status, 'UPCOMING'); assert.equal(by.Live.status, 'ACTIVE'); assert.equal(by.Live.days_left, 5); assert.equal(by.Dealers.status, 'INACTIVE');
  assert.deepEqual((await w.call(schemes.list, { query: { expiring: '1' } })).body.data.map((s) => s.name), ['Live'], 'ends in 5 days: expiring this week');
  await w.call(schemes.update, { params: { id: live.scheme_id }, body: { ends_on: dayFromNow(20) } });
  assert.deepEqual((await w.call(schemes.list, { query: { expiring: '1' } })).body.data.map((s) => s.name), []);
  await w.call(schemes.update, { params: { id: live.scheme_id }, body: { ends_on: dayFromNow(3) } });
  assert.deepEqual((await w.call(schemes.list, { query: { expiring: '1' } })).body.data.map((s) => s.name), ['Live']);
  void expired; void upcoming;
  // what a rep sees at the counter
  const el = (await w.call(schemes.eligible, { query: { customer_id: String(inArea) } })).body.data;
  assert.deepEqual(el.map((s) => s.name), ['Live']);
});

t('when schemes compete, the best one wins; stackable schemes and ALL stacking apply together', async () => {
  const w = await dist('k1');
  const p = await addProduct(pool, w, { name: 'Biscuit', price: 100, cost: 60, tax: 0, stock: 5000 });
  const c = await addCustomer(pool, w, { name: 'R' });
  const small = await scheme(w, { name: 'Small', kind: 'QTY_DISCOUNT', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, discount_pct: 2 });
  await scheme(w, { name: 'Big', kind: 'QTY_DISCOUNT', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, discount_pct: 6 });
  let o = await draft(w, c, [{ product_id: p, quantity: 10 }]);
  assert.equal(o.items[0].discount_pct, 6); assert.deepEqual(o.schemes.map((s) => s.name), ['Big']);
  // a stackable scheme combines with the best: 1 - 0.94 × 0.98 = 7.88%
  await w.call(schemes.update, { params: { id: small.scheme_id }, body: { stackable: true } });
  o = await draft(w, c, [{ product_id: p, quantity: 10 }]);
  assert.equal(o.items[0].discount_pct, 7.88); assert.equal(o.schemes.length, 2);
  // a free-goods scheme and a discount scheme are different kinds: both apply
  await scheme(w, { name: 'Freebie', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 });
  o = await draft(w, c, [{ product_id: p, quantity: 10 }]);
  assert.equal(freeOf(o).length, 1);
  // priority beats benefit
  await w.call(schemes.update, { params: { id: small.scheme_id }, body: { stackable: false, priority: 5 } });
  o = await draft(w, c, [{ product_id: p, quantity: 10 }]);
  assert.equal(o.items[0].discount_pct, 2, 'the higher-priority scheme wins even though it gives less');
  // ALL stacking applies every eligible scheme
  await w.call(parties.updateSettings, { body: { scheme_stacking: 'ALL' } });
  o = await draft(w, c, [{ product_id: p, quantity: 10 }]);
  assert.equal(o.items[0].discount_pct, 7.88);
});

t('editing an order re-works the schemes: free lines are replaced, never duplicated, and the application log follows', async () => {
  const w = await dist('r1');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'R' });
  const s = await scheme(w, { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 });
  let o = await draft(w, c, [{ product_id: p, quantity: 30 }]);
  assert.equal(freeOf(o)[0].quantity, 3);
  // the screen sends back everything it was shown, free lines included
  const edit = await w.call(orders.update, { params: { id: o.order_id }, body: { lines: [{ product_id: p, quantity: 50 }, ...freeOf(o).map((f) => ({ product_id: f.product_id, quantity: f.quantity, is_free: true }))] } });
  assert.equal(edit.code, 200, JSON.stringify(edit.body));
  o = edit.body.data;
  assert.equal(o.items.length, 2); assert.equal(freeOf(o)[0].quantity, 5); assert.equal(o.total, 5000);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM dist_scheme_applications WHERE order_id = $1`, [o.order_id])).rows[0].n), 1);
  // fewer than ten: the scheme no longer applies and the log is empty
  o = (await w.call(orders.update, { params: { id: o.order_id }, body: { lines: [{ product_id: p, quantity: 5 }] } })).body.data;
  assert.equal(freeOf(o).length, 0);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM dist_scheme_applications WHERE order_id = $1`, [o.order_id])).rows[0].n), 0);
  // preview shows the free goods and tells the rep what a little more would earn
  const pv = await w.call(orders.preview, { body: { customer_id: c, lines: [{ product_id: p, quantity: 8 }] } });
  assert.equal(pv.body.data.lines.length, 1); assert.match(pv.body.data.scheme_hints[0].message, /Add 2 more pcs/);
  const pv2 = await w.call(orders.preview, { body: { customer_id: c, lines: [{ product_id: p, quantity: 10 }] } });
  assert.equal(pv2.body.data.lines.length, 2); assert.equal(pv2.body.data.lines[1].is_free, true); assert.equal(pv2.body.data.schemes[0].scheme_id, s.scheme_id);
});

t('free goods are reserved like any other stock, and an out-of-stock free line becomes a back-order', async () => {
  const w = await dist('f1');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 105 });
  const c = await addCustomer(pool, w, { name: 'R' });
  await scheme(w, { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 });
  const o = await draft(w, c, [{ product_id: p, quantity: 100 }]);       // 100 paid + 10 free = 110, only 105 on the shelf
  const conf = await w.call(orders.confirm, { params: { id: o.order_id }, body: {} });
  assert.equal(conf.code, 200, JSON.stringify(conf.body));
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 105, reserved: 105 });
  assert.equal(conf.body.data.backordered.reduce((s, x) => s + x.short, 0), 5);
});

t('schemes switch off for a wholesaler who has not turned the distributor features on', async () => {
  const w = await makeWholesaler(pool, 's9', { type: 'WHOLESALE' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, tax: 0, stock: 1000 });
  const c = await addCustomer(pool, w, { name: 'R' });
  await scheme(w, { name: 'Buy 10 get 1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 });
  assert.equal(freeOf(await draft(w, c, [{ product_id: p, quantity: 20 }])).length, 0);
  await w.call(parties.updateSettings, { body: { distributor_enabled: true } });
  assert.equal(freeOf(await draft(w, c, [{ product_id: p, quantity: 20 }])).length, 1);
});

t('scheme rules are validated; used schemes cannot be deleted; tenants are isolated; every change is audited', async () => {
  const a = await dist('v1'); const b = await dist('v2');
  const p = await addProduct(pool, a, { name: 'Soap', price: 100, tax: 0, stock: 1000, units: [{ name: 'carton', factor: 12 }] });
  const c = await addCustomer(pool, a, { name: 'R' });
  const bad = (body) => a.call(schemes.create, { body });
  assert.equal((await bad({ name: 'x1', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, free_qty: 1 })).code, 400, 'needs a quantity to buy');
  assert.equal((await bad({ name: 'x2', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 5 })).code, 400, 'needs a free quantity');
  assert.equal((await bad({ name: 'x3', kind: 'QTY_DISCOUNT', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 5 })).code, 400);
  assert.equal((await bad({ name: 'x4', kind: 'VALUE_DISCOUNT', min_value: 1000, discount: 100, discount_pct: 5 })).code, 400, 'amount or percent, not both');
  assert.equal((await bad({ name: 'x5', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 5, buy_unit_name: 'pallet', free_qty: 1 })).code, 400, 'unknown unit');
  assert.equal((await bad({ name: 'x6', kind: 'QTY_DISCOUNT', buy_scope: 'ALL', buy_unit_name: 'carton', buy_min_qty: 5, discount_pct: 5 })).code, 400, 'a unit needs a product');
  assert.equal((await bad({ name: 'x7', kind: 'QTY_DISCOUNT', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 5, discount_pct: 5, starts_on: '2026-06-01', ends_on: '2026-05-01' })).code, 400);
  assert.equal((await bad({ name: 'x8', kind: 'BUY_X_GET_Y', funded_by: 'PRINCIPAL', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 5, free_qty: 1 })).code, 400, 'a principal-funded scheme names the principal');
  const s = await scheme(a, { name: 'Real', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 1 });
  const used = await draft(a, c, [{ product_id: p, quantity: 20 }]);
  assert.equal((await a.call(schemes.remove, { params: { id: s.scheme_id } })).code, 409, 'used by an order');
  const spare = await scheme(a, { name: 'Spare', kind: 'QTY_DISCOUNT', buy_scope: 'ALL', buy_min_qty: 10, discount_pct: 1 });
  assert.equal((await a.call(schemes.remove, { params: { id: spare.scheme_id } })).code, 200);
  // another tenant cannot read, change or use it
  assert.equal((await b.call(schemes.get, { params: { id: s.scheme_id } })).code, 404);
  assert.equal((await b.call(schemes.update, { params: { id: s.scheme_id }, body: { name: 'hacked' } })).code, 404);
  assert.equal((await b.call(schemes.list, { query: {} })).body.data.length, 0);
  const bp = await addProduct(pool, b, { name: 'B soap', price: 100, tax: 0, stock: 100 });
  assert.equal((await b.call(schemes.create, { body: { name: 'steal', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 5, free_qty: 1 } })).code, 400, 'cannot point at another tenant’s product');
  const bc = await addCustomer(pool, b, { name: 'B cust' });
  assert.equal(freeOf(await draft(b, bc, [{ product_id: bp, quantity: 20 }])).length, 0, 'tenant A’s scheme never applies to tenant B');
  // audit trail with before / after
  await a.call(schemes.update, { params: { id: s.scheme_id }, body: { free_qty: 2 } });
  const log = (await pool.query(`SELECT action, metadata FROM audit_log WHERE business_id = $1 AND resource_type = 'scheme' ORDER BY audit_id`, [a.businessId])).rows;
  assert.deepEqual(log.map((x) => x.action).slice(0, 2), ['distributor.scheme_created', 'distributor.scheme_created']);
  const upd = log.find((x) => x.action === 'distributor.scheme_updated');
  assert.deepEqual(upd.metadata.changes.free_qty, { from: '1.000', to: '2.000' });
  // performance: what it cost, and what can be claimed back from a principal
  assert.equal((await a.call(schemes.performance, { params: { id: s.scheme_id } })).body.data.orders, 0, 'a draft has not cost anything yet');
  await a.call(orders.confirm, { params: { id: used.order_id }, body: {} });
  const perf = (await a.call(schemes.performance, { params: { id: s.scheme_id } })).body.data;
  assert.equal(perf.orders, 1); assert.equal(perf.customers, 1); assert.equal(perf.free_base_ordered, 2, '20 bought → 2 multiples × 1 free, at the time of the order');
});

t('distributor pricing: MRP ₹100, purchase ₹70, selling ₹78, retailer ₹82, customer-specific ₹76 — the right one is picked', async () => {
  const w = await dist('pr1');
  const p = await addProduct(pool, w, { name: 'Detergent', price: 78, cost: 70, mrp: 100, tax: 0, stock: 1000 });
  await pool.query(`UPDATE wholesale_item_details SET retailer_price_paise = 8200, distributor_price_paise = 7800, principal_price_paise = 7000 WHERE product_id = $1`, [p]);
  const retailer = await addCustomer(pool, w, { name: 'Retailer', type: 'RETAILER' });
  const subd = await addCustomer(pool, w, { name: 'Sub-distributor', type: 'DISTRIBUTOR' });
  const dealer = await addCustomer(pool, w, { name: 'Dealer', type: 'DEALER' });
  const price = async (c, qty = 1) => (await priceOne(pool, { businessId: w.businessId, customerId: c, line: { product_id: p, quantity: qty } })).price_paise / 100;
  assert.equal(await price(retailer), 82); assert.equal(await price(subd), 78); assert.equal(await price(dealer), 78, 'dealers pay the wholesale price');
  // a price negotiated with this retailer beats the tier
  const set = await w.call(catalog.setCustomerPrices, { params: { id: String(retailer) }, body: { items: [{ product_id: p, price: 76 }] } });
  assert.equal(set.code, 200, JSON.stringify(set.body));
  assert.equal(await price(retailer), 76); assert.equal(await price(dealer), 78);
  // quantity-based: 100 and over is ₹74 on a list
  const list = (await pool.query(`INSERT INTO wholesale_price_lists (business_id, name, kind, customer_type) VALUES ($1,'Dealer volume','STANDARD','DEALER') RETURNING list_id`, [w.businessId])).rows[0].list_id;
  await pool.query(`INSERT INTO wholesale_price_list_items (list_id, business_id, product_id, min_qty, price_paise) VALUES ($1,$2,$3,1,7800),($1,$2,$3,100,7400)`, [list, w.businessId, p]);
  assert.equal(await price(dealer, 99), 78); assert.equal(await price(dealer, 100), 74);
});

t('territory pricing: a list for a territory reaches the areas under it; an assigned list still wins', async () => {
  const w = await dist('tp1');
  const p = await addProduct(pool, w, { name: 'Rice', price: 100, cost: 70, tax: 0, stock: 1000 });
  const region = (await w.call(territories.create, { body: { level: 'REGION', name: 'South' } })).body.data;
  const terr = (await w.call(territories.create, { body: { level: 'TERRITORY', name: 'Sec', parent_id: region.territory_id } })).body.data;
  const area = (await w.call(territories.create, { body: { level: 'AREA', name: 'Ameerpet', parent_id: terr.territory_id } })).body.data;
  const north = (await w.call(territories.create, { body: { level: 'REGION', name: 'North' } })).body.data;
  const [inArea, inNorth, plain] = [await addCustomer(pool, w, { name: 'A' }), await addCustomer(pool, w, { name: 'N' }), await addCustomer(pool, w, { name: 'P' })];
  await pool.query(`UPDATE wholesale_customer_profiles SET territory_id = $2 WHERE customer_id = $1`, [inArea, area.territory_id]);
  await pool.query(`UPDATE wholesale_customer_profiles SET territory_id = $2 WHERE customer_id = $1`, [inNorth, north.territory_id]);
  const mkList = async (name, territoryId, price) => {
    const made = await w.call(catalog.createList, { body: { name, kind: 'STANDARD', territory_id: territoryId } });
    assert.equal(made.code, 201, JSON.stringify(made.body)); assert.equal(made.body.data.territory_id, territoryId);
    await pool.query(`INSERT INTO wholesale_price_list_items (list_id, business_id, product_id, min_qty, price_paise) VALUES ($1,$2,$3,1,$4)`, [made.body.data.list_id, w.businessId, p, price * 100]);
    return made.body.data.list_id;
  };
  const price = async (c) => (await priceOne(pool, { businessId: w.businessId, customerId: c, line: { product_id: p, quantity: 1 } })).price_paise / 100;
  await mkList('South prices', region.territory_id, 90);
  assert.equal(await price(inArea), 90, 'the region list reaches the area'); assert.equal(await price(inNorth), 100); assert.equal(await price(plain), 100);
  await mkList('Secunderabad prices', terr.territory_id, 88);
  assert.equal(await price(inArea), 88, 'the nearer territory wins');
  const own = await mkList('Ameerpet prices', area.territory_id, 85);
  assert.equal(await price(inArea), 85);
  // a list assigned to the retailer wins over any territory list
  const special = (await w.call(catalog.createList, { body: { name: 'Special', kind: 'STANDARD' } })).body.data.list_id;
  await pool.query(`INSERT INTO wholesale_price_list_items (list_id, business_id, product_id, min_qty, price_paise) VALUES ($1,$2,$3,1,9200)`, [special, w.businessId, p]);
  await pool.query(`UPDATE wholesale_customer_profiles SET price_list_id = $2 WHERE customer_id = $1`, [inArea, special]);
  assert.equal(await price(inArea), 92);
  void own;
  assert.equal((await w.call(catalog.createList, { body: { name: 'Bad', territory_id: 987654 } })).code, 400);
});

t('credit and approval use what the customer pays: free goods and scheme discounts are in the total', async () => {
  const w = await dist('cc1');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 5000 });
  const c = await addCustomer(pool, w, { name: 'R', limit: 5000 });
  await w.call(parties.updateSettings, { body: { credit_policy: 'BLOCK' } });
  await scheme(w, { name: 'Buy 10 get 5', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: p, buy_min_qty: 10, free_qty: 5 });
  const o = await draft(w, c, [{ product_id: p, quantity: 50 }]);          // pays ₹5,000, receives 75 units
  assert.equal(o.total, 5000);
  assert.equal((await w.call(orders.confirm, { params: { id: o.order_id }, body: {} })).code, 200, 'exactly the limit: allowed');
  const made = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 10 }], order: {} }).catch((e) => e);
  void made;
  void invoiceRow;
});
