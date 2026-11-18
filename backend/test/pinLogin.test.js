/*
 * PIN sign-in on a known computer: the device key is made when a PIN is set, the sign-in page lists first names, the right PIN signs in,
 * wrong PINs count down and five revoke it, the cookie alone or the PIN alone opens nothing, and a password change ends every PIN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const pin = await import('../src/controllers/pinLogin.controller.js');

test.after(cleanup);

const res = () => ({ code: 200, body: null, cookies: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, cookie(n, v) { this.cookies[n] = v; return this; } });
const req = (extra = {}) => ({ headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', ...(extra.headers || {}) }, body: {}, params: {}, query: {}, ip: '127.0.0.1', ...extra });

test('PIN sign-in: set, list, sign in, wrong tries, revoke, and a password change ends it', { skip }, async () => {
  await runMigrations(pool);
  const hash = await bcrypt.hash('pw-123456', 4);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Ravi Kumar','ravi@pin.test',$1,TRUE) RETURNING *`, [hash])).rows[0];
  const other = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Priya S','priya@pin.test',$1,TRUE) RETURNING *`, [hash])).rows[0];
  const auth = (u) => ({ userId: u.user_id, email: u.email, user: u });

  // an easy PIN is refused; setting one gives this computer its device key
  assert.equal((await (async () => { const r = res(); await pin.setPin(req({ auth: auth(user), body: { pin: '1111' } }), r); return r; })()).code, 400);
  const r1 = res(); await pin.setPin(req({ auth: auth(user), body: { pin: '2580' } }), r1);
  const key = r1.cookies[pin.DEVICE_COOKIE];
  assert.ok(key && key.length >= 40, 'a device key was given');
  const here = { cookie: `${pin.DEVICE_COOKIE}=${key}` };
  const r2 = res(); await pin.setPin(req({ auth: auth(other), body: { pin: '7392' }, headers: here }), r2);
  assert.equal(r2.cookies[pin.DEVICE_COOKIE], undefined, 'the same computer keeps its key');

  // the sign-in page: first names of the people with a PIN here; another computer sees nobody
  const list = res(); await pin.people(req({ headers: here }), list);
  assert.deepEqual(list.body.data.map((p) => p.name).sort(), ['Priya', 'Ravi']);
  const elsewhere = res(); await pin.people(req({ headers: { cookie: `${pin.DEVICE_COOKIE}=${'x'.repeat(43)}` } }), elsewhere);
  assert.deepEqual(elsewhere.body.data, []);

  // the right PIN signs in; the PIN without this computer's key does not
  const ok = res(); await pin.loginWithPin(req({ headers: here, body: { user_id: user.user_id, pin: '2580' } }), ok);
  assert.equal(ok.code, 200, JSON.stringify(ok.body)); assert.ok(ok.body.data.token);
  const noKey = res(); await pin.loginWithPin(req({ body: { user_id: user.user_id, pin: '2580' } }), noKey);
  assert.equal(noKey.code, 401);
  const wrongPerson = res(); await pin.loginWithPin(req({ headers: here, body: { user_id: other.user_id, pin: '2580' } }), wrongPerson);
  assert.equal(wrongPerson.code, 401, 'one person\'s PIN does not open another');

  // wrong PINs count down; the right one resets the count; five in a row revoke it
  for (let i = 4; i >= 1; i -= 1) { const w = res(); await pin.loginWithPin(req({ headers: here, body: { user_id: user.user_id, pin: '0000' } }), w); assert.equal(w.body.tries_left, i); }
  const again = res(); await pin.loginWithPin(req({ headers: here, body: { user_id: user.user_id, pin: '2580' } }), again);
  assert.equal(again.code, 200, 'still has its last try');
  for (let i = 0; i < 5; i += 1) await pin.loginWithPin(req({ headers: here, body: { user_id: user.user_id, pin: '0000' } }), res());
  const gone = res(); await pin.loginWithPin(req({ headers: here, body: { user_id: user.user_id, pin: '2580' } }), gone);
  assert.equal(gone.code, 401, 'five wrong PINs revoke it');

  // the screen lock check uses the same PIN and the same count
  const chk = res(); await pin.checkPin(req({ auth: auth(other), headers: here, body: { pin: '7392' } }), chk);
  assert.deepEqual([chk.body.data.has_pin, chk.body.data.ok], [true, true]);

  // a password change (token_version) ends every PIN the person set
  await pool.query(`UPDATE users SET token_version = token_version + 1 WHERE user_id = $1`, [other.user_id]);
  const after = res(); await pin.people(req({ headers: here }), after);
  assert.deepEqual(after.body.data, []);
});
