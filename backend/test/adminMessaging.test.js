/* Super-admin WhatsApp usage: counts per business, the category each kind is charged as, and the gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { fakeRes, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const msg = await import('../src/controllers/adminMessaging.controller.js');
const router = (await import('../src/routes/admin.routes.js')).default;

test.after(cleanup);
const send = async (h, req) => { const res = fakeRes(); await h({ headers: {}, body: {}, query: {}, params: {}, ...req }, res); return res.body.data; };

test('usage counts only sent WhatsApp messages and prices them by category', { skip }, async () => {
  await runMigrations(pool);
  const S = await makeShop(pool, 'msgu');
  const add = (kind, status, channel = 'WHATSAPP') => pool.query(`INSERT INTO messages (business_id, phone, channel, kind, body, status) VALUES ($1,'919800000000',$2,$3,'x',$4)`, [S.businessId, channel, kind, status]);
  await add('BILL', 'SENT'); await add('BILL', 'SENT'); await add('BILL', 'FAILED'); await add('OFFER', 'SENT'); await add('BILL', 'SENT', 'SMS');
  const d = await send(msg.usage, { query: {} });
  const b = d.businesses.find((x) => x.business_id === S.businessId);
  assert.equal(b.sent, 3); assert.equal(b.failed, 1);
  assert.equal(b.UTILITY, 2); assert.equal(b.MARKETING, 1);
  assert.equal(b.cost, Math.round((2 * msg.RATES.UTILITY + msg.RATES.MARKETING) * 100) / 100);
  const one = await send(msg.businessUsage, { params: { id: String(S.businessId) }, query: {} });
  assert.equal(one.summary.sent, 3);
  assert.equal(one.kinds.find((k) => k.kind === 'OFFER').category, 'MARKETING');
  assert.equal(one.days.length, 1);
});

test('the routes sit below the super-admin gate', { skip }, () => {
  const gate = router.stack.findIndex((l) => !l.route && l.handle.name === 'requireSuperAdmin');
  for (const p of ['/messaging/usage', '/businesses/:id/messaging']) assert.ok(router.stack.findIndex((l) => l.route?.path === p) > gate, p);
});
