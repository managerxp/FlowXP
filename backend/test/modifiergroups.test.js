/*
 * Modifier groups from the group's side: which dishes offer it (listed and set
 * in one go), and a group switched off is left out of the till's list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const menu = await import('../src/controllers/menu.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let other; let user; let curry; let naan; let rice; let theirs; let group;
const tenant = (businessId = biz) => ({ businessId, branchId: null, scopeBranchId: null, role: 'OWNER', permissions: {} });
const call = async (fn, extra = {}, t = tenant()) => { const res = fakeRes(); await fn({ tenant: t, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
const product = async (businessId, name, kind = 'DISH') => (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise) VALUES ($1,$2,$3,10000) RETURNING product_id`, [businessId, name, kind])).rows[0].product_id;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('m','m@mod.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Dhaba',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  other = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Other',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  [curry, naan] = [await product(biz, 'Curry'), await product(biz, 'Naan')];
  rice = await product(biz, 'Rice', 'INGREDIENT');
  theirs = await product(other, 'Their dish');
  const res = await call(menu.createGroup, { body: { name: 'Extras', is_variant: false, min_select: 0, max_select: 2, modifiers: [{ name: 'Cheese', price_delta: 40 }, { name: 'Butter', price_delta: 15 }] } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  group = res.body.data;
  assert.deepEqual(group.products, [], 'a new group is on no dish yet');
});

test('a group can be put on several dishes at once, and lists them', { skip }, async () => {
  const set = await call(menu.setGroupProducts, { params: { id: group.group_id }, body: { product_ids: [curry, naan] } });
  assert.equal(set.code, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.data.products.map((p) => p.name), ['Curry', 'Naan']);
  const fromDish = (await pool.query(`SELECT product_id FROM product_modifier_groups WHERE group_id = $1 ORDER BY product_id`, [group.group_id])).rows.map((r) => r.product_id);
  assert.deepEqual(fromDish, [curry, naan].sort((a, b) => a - b), 'the same links a dish edit uses');

  const fewer = await call(menu.setGroupProducts, { params: { id: group.group_id }, body: { product_ids: [naan] } });
  assert.deepEqual(fewer.body.data.products.map((p) => p.name), ['Naan'], 'the list replaces, it does not add');
});

test('only your own menu items can be chosen, and only for your own group', { skip }, async () => {
  assert.match((await call(menu.setGroupProducts, { params: { id: group.group_id }, body: { product_ids: [theirs] } })).body.message, /your own menu/);
  assert.match((await call(menu.setGroupProducts, { params: { id: group.group_id }, body: { product_ids: [rice] } })).body.message, /your own menu/, 'not an ingredient');
  assert.equal((await call(menu.setGroupProducts, { params: { id: group.group_id }, body: { product_ids: [] } }, tenant(other))).code, 404);
  assert.equal((await call(menu.setGroupProducts, { params: { id: group.group_id }, body: { product_ids: 'all' } })).code, 400);
});

test('a group switched off is left off the till, but kept', { skip }, async () => {
  const off = await call(menu.updateGroup, { params: { id: group.group_id }, body: { name: 'Extras', is_variant: false, min_select: 0, max_select: 2, is_active: false, modifiers: group.modifiers } });
  assert.equal(off.code, 200, JSON.stringify(off.body));
  assert.equal((await call(menu.listGroups)).body.data.length, 0);
  const all = (await call(menu.listGroups, { query: { all: 'true' } })).body.data;
  assert.deepEqual(all.map((g) => [g.name, g.is_active, g.products.length]), [['Extras', false, 1]]);
});
