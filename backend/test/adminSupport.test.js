/* Super-admin support tools: trial extension, account fixes, activity log, notes, launch checks, business-list filters. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { fakeRes, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const sup = await import('../src/controllers/adminSupport.controller.js');
const admin = await import('../src/controllers/admin.controller.js');
const router = (await import('../src/routes/admin.routes.js')).default;

test.after(cleanup);
let S; let A;
const send = async (h, req) => { const res = fakeRes(); await h({ headers: {}, body: {}, query: {}, params: {}, ...req }, res); await new Promise((r) => setTimeout(r, 30)); return res; };
const ok = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); return res.body.data; };

test('setup', { skip }, async () => {
  await runMigrations(pool); S = await makeShop(pool, 'sup');
  A = (await pool.query(`INSERT INTO users (name,email,password_hash,email_verified,is_super_admin) VALUES ('Boss','boss-sup@flowxp.example','x',TRUE,TRUE) RETURNING user_id`)).rows[0].user_id;
});

test('every new route sits below the super-admin gate', { skip }, () => {
  const gate = router.stack.findIndex((l) => !l.route && l.handle.name === 'requireSuperAdmin');
  assert.ok(gate >= 0);
  for (const p of ['/businesses/:id/extend-trial', '/businesses/:id/notes', '/users', '/users/:id/reset-2fa', '/audit', '/launch-checks']) {
    const i = router.stack.findIndex((l) => l.route && l.route.path === p);
    assert.ok(i > gate, p);
  }
});

test('extending a trial counts from today or the current end, whichever is later, and limits the days', { skip }, async () => {
  await pool.query(`UPDATE businesses SET subscription_status='EXPIRED', trial_ends_at = now() - interval '5 days' WHERE business_id=$1`, [S.businessId]);
  const p = { id: String(S.businessId) };
  const d = ok(await send(sup.extendTrial, { auth: { userId: A }, params: p, body: { days: 7 } }));
  assert.equal(d.subscription_status, 'TRIAL');
  const left = (new Date(d.trial_ends_at) - Date.now()) / 864e5;
  assert.ok(left > 6.9 && left < 7.1, `from today, not from the past: ${left}`);
  const d2 = ok(await send(sup.extendTrial, { auth: { userId: A }, params: p, body: { days: 10 } }));
  assert.ok((new Date(d2.trial_ends_at) - Date.now()) / 864e5 > 16.9, 'added on top of the running trial');
  for (const days of [0, -3, 91, 'x']) assert.equal((await send(sup.extendTrial, { auth: { userId: A }, params: p, body: { days } })).code, 400);
  assert.equal((await send(sup.extendTrial, { auth: { userId: A }, params: { id: '999999' }, body: { days: 5 } })).code, 404);
  assert.equal((await pool.query(`SELECT 1 FROM audit_log WHERE action='admin.trial_extended' AND business_id=$1`, [S.businessId])).rowCount, 2);
});

test('people: search, detail, sign out, verify email, reset two-step; platform admins are refused', { skip }, async () => {
  await pool.query(`UPDATE users SET totp_enabled=TRUE, totp_secret_enc='enc', email_verified=FALSE WHERE user_id=$1`, [S.userId]);
  await pool.query(`INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [S.userId, 'a'.repeat(64)]);
  const list = ok(await send(sup.listUsers, { query: { search: 'sup' } }));
  assert.ok(list.users.some((u) => u.user_id === S.userId));
  assert.ok(!('password_hash' in list.users[0]));
  const det = ok(await send(sup.getUser, { params: { id: String(S.userId) } }));
  assert.equal(det.memberships[0].business_id, S.businessId);
  const tv = (await pool.query(`SELECT token_version FROM users WHERE user_id=$1`, [S.userId])).rows[0].token_version;
  const me = { auth: { userId: A }, params: { id: String(S.userId) } };
  ok(await send(sup.signOutUser, me));
  ok(await send(sup.verifyUserEmail, me));
  ok(await send(sup.resetUserTwoFactor, me));
  const u = (await pool.query(`SELECT token_version, email_verified, totp_enabled, totp_secret_enc FROM users WHERE user_id=$1`, [S.userId])).rows[0];
  assert.equal(u.token_version, tv + 2); assert.equal(u.email_verified, true); assert.equal(u.totp_enabled, false); assert.equal(u.totp_secret_enc, null);
  assert.equal((await pool.query(`SELECT 1 FROM recovery_codes WHERE user_id=$1`, [S.userId])).rowCount, 0);
  for (const h of [sup.signOutUser, sup.verifyUserEmail, sup.resetUserTwoFactor]) assert.equal((await send(h, { auth: { userId: A }, params: { id: String(A) } })).code, 403);
  assert.equal((await send(sup.getUser, { params: { id: '999999' } })).code, 404);
  const acts = (await pool.query(`SELECT action FROM audit_log WHERE resource_type='user' AND resource_id=$1`, [String(S.userId)])).rows.map((r) => r.action).sort();
  assert.deepEqual(acts, ['admin.user_2fa_reset', 'admin.user_email_verified', 'admin.user_signed_out']);
});

test('activity log filters by business, action and date', { skip }, async () => {
  const all = ok(await send(sup.auditLog, { query: { business_id: String(S.businessId), action: 'trial' } }));
  assert.equal(all.total, 2); assert.equal(all.events[0].business_name, `Shop ${S.tag}`);
  assert.equal(ok(await send(sup.auditLog, { query: { business_id: String(S.businessId), action: 'nothing-like-this' } })).total, 0);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(ok(await send(sup.auditLog, { query: { business_id: String(S.businessId), from: today, to: today } })).total >= 2);
});

test('business list filters by type and subscription status', { skip }, async () => {
  const T = await makeShop(pool, 'sup2');
  await pool.query(`UPDATE businesses SET subscription_status='ACTIVE' WHERE business_id=$1`, [T.businessId]);
  const get = async (query) => ok(await send(admin.listBusinesses, { query: { page_size: '100', ...query } })).businesses.map((b) => b.business_id);
  assert.ok((await get({ type: 'AUTO_PARTS', subscription_status: 'ACTIVE' })).includes(T.businessId));
  assert.ok(!(await get({ type: 'RESTAURANT' })).includes(T.businessId));
  assert.ok(!(await get({ subscription_status: 'TRIAL' })).includes(T.businessId));
});

test('notes: add, list, delete, need text, die with the business', { skip }, async () => {
  const p = { id: String(S.businessId) };
  assert.equal((await send(sup.addNote, { auth: { userId: A }, params: p, body: { note: '  ' } })).code, 400);
  assert.equal((await send(sup.addNote, { auth: { userId: A }, params: { id: '999999' }, body: { note: 'x' } })).code, 404);
  const n = ok(await send(sup.addNote, { auth: { userId: A }, params: p, body: { note: 'Called, wants Pro after the trial' } }), 201);
  assert.equal(ok(await send(sup.listNotes, { params: p }))[0].author, 'Boss');
  assert.equal((await send(sup.deleteNote, { params: { id: '999999', noteId: String(n.note_id) } })).code, 404);
  ok(await send(sup.deleteNote, { params: { ...p, noteId: String(n.note_id) } }));
  ok(await send(sup.addNote, { auth: { userId: A }, params: p, body: { note: 'again' } }), 201);
  await pool.query(`DELETE FROM businesses WHERE business_id=$1`, [S.businessId]);
  assert.equal((await pool.query(`SELECT 1 FROM admin_notes WHERE business_id=$1`, [S.businessId])).rowCount, 0);
});

test('launch checks report each item and fail the dev setup honestly', { skip }, async () => {
  const d = ok(await send(sup.launchChecks, {}));
  assert.ok(d.checks.length >= 12);
  assert.ok(d.checks.every((c) => c.key && c.label && typeof c.ok === 'boolean' && ['must', 'should'].includes(c.level)));
  assert.equal(d.checks.find((c) => c.key === 'admin_2fa').ok, false, 'the test admin has no two-step');
  assert.equal(d.ready, false);
  assert.equal(d.checks.find((c) => c.key === 'migrations').ok, true);
});
