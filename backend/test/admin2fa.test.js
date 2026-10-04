/*
 * The platform console's sign-in: a short session (8 hours), the authenticator code or a single-use recovery code when
 * two-step verification is on, no way in for an ordinary account, and the same answer for a wrong password as for a
 * non-admin so the console cannot be probed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const admin = await import('../src/controllers/admin.controller.js');
const security = await import('../src/modules/security.js');

test.after(cleanup);

const PASSWORD = 'a long console password 42';
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const login = async (body) => { const r = res(); await admin.login({ body, headers: {}, ip: '10.1.1.1' }, r); return r; };
const user = async (email, superAdmin) => (await pool.query(
  `INSERT INTO users (name, email, password_hash, email_verified, is_super_admin) VALUES ('Console', $1, $2, TRUE, $3) RETURNING user_id`,
  [email, await bcrypt.hash(PASSWORD, 4), superAdmin])).rows[0].user_id;

test('setup', { skip }, async () => { await runMigrations(pool); });

test('a super admin signs in without two-step verification, for 8 hours, and is told it is off', { skip }, async () => {
  await user('plain@console.test', true);
  const r = await login({ email: 'plain@console.test', password: PASSWORD });
  assert.equal(r.code, 200);
  assert.equal(r.body.data.admin.totp_enabled, false);
  const claims = jwt.decode(r.body.data.token);
  assert.equal(claims.exp - claims.iat, 8 * 3600);
});

test('a wrong password and an ordinary account get the same refusal', { skip }, async () => {
  await user('shop@console.test', false);
  const wrong = await login({ email: 'plain@console.test', password: 'nope nope nope' });
  const ordinary = await login({ email: 'shop@console.test', password: PASSWORD });
  const unknown = await login({ email: 'nobody@console.test', password: PASSWORD });
  for (const r of [wrong, ordinary, unknown]) { assert.equal(r.code, 401); assert.equal(r.body.message, 'Email or password is incorrect'); }
});

test('with two-step verification on: a code is asked for, a wrong one refused, a right one works once', { skip }, async () => {
  const id = await user('guarded@console.test', true);
  const secret = security.newSecret();
  await pool.query(`UPDATE users SET totp_enabled = TRUE, totp_secret_enc = $2 WHERE user_id = $1`, [id, security.encryptSecret(secret)]);

  const ask = await login({ email: 'guarded@console.test', password: PASSWORD });
  assert.equal(ask.code, 401); assert.equal(ask.body.requires_2fa, true); assert.equal(ask.body.token, undefined);

  const wrong = await login({ email: 'guarded@console.test', password: PASSWORD, code: '000000' });
  assert.equal(wrong.code, 401); assert.match(wrong.body.message, /not right/);

  const code = security.totpNow(secret);
  const ok = await login({ email: 'guarded@console.test', password: PASSWORD, code });
  assert.equal(ok.code, 200); assert.equal(ok.body.data.admin.totp_enabled, true);

  const replay = await login({ email: 'guarded@console.test', password: PASSWORD, code });
  assert.equal(replay.code, 401, 'a code that was just used does not work again');
});

test('a recovery code signs in once, and only with the password', { skip }, async () => {
  const id = await user('lostphone@console.test', true);
  await pool.query(`UPDATE users SET totp_enabled = TRUE, totp_secret_enc = $2 WHERE user_id = $1`, [id, security.encryptSecret(security.newSecret())]);
  const [recovery] = await security.issueRecoveryCodes(pool, id);

  const noPassword = await login({ email: 'lostphone@console.test', password: 'wrong wrong wrong', recovery_code: recovery });
  assert.equal(noPassword.code, 401);

  const ok = await login({ email: 'lostphone@console.test', password: PASSWORD, recovery_code: recovery });
  assert.equal(ok.code, 200);
  const again = await login({ email: 'lostphone@console.test', password: PASSWORD, recovery_code: recovery });
  assert.equal(again.code, 401); assert.equal(again.body.requires_2fa, true);
});
