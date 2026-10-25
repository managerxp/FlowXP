/* A bill is sent to the customer on WhatsApp only on a plan with messaging, and not when that bill was ticked "don't send". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction, recordInvoiceCreated } = await import('../src/modules/billing.js');

test.after(cleanup);

test('plan without messaging, or a bill marked not to send, sends nothing; otherwise the bill goes out', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@bg.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state, messaging_settings) VALUES ('Cafe',$1,'CAFE','Karnataka',$2) RETURNING business_id`, [owner, JSON.stringify({ channel: 'WHATSAPP', bill_auto: true, loyalty_nudge: false })])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Tea','DISH',10000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const ravi = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi','9876543210') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const bill = async () => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { customerId: ravi, items: [{ product_id: product, quantity: 1 }], payment: { amount: 'FULL' } }); await client.query('COMMIT'); return inv; } finally { client.release(); }
  };
  const count = async () => { await new Promise((r) => setTimeout(r, 400)); return (await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [biz])).rows[0].n; };
  const fire = (inv, planFeatures, body = {}) => recordInvoiceCreated({ get: () => undefined, headers: {}, body, auth: { userId: owner }, tenant: { businessId: biz, planFeatures }, ip: '127.0.0.1' }, inv);

  fire(await bill(), { messaging: false });
  assert.equal(await count(), 0, 'a plan without messaging sends nothing');
  fire(await bill(), { messaging: true }, { send_whatsapp: false });
  assert.equal(await count(), 0, 'this bill was ticked "don\'t send"');
  fire(await bill(), { messaging: true });
  assert.equal(await count(), 1, 'on a plan with messaging the bill goes out');
});

test('the Rate Us button goes to the shop\'s Google page, or to the bill when the shop has none, and never to anything else', { skip }, async () => {
  const { reviewRedirect } = await import('../src/controllers/publicBill.controller.js');
  const { shareLink } = await import('../src/modules/messaging/index.js');
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Om','o@rr.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Tea Co',$1,'CAFE','Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, tax_rate, track_inventory) VALUES ($1,'Tea','DISH',10000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const client = await pool.connect();
  let inv;
  try { await client.query('BEGIN'); inv = await createInvoiceInTransaction(client, { businessId: biz, branchId: branch }, owner, { items: [{ product_id: product, quantity: 1 }], payment: { amount: 'FULL' } }); await client.query('COMMIT'); } finally { client.release(); }
  const token = (await shareLink(pool, inv.invoice_id)).split('/').pop();
  const go = async (t) => { let out; await reviewRedirect({ params: { token: t } }, { set() {}, redirect: (code, to) => { out = [code, to]; } }); return out; };
  assert.deepEqual(await go(token), [302, `/bill/${token}`], 'no Google link: the bill');
  await pool.query(`UPDATE businesses SET google_review_link = 'https://g.page/r/CabcDEF123-x' WHERE business_id = $1`, [biz]);
  assert.deepEqual(await go(token), [302, 'https://g.page/r/CabcDEF123-x/review']);
  await pool.query(`UPDATE businesses SET google_review_link = 'https://evil.example/phish' WHERE business_id = $1`, [biz]);
  assert.deepEqual(await go(token), [302, `/bill/${token}`], 'a link that is not a Google review page is never followed');
  assert.deepEqual(await go('nope'), [302, '/']); assert.deepEqual(await go('x'.repeat(32)), [302, '/']);
});
