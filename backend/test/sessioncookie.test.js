/*
 * The browser session cookie (flowxp_session): set when a sign-in finishes, httpOnly/SameSite=Lax/scoped to /api,
 * accepted by requireAuth instead of the Authorization header, refused for a change without the FlowXP header (CSRF),
 * moved to the new session when the session rotates, cleared on sign-out, and never accepted once the session has
 * been ended everywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const auth = await import('../src/controllers/auth.controller.js');
const security = await import('../src/controllers/security.controller.js');
const mw = await import('../src/middleware/auth.js');

test.after(cleanup);

const PASSWORD = 'correct horse battery';

/* A response that remembers cookies the way Express would set them. */
const cookieRes = () => ({
  code: 200, body: null, cookies: {}, cleared: [],
  status(c) { this.code = c; return this; },
  json(b) { this.body = b; return this; },
  set() { return this; },
  cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
  clearCookie(name, options) { this.cleared.push({ name, options }); return this; }
});

const withCookie = (token, extra = {}) => ({ cookie: `other=1; ${mw.SESSION_COOKIE}=${encodeURIComponent(token)}; theme=light`, ...extra });
const through = async (headers, method = 'GET') => {
  const req = { method, headers, body: {}, query: {}, params: {}, ip: '10.0.0.9' };
  const res = cookieRes(); let passed = false;
  await mw.requireAuth(req, res, () => { passed = true; });
  return { req, res, passed };
};

let user;
test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Cookie Owner','owner@cookie.test',$1,TRUE) RETURNING user_id, email, name, token_version`,
    [await bcrypt.hash(PASSWORD, 4)])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Cookie Cafe',$1,'CAFE') RETURNING business_id`, [user.user_id])).rows[0];
  await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [biz.business_id]);
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
});

let sessionToken;
test('a finished sign-in sets an httpOnly, SameSite=Lax cookie scoped to /api', { skip }, async () => {
  const res = cookieRes();
  await auth.login({ body: { email: user.email, password: PASSWORD }, headers: { 'user-agent': 'CookieTest/1' }, ip: '10.0.0.9', query: {}, params: {} }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const set = res.cookies[mw.SESSION_COOKIE];
  assert.ok(set, 'the session cookie was set');
  assert.equal(set.value, res.body.data.token);
  assert.equal(set.options.httpOnly, true);
  assert.equal(set.options.sameSite, 'lax');
  assert.equal(set.options.path, '/api');
  assert.ok(set.options.maxAge > 6 * 24 * 3600 * 1000, 'lives as long as the token (7 days)');
  sessionToken = set.value;
});

test('requireAuth accepts the cookie for reads and for changes that carry the FlowXP header', { skip }, async () => {
  const read = await through(withCookie(sessionToken), 'GET');
  assert.ok(read.passed, JSON.stringify(read.res.body));
  assert.equal(read.req.auth.userId, user.user_id);
  assert.equal(read.req.authVia, 'cookie');

  const change = await through(withCookie(sessionToken, { 'x-requested-with': 'FlowXP' }), 'POST');
  assert.ok(change.passed, JSON.stringify(change.res.body));
});

test('a change made with the cookie but without the FlowXP header is refused (CSRF)', { skip }, async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const { passed, res } = await through(withCookie(sessionToken), method);
    assert.equal(passed, false, method);
    assert.equal(res.code, 403, method);
  }
});

test('the Authorization header still works, wins over a cookie, and needs no FlowXP header', { skip }, async () => {
  const { passed, req } = await through({ authorization: `Bearer ${sessionToken}`, cookie: `${mw.SESSION_COOKIE}=garbage` }, 'POST');
  assert.ok(passed);
  assert.equal(req.authVia, 'header');
});

test('a forged, expired-looking or challenge token in the cookie is not a session', { skip }, async () => {
  assert.equal((await through(withCookie('not-a-token'))).res.code, 401);
  assert.equal((await through(withCookie(sessionToken.slice(0, -2) + 'xx'))).res.code, 401);
  assert.equal((await through(withCookie(mw.signChallenge(user)))).res.code, 401);    // half-finished 2FA sign-in
});

test('/auth/me refreshes the cookie (sliding session, and the move-over from the old header)', { skip }, async () => {
  const { req } = await through({ authorization: `Bearer ${sessionToken}` });
  const res = cookieRes();
  await auth.me(req, res);
  assert.equal(res.code, 200);
  assert.ok(res.cookies[mw.SESSION_COOKIE]?.value, 'a cookie came back with /auth/me');
  assert.equal(res.cookies[mw.SESSION_COOKIE].options.httpOnly, true);
});

test('sign out everywhere moves this browser to the new session; the old cookie stops working', { skip }, async () => {
  const { req } = await through(withCookie(sessionToken, { 'x-requested-with': 'FlowXP' }), 'POST');
  const res = cookieRes();
  await security.signOutEverywhere(req, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const fresh = res.cookies[mw.SESSION_COOKIE]?.value;
  assert.ok(fresh && fresh !== sessionToken, 'this browser got the new session in its cookie');
  assert.equal((await through(withCookie(sessionToken))).res.code, 401, 'the old session is over');
  assert.ok((await through(withCookie(fresh))).passed, 'the new one works');
});

test('clearSessionCookie clears the same cookie it set', { skip }, () => {
  const res = cookieRes();
  mw.clearSessionCookie(res);
  assert.equal(res.cleared.length, 1);
  assert.equal(res.cleared[0].name, mw.SESSION_COOKIE);
  assert.equal(res.cleared[0].options.path, '/api');
  assert.equal(res.cleared[0].options.httpOnly, true);
});
