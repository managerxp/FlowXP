/* Support center: a client raises a ticket, the admin answers, only the owner of a ticket can read it, and a reply reopens a closed one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

test('raise, answer, reply, close, and nobody else can read it', { skip }, async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const s = await import('../src/controllers/support.controller.js');
  const mk = async (email) => {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [email.split('@')[0], email])).rows[0].user_id;
    const b = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'CAFE') RETURNING business_id`, [`${email} cafe`, u])).rows[0].business_id;
    return { u, b };
  };
  const a = await mk('asha@sp.test'); const o = await mk('om@sp.test');
  const call = async (fn, { who, params = {}, body = {}, query = {} }) => { let out; const res = { status(c) { this.code = c; return this; }, json(x) { out = { code: this.code ?? 200, body: x }; return this; } }; await fn({ tenant: { businessId: who.b }, auth: { userId: who.u }, params, body, query, ip: '127.0.0.1', headers: {} }, res); return out; };

  assert.equal((await call(s.create, { who: a, body: { subject: 'x', body: 'too short' } })).code, 400);
  const id = (await call(s.create, { who: a, body: { subject: 'WhatsApp credit', category: 'WHATSAPP', body: 'My credit finished but I paid yesterday.' } })).body.data.ticket_id;
  assert.equal((await call(s.mine, { who: a })).body.data.length, 1);
  assert.equal((await call(s.mine, { who: o })).body.data.length, 0, 'another business sees nothing');
  assert.equal((await call(s.getMine, { who: o, params: { id } })).code, 404, 'and cannot open it');
  assert.equal((await call(s.replyMine, { who: o, params: { id }, body: { body: 'hi' } })).code, 404);

  assert.equal((await call(s.adminList, { who: a, query: { status: 'OPEN' } })).body.data.length, 1);
  assert.equal(await s.adminCount(), 1);
  const got = (await call(s.adminGet, { who: a, params: { id } })).body.data;
  assert.equal(got.business_name, 'asha@sp.test cafe'); assert.equal(got.messages.length, 1);
  const rep = await call(s.adminReply, { who: a, params: { id }, body: { body: 'Loaded now.' } });
  assert.equal(rep.body.data.messages.length, 2);
  assert.equal(await s.adminCount(), 0, 'answered tickets are not waiting for us');
  assert.equal((await call(s.unreadMine, { who: a })).body.data.unread, 1);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'support_reply'`, [a.u])).rows[0].n, 1, 'the client is told');
  const read = (await call(s.getMine, { who: a, params: { id } })).body.data;
  assert.equal(read.status, 'ANSWERED'); assert.equal((await call(s.unreadMine, { who: a })).body.data.unread, 0);

  assert.equal((await call(s.closeMine, { who: a, params: { id } })).body.data.status, 'CLOSED');
  await call(s.replyMine, { who: a, params: { id }, body: { body: 'Still not showing' } });
  assert.equal((await pool.query(`SELECT status FROM support_tickets WHERE ticket_id = $1`, [id])).rows[0].status, 'OPEN', 'writing again reopens it');
  assert.equal((await call(s.adminSetStatus, { who: a, params: { id }, body: { status: 'CLOSED' } })).body.data.status, 'CLOSED');
});
