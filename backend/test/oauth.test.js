/*
 * Sign in with Google for existing accounts: the redirect to Google carries state, nonce and a PKCE challenge; the
 * callback refuses a mismatched state or a bad ID token; only a verified Google email that matches a verified FlowXP
 * account signs in; an unknown address, an unfinished sign-up and a super admin are all turned away; an account with an
 * authenticator app still gets its second step. Google's token endpoint is a stand-in: no network, no real key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setupTestDb } from './helpers/db.js';

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const oauth = await import('../src/controllers/oauth.controller.js');
const { STATE_COOKIE } = await import('../src/modules/oauth.js');
const mw = await import('../src/middleware/auth.js');

const realFetch = globalThis.fetch;
test.after(async () => { globalThis.fetch = realFetch; await cleanup(); });

const res = () => ({
  redirectedTo: null, cookies: {}, cleared: [], body: null,
  redirect(url) { this.redirectedTo = url; return this; },
  cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
  clearCookie(name) { this.cleared.push(name); return this; },
  json(b) { this.body = b; return this; }
});

/* What Google's token endpoint hands back: an ID token for this person. */
const google = (claims = {}, { ok = true } = {}) => {
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /oauth2\.googleapis\.com\/token/);
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.ok(form.get('code_verifier'), 'PKCE verifier is sent');
    return { ok, json: async () => (ok ? { id_token: jwt.sign({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300, email_verified: true, ...claims }, 'unused') } : { error: 'invalid_grant' }) };
  };
};

/* Start the flow the way a browser would, and come back with the cookie and the state Google would echo. */
const start = () => {
  const r = res(); oauth.googleStart({}, r);
  const url = new URL(r.redirectedTo);
  return { r, url, cookie: r.cookies[STATE_COOKIE].value, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
};
const callback = async ({ cookie, state, nonce, query = {}, email, extra = {} }) => {
  if (email) google({ email, nonce, ...extra });
  const r = res();
  await oauth.googleCallback({ query: { code: 'one-time-code', state, ...query }, headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(cookie)}` }, ip: '10.2.2.2' }, r);
  return r;
};
const account = async (email, { verified = true, superAdmin = false, totp = false } = {}) =>
  (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified, is_super_admin, totp_enabled) VALUES ('Person', $1, 'x', $2, $3, $4) RETURNING user_id`, [email, verified, superAdmin, totp])).rows[0].user_id;

test('setup', { skip }, async () => { await runMigrations(pool); });

test('the redirect to Google carries state, a nonce and a PKCE challenge, and the cookie is private and short-lived', { skip }, () => {
  const { r, url } = start();
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge') && url.searchParams.get('state') && url.searchParams.get('nonce'));
  assert.match(url.searchParams.get('redirect_uri'), /\/api\/auth\/google\/callback$/);
  const opts = r.cookies[STATE_COOKIE].options;
  assert.equal(opts.httpOnly, true); assert.equal(opts.sameSite, 'lax'); assert.equal(opts.path, '/api/auth'); assert.equal(opts.maxAge, 600000);
});

test('the sign-in page is told Google is available only when it is configured', { skip }, () => {
  const r = res(); oauth.providers({}, r);
  assert.deepEqual(r.body.data, { google: true });
});

test('an existing, verified account signs in: a session cookie and a redirect to the app', { skip }, async () => {
  await account('maya@oauth.test');
  const s = start();
  const r = await callback({ ...s, email: 'Maya@OAuth.test' });
  assert.equal(r.redirectedTo, '/app');
  const token = r.cookies[mw.SESSION_COOKIE]?.value;
  assert.ok(token, 'a session cookie is set');
  assert.equal(jwt.decode(token).email, 'maya@oauth.test');
  assert.ok(r.cleared.includes(STATE_COOKIE), 'the one-time state cookie is cleared');
  const logged = (await pool.query(`SELECT method, outcome FROM login_events WHERE email = 'maya@oauth.test'`)).rows;
  assert.deepEqual(logged, [{ method: 'GOOGLE', outcome: 'SUCCESS' }]);
});

test('an address with no FlowXP account is sent to the free trial, not signed up', { skip }, async () => {
  const s = start();
  const r = await callback({ ...s, email: 'stranger@oauth.test' });
  assert.equal(r.redirectedTo, '/login?oauth=no_account');
  assert.equal((await pool.query(`SELECT 1 FROM users WHERE email = 'stranger@oauth.test'`)).rows.length, 0, 'no account is created');
  assert.equal(r.cookies[mw.SESSION_COOKIE], undefined);
});

test('an unfinished sign-up, a super admin, and an address Google has not verified are all turned away', { skip }, async () => {
  await account('half@oauth.test', { verified: false });
  await account('root@oauth.test', { superAdmin: true });
  const a = await callback({ ...start(), email: 'half@oauth.test' });
  assert.equal(a.redirectedTo, '/login?oauth=verify_first');
  const b = await callback({ ...start(), email: 'root@oauth.test' });
  assert.equal(b.redirectedTo, '/login?oauth=not_allowed');
  await account('maya2@oauth.test');
  const c = await callback({ ...start(), email: 'maya2@oauth.test', extra: { email_verified: false } });
  assert.equal(c.redirectedTo, '/login?oauth=unverified_google');
  for (const r of [a, b, c]) assert.equal(r.cookies[mw.SESSION_COOKIE], undefined, 'no session');
});

test('an account with two-step verification still gets its second step: a challenge in the fragment, no session', { skip }, async () => {
  await account('guarded@oauth.test', { totp: true });
  const r = await callback({ ...start(), email: 'guarded@oauth.test' });
  assert.match(r.redirectedTo, /^\/login#second=/);
  assert.equal(r.cookies[mw.SESSION_COOKIE], undefined);
  const challenge = decodeURIComponent(r.redirectedTo.split('#second=')[1]);
  assert.equal(jwt.decode(challenge).purpose, '2fa');
});

test('a callback that does not match the browser that started it is refused', { skip }, async () => {
  const s = start();
  const wrongState = await callback({ ...s, state: 'someone-elses-state', email: 'maya@oauth.test' });
  assert.equal(wrongState.redirectedTo, '/login?oauth=failed');
  const noCookie = await callback({ ...s, cookie: 'not-a-real-cookie', email: 'maya@oauth.test' });
  assert.equal(noCookie.redirectedTo, '/login?oauth=failed');
  const noCode = await callback({ ...s, query: { code: '' }, email: 'maya@oauth.test' });
  assert.equal(noCode.redirectedTo, '/login?oauth=failed');
  const cancelled = await callback({ ...s, query: { error: 'access_denied' } });
  assert.equal(cancelled.redirectedTo, '/login?oauth=cancelled');
});

test('an ID token for another app, from another issuer, expired, or with the wrong nonce is refused', { skip }, async () => {
  const bad = [
    { aud: 'another-app' }, { iss: 'https://evil.example' }, { exp: Math.floor(Date.now() / 1000) - 10 }, { nonce: 'not-ours' }
  ];
  for (const claims of bad) {
    const s = start();
    google({ email: 'maya@oauth.test', nonce: s.nonce, ...claims });
    const r = await callback({ ...s, query: {} });
    assert.equal(r.redirectedTo, '/login?oauth=failed', JSON.stringify(claims));
    assert.equal(r.cookies[mw.SESSION_COOKIE], undefined);
  }
  const s = start(); google({}, { ok: false });
  assert.equal((await callback({ ...s })).redirectedTo, '/login?oauth=failed', 'Google refusing the code');
});
