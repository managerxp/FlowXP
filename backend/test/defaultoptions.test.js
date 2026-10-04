/*
 * A new restaurant, cafe or cloud kitchen starts with Spice level, Veg extras and Non-veg extras; other kinds of
 * business get none; a business that already has option groups is never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { addDefaultOptionGroups, FOOD_TYPES } = await import('../src/modules/defaultOptions.js');

test.after(cleanup);

const business = async (name, type) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [name, `${name}@defaults.test`])).rows[0].user_id;
  return (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,$3) RETURNING business_id`, [name, user, type])).rows[0].business_id;
};
const groups = async (id) => (await pool.query(
  `SELECT g.name, g.is_variant, g.min_select, g.max_select, array_agg(m.name ORDER BY m.sort_order) AS options
   FROM modifier_groups g JOIN modifiers m USING (group_id) WHERE g.business_id = $1 GROUP BY g.group_id ORDER BY g.sort_order`, [id])).rows;

test('food businesses are the restaurant family only', () => {
  assert.deepEqual(FOOD_TYPES, ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN']);
});

test('a new restaurant gets Spice level (pick one), Veg extras and Non-veg extras (optional)', { skip }, async () => {
  await runMigrations(pool);
  const id = await business('Curry House', 'RESTAURANT');
  assert.equal(await addDefaultOptionGroups(pool, id), true);
  const g = await groups(id);
  assert.deepEqual(g.map((x) => x.name), ['Spice level', 'Veg extras', 'Non-veg extras']);
  assert.deepEqual([g[0].is_variant, g[0].min_select, g[0].max_select], [true, 1, 1]);
  assert.deepEqual([g[1].min_select, g[1].max_select], [0, 3]);
  assert.ok(g[1].options.includes('Extra paneer') && !g[1].options.includes('Extra chicken'), 'veg extras hold nothing non-veg');
  assert.ok(g[2].options.includes('Extra chicken') && g[2].options.includes('Fried egg'));
  const price = (await pool.query(`SELECT price_delta_paise FROM modifiers WHERE business_id = $1 AND name = 'Extra chicken'`, [id])).rows[0].price_delta_paise;
  assert.equal(Number(price), 6000);
});

test('a business that already has option groups is left alone, and a second call adds nothing', { skip }, async () => {
  const id = await business('Own Setup', 'CAFE');
  await pool.query(`INSERT INTO modifier_groups (business_id, name, is_variant, min_select, max_select) VALUES ($1,'Milk',TRUE,1,1)`, [id]);
  assert.equal(await addDefaultOptionGroups(pool, id), false);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM modifier_groups WHERE business_id = $1`, [id])).rows[0].n, 1);

  const fresh = await business('Twice', 'CLOUD_KITCHEN');
  await addDefaultOptionGroups(pool, fresh); await addDefaultOptionGroups(pool, fresh);
  assert.equal((await groups(fresh)).length, 3);
});
