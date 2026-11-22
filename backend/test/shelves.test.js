/* The Popular and Offers shelves: best sellers come from real sales, offers from the offers running today, and both feed the product list. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { offerMap, popularIds, offerLabel } = await import('../src/modules/shelves.js');
const { dropPromotionCache } = await import('../src/modules/promotions.js');
const products = await import('../src/controllers/products.controller.js');

test.after(cleanup);

let G; let tenant; let tea; let biscuit; let soap; let cat;
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('setup: three products, tea sold on many bills, biscuits on one', { skip }, async () => {
  await runMigrations(pool);
  G = await makeGym(pool, 'shelf');
  tenant = G.tenantFor('owner');
  cat = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Snacks') RETURNING category_id`, [G.businessId])).rows[0].category_id;
  const add = async (name, categoryId) => (await pool.query(
    `INSERT INTO products (business_id, category_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,$2,$3,'DISH',5000,3000,0,FALSE) RETURNING product_id`, [G.businessId, categoryId, name])).rows[0].product_id;
  tea = await add('Tea', null); biscuit = await add('Biscuit', cat); soap = await add('Soap', null);
  const bill = async (id, qty) => { const c = await pool.connect(); try { await c.query('BEGIN'); await createInvoiceInTransaction(c, tenant, G.userId, { items: [{ product_id: id, quantity: qty }], payment: { method: 'CASH', amount: 'FULL' } }); await c.query('COMMIT'); } finally { c.release(); } };
  for (let i = 0; i < 4; i++) await bill(tea, 2);
  await bill(biscuit, 5);
});

test('popular needs regular sales: tea is on the shelf, a single big biscuit bill is not', { skip }, async () => {
  assert.deepEqual(await popularIds(tenant), [tea]);
  const r = res(); await products.list({ tenant, query: { shelf: 'popular' } }, r);
  assert.deepEqual(r.body.data.map((p) => p.name), ['Tea']);
});

test('offers: a product offer and a category offer both put products on the shelf with a badge; an ended offer does not', { skip }, async () => {
  await pool.query(`INSERT INTO promotions (business_id, name, kind, product_id, percent) VALUES ($1,'Soap sale','PERCENT_OFF',$2,10)`, [G.businessId, soap]);
  await pool.query(`INSERT INTO promotions (business_id, name, kind, category_id, buy_qty, get_qty) VALUES ($1,'Snacks 2+1','BUY_X_GET_Y',$2,2,1)`, [G.businessId, cat]);
  await pool.query(`INSERT INTO promotions (business_id, name, kind, product_id, percent, ends_on) VALUES ($1,'Old tea','PERCENT_OFF',$2,50,'2020-01-01')`, [G.businessId, tea]);
  dropPromotionCache(G.businessId);
  const m = await offerMap(tenant);
  assert.equal(m.get(soap), '10% off');
  assert.equal(m.get(biscuit), 'Buy 2 get 1 free');
  assert.equal(m.has(tea), false, 'an ended offer is not shown');
  const r = res(); await products.list({ tenant, query: { shelf: 'offers' } }, r);
  assert.deepEqual(r.body.data.map((p) => p.name).sort(), ['Biscuit', 'Soap']);
  assert.equal(r.body.data.find((p) => p.name === 'Soap').offer_label, '10% off');
  const all = res(); await products.list({ tenant, query: {} }, all);
  assert.equal(all.body.data.find((p) => p.name === 'Biscuit').offer_label, 'Buy 2 get 1 free', 'the badge shows in the ordinary list too');
  const s = res(); await products.shelves({ tenant, query: {} }, s);
  assert.deepEqual(s.body.data.offers.map((o) => o.product_id).sort(), [biscuit, soap].sort());
  assert.equal(offerLabel({ kind: 'MIX_BUNDLE', bundle_qty: 3, bundle_price_paise: 5000 }), 'Any 3 for ₹50');
});
