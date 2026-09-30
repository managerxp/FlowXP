/*
 * The product list's cost and margin per sold item: from the recipe (the
 * viewer's outlet's own recipe when it has one), else from the purchase price.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const products = await import('../src/controllers/products.controller.js');
const menu = await import('../src/controllers/menu.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let B; let rice; let biryani; let cola; let special;
const at = (scope, branchId = scope ?? A) => ({ businessId: biz, branchId, scopeBranchId: scope, role: 'OWNER', permissions: {} });
const call = async (fn, tenant, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
const product = async (name, kind, sell, buy) => (await pool.query(
  `INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, track_inventory) VALUES ($1,$2,$3,$4,$5,FALSE) RETURNING product_id`,
  [biz, name, kind, sell, buy])).rows[0].product_id;
const listed = async (tenant) => Object.fromEntries((await call(products.list, tenant)).body.data.map((p) => [p.name, p]));

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('c','c@cost.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Kitchen',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'B') RETURNING branch_id`, [biz])).rows[0].branch_id;
  rice = await product('Rice', 'INGREDIENT', 0, 20000);          // ₹200 a kg
  biryani = await product('Biryani', 'DISH', 30000, 0);          // ₹300
  cola = await product('Cola', 'DISH', 5000, 2000);              // sold as bought: ₹50, costs ₹20
  special = await product('Special', 'DISH', 10000, 0);          // no recipe, no cost
  const saved = await call(menu.setRecipe, at(A), { params: { id: biryani }, body: { ingredients: [{ ingredient_id: rice, quantity: 0.5, wastage_pct: 10 }] } });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
});

test('a dish with a recipe is costed from it; one sold as bought from its price; others have no cost', { skip }, async () => {
  const p = await listed(at(null));
  assert.deepEqual([p.Biryani.cost_source, p.Biryani.unit_cost, p.Biryani.margin_pct], ['recipe', 110, 63.3], '0.5 kg + 10% waste at ₹200');
  assert.deepEqual([p.Cola.cost_source, p.Cola.unit_cost, p.Cola.margin_pct], ['purchase', 20, 60]);
  assert.deepEqual([p.Special.cost_source, p.Special.unit_cost, p.Special.margin_pct], [null, null, null]);
  assert.equal('cost_source' in p.Rice, false, 'ingredients are not sold, so no margin');
});

test('an outlet with its own recipe is costed from that one', { skip }, async () => {
  const own = await call(menu.setRecipe, at(B), { params: { id: biryani }, body: { branch_id: B, ingredients: [{ ingredient_id: rice, quantity: 0.25, wastage_pct: 0 }] } });
  assert.equal(own.code, 200, JSON.stringify(own.body));
  assert.equal((await listed(at(B))).Biryani.unit_cost, 50);
  assert.equal((await listed(at(A))).Biryani.unit_cost, 110, 'A still uses the default recipe');
  assert.equal((await call(products.get, at(B), { params: { id: biryani } })).body.data.margin_pct, 83.3);
});
