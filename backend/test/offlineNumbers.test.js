/* Offline bill numbers: two phones billing at once never share a number, the printed number becomes the bill number, and a number that cannot be used never loses a sale. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);
let biz; let branch; let owner;
const run = async (fn, headers = {}, body = {}) => {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await fn({ tenant: { businessId: biz, branchId: branch, scopeBranchId: branch, role: 'OWNER', permissions: {}, businessType: 'SUPERMARKET', planFeatures: {}, currency: 'INR' }, auth: { userId: owner }, body, params: {}, query: {}, ip: '127.0.0.1', headers: h, get: (n) => h[n.toLowerCase()] }, res);
  return res;
};
const sale = { items: [{ description: 'Tea', unit_price: 10, quantity: 1 }], payment: { amount: 'FULL' } };
const sell = async (key, printed) => { const r = await run(invoices.create, { 'Idempotency-Key': key, ...(printed ? { 'X-Offline-Sale': '1', 'X-Offline-Number': printed } : {}) }, sale); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data.invoice_number; };
const series = async (device) => (await run(invoices.offlineSeries, {}, { device })).body.data;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@slip.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status, plan_code) VALUES ('Shop',$1,'SUPERMARKET','ACTIVE','ENTERPRISE') RETURNING business_id`, [owner])).rows[0].business_id;
  branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
});

test('phones asking at once get different series, and a phone asking again keeps its own', { skip }, async () => {
  const [a, b] = await Promise.all([series('device-aaaaaaaa'), series('device-bbbbbbbb')]);
  assert.deepEqual([a.code, b.code].sort(), ['M1', 'M2']);
  assert.equal((await series('device-aaaaaaaa')).code, a.code);
});

test('two phones billing offline at once, with online bills between, never share a number', { skip }, async () => {
  const numbers = await Promise.all([sell('a1', 'M1-0001'), sell('b1', 'M2-0001'), sell('o1'), sell('o2'), sell('a2', 'M1-0002')]);
  assert.deepEqual([numbers[0], numbers[1], numbers[4]], ['M1-0001', 'M2-0001', 'M1-0002']);
  assert.equal(new Set(numbers).size, 5);
  assert.equal((await series('device-aaaaaaaa')).next, (await pool.query(`SELECT last_number FROM offline_series WHERE business_id = $1 AND device_uid = 'device-aaaaaaaa'`, [biz])).rows[0].last_number + 1);
});

test('a number already used, or from no series, still records the sale under the ordinary series', { skip }, async () => {
  for (const [key, printed] of [['dup', 'M1-0001'], ['unknown', 'M9-0001'], ['junk', 'INV-0001']]) assert.match(await sell(key, printed), /^INV-/);
});

test('a number sent with an ordinary online sale is ignored', { skip }, async () => {
  const r = await run(invoices.create, { 'Idempotency-Key': 'online-with-number', 'X-Offline-Number': 'M1-0050' }, sale);
  assert.match(r.body.data.invoice_number, /^INV-/);
});
