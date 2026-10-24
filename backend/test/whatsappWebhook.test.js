/*
 * Meta's callbacks for WhatsApp: the address check, the signature, delivery and read receipts, a failed send, and a customer's STOP.
 * Nothing is sent anywhere; the callbacks are made by hand.
 */
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: crypto } = await import('node:crypto');
const { setupTestDb } = await import('./helpers/db.js');

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const hooks = await import('../src/controllers/webhooks.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, type(t) { this.headers.type = t; return this; } });
const sign = (raw) => `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(raw).digest('hex')}`;
const callback = async (payload, { signature } = {}) => {
  const raw = Buffer.from(JSON.stringify(payload));
  const res = fakeRes();
  await hooks.whatsappEvents({ rawBody: raw, body: payload, get: (h) => (h.toLowerCase() === 'x-hub-signature-256' ? (signature ?? sign(raw)) : undefined) }, res);
  return res;
};
const verify = async (query) => { const res = fakeRes(); await hooks.whatsappVerify({ query }, res); return res; };
const statusOf = (id, status, extra = {}) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status, timestamp: '1792000000', ...extra }] } }] }] });

let biz; let customer;
test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Hook Owner','hook-owner@flowxp.test','x') RETURNING user_id`)).rows[0];
  biz = (await pool.query(`INSERT INTO businesses (name, business_type, owner_user_id, gst_enabled, state, status, plan_code, subscription_status) VALUES ('Hook Shop','RETAIL',$1,TRUE,'Karnataka','ACTIVE','GROWTH','ACTIVE') RETURNING business_id`, [user.user_id])).rows[0].business_id;
  customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Asha','98450 11122') RETURNING customer_id`, [biz])).rows[0].customer_id;
});

test('Meta can check the address: the right token gets the challenge back, anything else is refused', { skip }, async () => {
  const ok = await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '1158201444' });
  assert.equal(ok.code, 200); assert.equal(ok.body, '1158201444');
  assert.equal((await verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).code, 403);
  assert.equal((await verify({ 'hub.mode': 'subscribe', 'hub.challenge': '1' })).code, 403, 'no token at all');
  assert.equal((await verify({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '1' })).code, 403);
});

test('a callback must be signed with the app secret', { skip }, async () => {
  const payload = statusOf('wamid.X', 'delivered');
  assert.equal((await callback(payload, { signature: 'sha256=deadbeef' })).code, 401);
  assert.equal((await callback(payload, { signature: '' })).code, 401);
  assert.equal((await callback(payload)).code, 200);
});

test('delivered and read are kept on the message, and a failure says why', { skip }, async () => {
  const msg = async (pid) => (await pool.query(`INSERT INTO messages (business_id, customer_id, phone, channel, kind, body, status, provider_id) VALUES ($1,$2,'919845011122','WHATSAPP','BILL','Hi','SENT',$3) RETURNING message_id`, [biz, customer, pid])).rows[0].message_id;
  const a = await msg('wamid.AAA'); const b = await msg('wamid.BBB'); const c = await msg('wamid.CCC');
  const row = async (id) => (await pool.query(`SELECT status, error, delivered_at, read_at FROM messages WHERE message_id = $1`, [id])).rows[0];
  await callback(statusOf('wamid.AAA', 'delivered'));
  let r = await row(a); assert.ok(r.delivered_at && !r.read_at && r.status === 'SENT');
  await callback(statusOf('wamid.BBB', 'read'));
  r = await row(b); assert.ok(r.read_at && r.delivered_at, 'read implies delivered');
  await callback(statusOf('wamid.CCC', 'failed', { errors: [{ code: 131026, title: 'Message undeliverable', message: 'Not a WhatsApp user' }] }));
  r = await row(c); assert.equal(r.status, 'FAILED'); assert.equal(r.error, 'Not a WhatsApp user');
  const first = (await row(a)).delivered_at;
  await callback(statusOf('wamid.AAA', 'delivered', { timestamp: '1793000000' }));
  assert.equal(String((await row(a)).delivered_at), String(first), 'a repeated callback changes nothing');
  assert.equal((await callback(statusOf('wamid.UNKNOWN', 'delivered'))).code, 200, 'a message we do not know is not an error');
});

test('a customer who writes STOP is opted out of promotions, whatever the number looks like', { skip }, async () => {
  const text = (body, from = '919845011122') => ({ entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.IN', type: 'text', text: { body } }] } }] }] });
  await callback(text('Thanks!'));
  assert.equal((await pool.query(`SELECT marketing_opt_out FROM customers WHERE customer_id = $1`, [customer])).rows[0].marketing_opt_out, false, 'ordinary words change nothing');
  await callback(text('  STOP '));
  assert.equal((await pool.query(`SELECT marketing_opt_out FROM customers WHERE customer_id = $1`, [customer])).rows[0].marketing_opt_out, true);
});
