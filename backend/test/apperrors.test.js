/* Crash reports from the mobile app: stored cut to size, refused when empty, grouped for the platform admin, old ones forgotten. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const errors = await import('../src/controllers/appErrors.controller.js');

test.after(cleanup);
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const post = async (body) => { const res = fakeRes(); await errors.report({ body }, res); return res; };

test('setup', { skip }, async () => { await runMigrations(pool); });

test('a report is stored with what the app says, cut to size; an empty one is refused', { skip }, async () => {
  assert.equal((await post({})).code, 400); assert.equal((await post({ message: '   ' })).code, 400);
  const r = await post({ message: 'x'.repeat(900), stack: 's'.repeat(9000), version: '1.2.3', platform: 'android', os_version: '14', device: 'AB3', screen: '/till', fatal: true, business_id: 7, email: 'a@b.c' });
  assert.equal(r.code, 201);
  const row = (await pool.query(`SELECT * FROM app_errors`)).rows[0];
  assert.equal(row.message.length, 500); assert.equal(row.stack.length, 4000); assert.equal(row.fatal, true);
  assert.deepEqual([row.version, row.platform, row.os_version, row.device, row.screen], ['1.2.3', 'android', '14', 'AB3', '/till']);
  assert.equal('business_id' in row || 'email' in row, false, 'no person or business is kept');
});

test('the admin list groups the same message, counts times and devices, newest first', { skip }, async () => {
  await pool.query(`DELETE FROM app_errors`);
  for (const d of ['AB3', 'AB3', 'XY7']) await post({ message: 'Cannot read property price', device: d, screen: '/till', version: '1.0.0', platform: 'android' });
  await post({ message: 'Network down', device: 'XY7', fatal: false });
  const res = fakeRes(); await errors.list({ query: {} }, res);
  assert.equal(res.body.data[0].message, 'Network down');
  const price = res.body.data.find((e) => e.message.startsWith('Cannot'));
  assert.equal(price.times, 3); assert.equal(price.devices, 2);
});

test('reports older than 30 days are deleted as new ones arrive', { skip }, async () => {
  await pool.query(`INSERT INTO app_errors (message, created_at) VALUES ('ancient', CURRENT_TIMESTAMP - INTERVAL '31 days')`);
  await post({ message: 'fresh' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM app_errors WHERE message = 'ancient'`)).rows[0].count), 0);
});
