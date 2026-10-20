/* Language preferences: a person's own choice, a business default, validation, and that language never touches money or locale-of-business settings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const auth = await import('../src/controllers/auth.controller.js');
const business = await import('../src/controllers/business.controller.js');
const { cleanLocale, LOCALES } = await import('../src/utils/locales.js');
const main = (await import('../src/routes/index.js')).default;

test.after(cleanup);
let S; let staff;
const ok = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); return res.body.data; };

test('setup', { skip }, async () => {
  await runMigrations(pool); S = await makeShop(pool, 'lang');
  staff = (await pool.query(`INSERT INTO users (name,email,password_hash) VALUES ('Cashier','cashier-lang@parts.test','x') RETURNING user_id`)).rows[0].user_id;
  await pool.query(`INSERT INTO business_users (business_id,user_id,role,status) VALUES ($1,$2,'CASHIER','ACTIVE')`, [S.businessId, staff]);
});

test('the supported list and the cleaner', () => {
  assert.deepEqual(LOCALES, ['en', 'hi', 'ml', 'ta', 'bn', 'te', 'kn']);
  assert.equal(cleanLocale('HI'), 'hi'); assert.equal(cleanLocale('ml-IN'), 'ml'); assert.equal(cleanLocale('ta_IN'), 'ta');
  assert.equal(cleanLocale('xx'), null); assert.equal(cleanLocale(''), null); assert.equal(cleanLocale(null), null); assert.equal(cleanLocale('te'), 'te'); assert.equal(cleanLocale('ur'), null, 'Urdu needs a right-to-left layout pass first');
});

test('PATCH /auth/language needs a sign-in', { skip }, () => {
  const route = main.stack.filter((l) => l.route).find((l) => l.route.path === '/auth/language' && l.route.methods.patch);
  assert.ok(route, 'the route exists');
  assert.equal(route.route.stack[0].handle.name, 'requireAuth');
});

test('a person sets, changes and clears their own language; bad values are refused', { skip }, async () => {
  assert.equal(ok(await S.call(auth.setLanguage, { body: { language: 'ml' } })).language, 'ml');
  assert.equal((await pool.query(`SELECT language FROM users WHERE user_id=$1`, [S.userId])).rows[0].language, 'ml');
  assert.equal(ok(await S.call(auth.setLanguage, { body: { language: 'Hi-IN' } })).language, 'hi');
  assert.equal((await S.call(auth.setLanguage, { body: { language: 'klingon' } })).code, 400);
  assert.equal((await pool.query(`SELECT language FROM users WHERE user_id=$1`, [S.userId])).rows[0].language, 'hi', 'a refused value changes nothing');
  assert.equal(ok(await S.call(auth.setLanguage, { body: { language: null } })).language, null);
});

test('one person\'s language does not change anyone else\'s', { skip }, async () => {
  ok(await S.call(auth.setLanguage, { body: { language: 'ta' } }));
  const rows = (await pool.query(`SELECT user_id, language FROM users WHERE user_id = ANY($1)`, [[S.userId, staff]])).rows;
  assert.equal(rows.find((r) => r.user_id === S.userId).language, 'ta');
  assert.equal(rows.find((r) => r.user_id === staff).language, null, 'the cashier keeps following the business default');
});

test('the owner sets a business default; it is validated and changes no money, tax or timezone setting', { skip }, async () => {
  const before = (await pool.query(`SELECT currency, timezone, gst_enabled, state, round_off_enabled FROM businesses WHERE business_id=$1`, [S.businessId])).rows[0];
  ok(await S.call(business.updateCurrent, { body: { default_language: 'bn' } }));
  assert.equal((await pool.query(`SELECT default_language FROM businesses WHERE business_id=$1`, [S.businessId])).rows[0].default_language, 'bn');
  const after = (await pool.query(`SELECT currency, timezone, gst_enabled, state, round_off_enabled FROM businesses WHERE business_id=$1`, [S.businessId])).rows[0];
  assert.deepEqual(after, before, 'language is display text only');
  assert.equal((await S.call(business.updateCurrent, { body: { default_language: 'zz' } })).code, 400);
  ok(await S.call(business.updateCurrent, { body: { default_language: '' } }));
  assert.equal((await pool.query(`SELECT default_language FROM businesses WHERE business_id=$1`, [S.businessId])).rows[0].default_language, null);
});

test('/auth/me tells the app both the person\'s choice and the business default', { skip }, async () => {
  ok(await S.call(business.updateCurrent, { body: { default_language: 'hi' } }));
  const user = (await pool.query(`SELECT user_id, name, email, phone, email_verified, language, token_version, totp_enabled FROM users WHERE user_id=$1`, [S.userId])).rows[0];
  const m = (await pool.query(`SELECT b.business_id, b.name, b.business_type, b.currency, b.default_language, b.subscription_status FROM businesses b WHERE b.business_id=$1`, [S.businessId])).rows[0];
  const res = await S.call(auth.me, { auth: { userId: S.userId, user }, authVia: 'cookie', memberships: [{ ...m, role: 'OWNER', permissions: {}, branch_id: null, trial_ends_at: null }] });
  const d = ok(res);
  assert.equal(d.user.language, 'ta');
  assert.equal(d.businesses[0].default_language, 'hi');
});
