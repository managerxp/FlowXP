/*
 * Sign-in security: TOTP, recovery codes, sign-in records and lockout, two-step login, session versions,
 * the owner's policy, and upload sniffing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const auth = await import('../src/controllers/auth.controller.js');
const security = await import('../src/controllers/security.controller.js');
const admin = await import('../src/controllers/admin.controller.js');
const mw = await import('../src/middleware/auth.js');
const sec = await import('../src/modules/security.js');
const { looksLikeImage } = await import('../src/middleware/upload.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const PASSWORD = 'correct horse battery';

/* ── pure ───────────────────────────────────────────────────────────────── */

test('TOTP matches the RFC 6238 test vector, and base32 round-trips', () => {
  const secret = sec.toBase32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(sec.fromBase32(secret).toString(), '12345678901234567890');
  assert.equal(sec.totpNow(secret, 59_000), '287082');                    // 94287082 in the RFC's 8 digits
  assert.equal(sec.totpNow(secret, 1_111_111_109_000), '081804');
  const fresh = sec.newSecret();
  assert.match(fresh, /^[A-Z2-7]{32}$/);
  assert.equal(sec.toBase32(sec.fromBase32(fresh)), fresh);
});

test('a code is accepted within one step of drift, once, and never after that', () => {
  const secret = sec.newSecret();
  const now = 1_700_000_000_000;
  const code = sec.totpNow(secret, now);
  const step = sec.verifyTotp(secret, code, { now });
  assert.equal(step, Math.floor(now / 30000));
  assert.equal(sec.verifyTotp(secret, code, { now, lastStep: step }), null);                          // replay
  assert.equal(sec.verifyTotp(secret, code, { now: now + 30_000 }), step);                            // a step late is fine
  assert.equal(sec.verifyTotp(secret, code, { now: now + 90_000 }), null);                            // too old
  assert.equal(sec.verifyTotp(secret, sec.totpNow(secret, now + 30_000), { now }), step + 1);         // a step early too
  assert.equal(sec.verifyTotp(secret, '12345', { now }), null);
  assert.equal(sec.verifyTotp(secret, 'abcdef', { now }), null);
  assert.equal(sec.verifyTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, { now }), step);      // spaces as typed from an app
  assert.match(sec.otpauthUrl({ secret, email: 'a@b.test' }), /^otpauth:\/\/totp\/FlowXP:a%40b\.test\?secret=[A-Z2-7]+&issuer=FlowXP/);
});

test('the stored secret is encrypted and tamper-proof', () => {
  const stored = sec.encryptSecret('JBSWY3DPEHPK3PXP');
  assert.match(stored, /^v1:/);
  assert.ok(!stored.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(sec.decryptSecret(stored), 'JBSWY3DPEHPK3PXP');
  assert.notEqual(sec.encryptSecret('JBSWY3DPEHPK3PXP'), stored);                                     // a fresh nonce each time
  const raw = Buffer.from(stored.slice(3), 'base64'); raw[raw.length - 1] ^= 1;
  assert.throws(() => sec.decryptSecret(`v1:${raw.toString('base64')}`));
});

test('uploads are judged by their first bytes, not the type the sender claims', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)]);
  assert.ok(looksLikeImage(jpeg, 'image/jpeg') && looksLikeImage(png, 'image/png') && looksLikeImage(webp, 'image/webp'));
  assert.equal(looksLikeImage(jpeg, 'image/png'), false);                                              // says PNG, is a JPEG
  assert.equal(looksLikeImage(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), false);
  assert.equal(looksLikeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'), false);
  assert.equal(looksLikeImage(Buffer.alloc(3), 'image/png'), false);
});

/* ── database ───────────────────────────────────────────────────────────── */

let A;
const makeUser = async (label, { role = 'OWNER', biz = null, superAdmin = false } = {}) => {
  const u = (await pool.query(`INSERT INTO users (name, email, password_hash, is_super_admin, email_verified) VALUES ($1,$2,$3,$4,TRUE) RETURNING user_id, email, name`,
    [label, `${label}@sec.test`, await bcrypt.hash(PASSWORD, 4), superAdmin])).rows[0];
  let businessId = biz;
  if (!businessId && !superAdmin) {
    businessId = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [`${label} Co`, u.user_id])).rows[0].business_id;
    await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`, [businessId]);
  }
  if (businessId) await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,$3,'ACTIVE')`, [businessId, u.user_id, role]);
  return { ...u, businessId };
};
const post = async (fn, body, headers = {}) => { const res = fakeRes(); await fn({ body, headers: { 'user-agent': 'TestBrowser/1', ...headers }, ip: '10.0.0.1', query: {}, params: {} }, res); return res; };
const login = (email, password = PASSWORD, ua = 'TestBrowser/1') => post(auth.login, { email, password }, { 'user-agent': ua });

/** A request as the middleware sees it once the person is signed in with `token`. */
const authed = async (token) => {
  const req = { headers: { authorization: `Bearer ${token}` }, body: {}, query: {}, params: {}, ip: '10.0.0.1' };
  const res = fakeRes(); let passed = false;
  await mw.requireAuth(req, res, () => { passed = true; });
  return { req, res, passed };
};
const asUser = async (token, fn, body = {}) => {
  const { req, passed, res } = await authed(token);
  assert.ok(passed, `token rejected: ${JSON.stringify(res.body)}`);
  req.body = body;
  const out = fakeRes(); await fn(req, out); return out;
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeUser('ann');
});

test('a sign-in is recorded; the first device is normal, a second one is flagged', { skip }, async () => {
  const first = await login('ann@sec.test');
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.ok(first.body.data.token);
  assert.equal(first.body.data.new_device, false);
  assert.equal((await login('ann@sec.test')).body.data.new_device, false);                             // the same device again
  assert.equal((await login('ann@sec.test', PASSWORD, 'Chrome/Android')).body.data.new_device, true);
  const events = (await pool.query(`SELECT outcome, method, new_device, ip, user_agent FROM login_events WHERE user_id = $1 ORDER BY event_id`, [A.user_id])).rows;
  assert.deepEqual(events.map((e) => [e.outcome, e.method, e.new_device]), [['SUCCESS', 'PASSWORD', false], ['SUCCESS', 'PASSWORD', false], ['SUCCESS', 'PASSWORD', true]]);
  assert.equal(events[0].ip, '10.0.0.1');
  A.token = first.body.data.token;

  const mine = (await asUser(A.token, security.loginHistory)).body.data;
  assert.equal(mine.length, 3);
  assert.equal(mine[0].new_device, true);                                                              // newest first
});

test('five wrong passwords lock the address for a while, unknown addresses too, and the lock lifts', { skip }, async () => {
  const bob = await makeUser('bob');
  for (let i = 0; i < 5; i += 1) assert.equal((await login('bob@sec.test', 'wrong password')).code, 401);
  const locked = await login('bob@sec.test', PASSWORD);                                                // even the right password now
  assert.equal(locked.code, 429);
  assert.match(locked.body.message, /Try again in \d+ minute/);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM login_events WHERE email = 'bob@sec.test' AND outcome = 'LOCKED'`)).rows[0].n, 1);

  // the same answer for an address that is not an account, so the lock reveals nothing
  for (let i = 0; i < 5; i += 1) assert.equal((await login('ghost@sec.test', 'nope')).code, 401);
  assert.equal((await login('ghost@sec.test', 'nope')).code, 429);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM login_events WHERE email = 'ghost@sec.test' AND outcome = 'UNKNOWN_USER'`)).rows[0].n, 5);

  // after the window the right password works, and a success clears the count
  await pool.query(`UPDATE login_events SET created_at = created_at - INTERVAL '20 minutes' WHERE email = 'bob@sec.test'`);
  assert.equal((await login('bob@sec.test', PASSWORD)).code, 200);
  assert.equal(await sec.lockedMinutes(pool, 'bob@sec.test'), 0);
  assert.equal((await login('bob@sec.test', 'wrong')).code, 401);
  assert.equal((await login('bob@sec.test', PASSWORD)).code, 200);                                      // one slip is not a lock
  assert.ok(bob.user_id);
});

test('two-step verification: set up, confirm, get recovery codes; the old session ends and the new one works', { skip }, async () => {
  const setup = (await asUser(A.token, security.setup)).body.data;
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.otpauth_url, /^otpauth:\/\//);
  assert.equal((await asUser(A.token, security.status)).body.data.setup_pending, true);
  assert.equal((await asUser(A.token, security.enable, { code: '000000' })).code, 401);                // not enabled by a wrong code
  assert.equal((await asUser(A.token, security.status)).body.data.enabled, false);

  const enabled = await asUser(A.token, security.enable, { code: sec.totpNow(setup.secret) });
  assert.equal(enabled.code, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.data.recovery_codes.length, 10);
  assert.match(enabled.body.data.recovery_codes[0], /^[a-z2-7]{5}-[a-z2-7]{5}$/);
  const stored = (await pool.query(`SELECT totp_secret_enc FROM users WHERE user_id = $1`, [A.user_id])).rows[0].totp_secret_enc;
  assert.ok(!stored.includes(setup.secret));                                                            // never stored in the clear
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND code_hash LIKE '%-%'`, [A.user_id])).rows[0].n, 0);   // only hashes

  assert.equal((await authed(A.token)).passed, false);                                                  // the old session is over
  A.token = enabled.body.data.token;
  assert.equal((await authed(A.token)).passed, true);                                                   // the one that turned it on is fine
  A.secret = setup.secret; A.recovery = enabled.body.data.recovery_codes;
  const status = (await asUser(A.token, security.status)).body.data;
  assert.deepEqual([status.enabled, status.recovery_codes_left, status.required], [true, 10, false]);
  assert.equal((await asUser(A.token, security.setup)).code, 409);                                      // already on
});

test('with two-step on, a password earns only a challenge; a good code (once) earns the session', { skip }, async () => {
  const step1 = await login('ann@sec.test');
  assert.equal(step1.code, 200);
  assert.equal(step1.body.data.requires_2fa, true);
  assert.equal(step1.body.data.token, undefined);                                                       // no session yet
  const challenge = step1.body.data.challenge;
  assert.equal((await authed(challenge)).passed, false);                                                // a challenge is not a session

  assert.equal((await post(auth.loginTwoFactor, { challenge: 'garbage', code: '123456' })).code, 401);
  const wrong = await post(auth.loginTwoFactor, { challenge, code: '000000' });
  assert.equal(wrong.code, 401);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM login_events WHERE user_id = $1 AND outcome = 'TWO_FACTOR_FAILED'`, [A.user_id])).rows[0].n, 1);

  // (the code for this moment was spent turning two-step on, so use the next one, which is allowed as clock drift)
  const code = sec.totpNow(A.secret, Date.now() + 30_000);
  const good = await post(auth.loginTwoFactor, { challenge, code });
  assert.equal(good.code, 200, JSON.stringify(good.body));
  assert.ok(good.body.data.token && good.body.data.businesses.length === 1);
  assert.equal((await authed(good.body.data.token)).passed, true);
  assert.equal((await pool.query(`SELECT method FROM login_events WHERE user_id = $1 AND outcome = 'SUCCESS' ORDER BY event_id DESC LIMIT 1`, [A.user_id])).rows[0].method, '2FA');

  const again = (await login('ann@sec.test')).body.data.challenge;                                      // the same code, a moment later
  assert.equal((await post(auth.loginTwoFactor, { challenge: again, code })).code, 401);                // a used code can't be replayed
});

test('a recovery code signs in once and is then spent', { skip }, async () => {
  const challenge = () => login('ann@sec.test').then((r) => r.body.data.challenge);
  const code = A.recovery[0];
  const ok = await post(auth.loginTwoFactor, { challenge: await challenge(), recovery_code: code.toUpperCase() });      // case and dashes don't matter
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal((await post(auth.loginTwoFactor, { challenge: await challenge(), recovery_code: code })).code, 401);
  assert.equal((await post(auth.loginTwoFactor, { challenge: await challenge(), recovery_code: 'aaaaa-bbbbb' })).code, 401);
  assert.equal(await sec.recoveryCodesLeft(pool, A.user_id), 9);
  assert.equal((await pool.query(`SELECT method FROM login_events WHERE user_id = $1 AND outcome = 'SUCCESS' ORDER BY event_id DESC LIMIT 1`, [A.user_id])).rows[0].method, 'RECOVERY');
});

test('repeated wrong codes lock the account like wrong passwords do', { skip }, async () => {
  const carl = await makeUser('carl');
  const t = (await login('carl@sec.test')).body.data.token;
  const s = (await asUser(t, security.setup)).body.data;
  const token = (await asUser(t, security.enable, { code: sec.totpNow(s.secret) })).body.data.token;
  for (let i = 0; i < 5; i += 1) {
    const challenge = (await login('carl@sec.test')).body.data.challenge;
    if (!challenge) break;
    assert.equal((await post(auth.loginTwoFactor, { challenge, code: '000000' })).code, 401);
  }
  assert.equal((await login('carl@sec.test')).code, 429);
  assert.ok(token && carl.user_id);
});

test('changing the password, or signing out everywhere, ends the other sessions', { skip }, async () => {
  const dan = await makeUser('dan');
  const t1 = (await login('dan@sec.test')).body.data.token;
  const t2 = (await login('dan@sec.test')).body.data.token;                                             // another device
  assert.equal((await asUser(t1, security.changePassword, { current_password: 'wrong', new_password: 'a brand new pass' })).code, 401);
  assert.equal((await asUser(t1, security.changePassword, { current_password: PASSWORD, new_password: 'short' })).code, 400);
  assert.equal((await asUser(t1, security.changePassword, { current_password: PASSWORD, new_password: PASSWORD })).code, 400);
  const changed = await asUser(t1, security.changePassword, { current_password: PASSWORD, new_password: 'a brand new pass' });
  assert.equal(changed.code, 200);
  assert.equal((await authed(t2)).passed, false);                                                        // the other device is out
  assert.equal((await authed(t1)).passed, false);                                                        // so is the old token of this one
  assert.equal((await authed(changed.body.data.token)).passed, true);
  assert.equal((await login('dan@sec.test', PASSWORD)).code, 401);
  assert.equal((await login('dan@sec.test', 'a brand new pass')).code, 200);

  const t3 = (await login('dan@sec.test', 'a brand new pass')).body.data.token;
  const t4 = (await login('dan@sec.test', 'a brand new pass')).body.data.token;
  const out = await asUser(t3, security.signOutEverywhere);
  assert.equal((await authed(t4)).passed, false);
  assert.equal((await authed(t3)).passed, false);
  assert.equal((await authed(out.body.data.token)).passed, true);
  assert.ok(dan.user_id);
});

test('a password reset ends every session, and the code is a 6-digit one-time code, not a link', { skip }, async () => {
  const eve = await makeUser('eve');
  const token = (await login('eve@sec.test')).body.data.token;
  const code = '483920';
  await pool.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`, [crypto.createHash('sha256').update(code).digest('hex'), eve.user_id]);

  assert.equal((await post(auth.resetPassword, { email: 'eve@sec.test', code: '000000', password: 'another new secret' })).code, 400);   // wrong code
  assert.equal((await post(auth.resetPassword, { email: 'eve@sec.test', code, password: 'short' })).code, 400);                           // password too short, code untouched
  const ok = await post(auth.resetPassword, { email: 'eve@sec.test', code, password: 'another new secret' });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal((await authed(token)).passed, false);

  // spent: that exact code can't be used a second time, even before it would have expired
  assert.equal((await post(auth.resetPassword, { email: 'eve@sec.test', code, password: 'one more secret' })).code, 400);

  // a freshly requested code (a different value — token_hash is the table's primary key, so two pending
  // codes can never collide) still works normally
  const second = '710284';
  await pool.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`, [crypto.createHash('sha256').update(second).digest('hex'), eve.user_id]);
  assert.equal((await post(auth.resetPassword, { email: 'eve@sec.test', code: second, password: 'yet another secret' })).code, 200);
});

test('a token from before session versions existed keeps working until the version changes', { skip }, async () => {
  const fay = await makeUser('fay');
  const legacy = (await import('jsonwebtoken')).default.sign({ sub: fay.user_id, email: fay.email }, process.env.JWT_SECRET, { expiresIn: '1h' });   // no `tv`
  assert.equal((await authed(legacy)).passed, true);
  const none = (await import('jsonwebtoken')).default.sign({ sub: fay.user_id, email: fay.email, tv: 0 }, process.env.JWT_SECRET, { algorithm: 'HS512' });
  assert.equal((await authed(none)).passed, false);                                                      // only the algorithm we sign with is accepted
});

test('turning two-step off needs the password and a code; recovery codes can be replaced', { skip }, async () => {
  const t = A.token;
  assert.equal((await asUser(t, security.newCodes, { password: 'wrong' })).code, 401);
  const fresh = await asUser(t, security.newCodes, { password: PASSWORD });
  assert.equal(fresh.body.data.recovery_codes.length, 10);
  assert.equal(await sec.recoveryCodesLeft(pool, A.user_id), 10);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NOT NULL`, [A.user_id])).rows[0].n, 0);   // the old set is gone

  assert.equal((await asUser(t, security.disable, { password: 'wrong', code: sec.totpNow(A.secret, Date.now() + 30000) })).code, 401);
  assert.equal((await asUser(t, security.disable, { password: PASSWORD, code: '111111' })).code, 401);
  const off = await asUser(t, security.disable, { password: PASSWORD, recovery_code: fresh.body.data.recovery_codes[0] });
  assert.equal(off.code, 200, JSON.stringify(off.body));
  A.token = off.body.data.token;
  assert.equal((await asUser(A.token, security.status)).body.data.enabled, false);
  assert.equal((await login('ann@sec.test')).body.data.requires_2fa, undefined);                        // back to password only
  assert.equal(await sec.recoveryCodesLeft(pool, A.user_id), 0);
});

test('the owner can require two-step for owners and admins, but not before their own is on', { skip }, async () => {
  const owner = await makeUser('olga');
  const adminUser = await makeUser('ravi', { role: 'ADMIN', biz: owner.businessId });
  const cashier = await makeUser('sam', { role: 'CASHIER', biz: owner.businessId });
  const tOwner = (await login('olga@sec.test')).body.data.token;

  const policy = async (token, on) => { const { req } = await authed(token); req.tenant = { businessId: owner.businessId }; req.body = { require_2fa_admins: on }; req.auth.userId; const res = fakeRes(); await security.setPolicy(req, res); return res; };
  assert.equal((await policy(tOwner, true)).code, 409);                                                  // no second step of their own yet

  const s = (await asUser(tOwner, security.setup)).body.data;
  const tOwner2 = (await asUser(tOwner, security.enable, { code: sec.totpNow(s.secret) })).body.data.token;
  assert.equal((await policy(tOwner2, true)).code, 200);

  // enforced in the business middleware: the admin has no second step, the owner has, the cashier is not affected
  const gate = async (userEmail) => {
    const token = (await login(userEmail)).body.data;
    const t = token.token ?? null;
    if (!t) return 'challenge';
    const { req } = await authed(t);
    const res = fakeRes(); let passed = false;
    req.headers['x-business-id'] = String(owner.businessId);
    await mw.withBusiness()(req, res, () => { passed = true; });
    return passed ? 'ok' : `${res.code} ${res.body.code}`;
  };
  assert.equal(await gate('ravi@sec.test'), '403 TWO_FACTOR_REQUIRED');
  assert.equal(await gate('sam@sec.test'), 'ok');
  assert.equal(await gate('olga@sec.test'), 'challenge');                                                // the owner signs in with a code

  // the admin can still reach the security screens to set it up, and then gets in
  const tAdmin = (await login('ravi@sec.test')).body.data.token;
  const status = (await asUser(tAdmin, security.status)).body.data;
  assert.equal(status.required, true);
  const sa = (await asUser(tAdmin, security.setup)).body.data;
  const tAdmin2 = (await asUser(tAdmin, security.enable, { code: sec.totpNow(sa.secret) })).body.data.token;
  { const { req } = await authed(tAdmin2); req.headers['x-business-id'] = String(owner.businessId); let ok = false; await mw.withBusiness()(req, fakeRes(), () => { ok = true; }); assert.equal(ok, true); }
  assert.equal((await asUser(tAdmin2, security.disable, { password: PASSWORD, code: sec.totpNow(sa.secret, Date.now() + 30000) })).code, 409);      // required: can't be turned off
  assert.ok(adminUser.user_id && cashier.user_id);

  // the owner's overview
  const overview = async () => { const { req } = await authed(tOwner2); req.tenant = { businessId: owner.businessId }; const res = fakeRes(); await security.team(req, res); return res.body.data; };
  const t = await overview();
  assert.equal(t.require_2fa_admins, true);
  assert.deepEqual(t.members.map((m) => [m.name, m.role, m.two_factor]).sort(), [['olga', 'OWNER', true], ['ravi', 'ADMIN', true], ['sam', 'CASHIER', false]]);
  assert.equal(t.summary.privileged_without_2fa, 0);
  assert.ok(t.events.length > 0 && t.events.every((e) => ['olga', 'ravi', 'sam'].includes(e.email.split('@')[0])));                                   // only this team's sign-ins
});

test('the platform console can be protected with a code as well', { skip }, async () => {
  const root = await makeUser('root', { superAdmin: true });
  const first = await post(admin.login, { email: 'root@sec.test', password: PASSWORD });
  assert.equal(first.code, 200);
  const t = first.body.data.token;
  const s = (await asUser(t, security.setup)).body.data;
  const t2 = (await asUser(t, security.enable, { code: sec.totpNow(s.secret) })).body.data.token;

  const noCode = await post(admin.login, { email: 'root@sec.test', password: PASSWORD });
  assert.equal(noCode.code, 401); assert.equal(noCode.body.requires_2fa, true);
  assert.equal((await post(admin.login, { email: 'root@sec.test', password: PASSWORD, code: '000000' })).code, 401);
  const ok = await post(admin.login, { email: 'root@sec.test', password: PASSWORD, code: sec.totpNow(s.secret, Date.now() + 30000) });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.ok(t2 && root.user_id);
  assert.equal((await post(admin.login, { email: 'ann@sec.test', password: PASSWORD })).code, 401);      // an ordinary account is not an admin
});

/* ── email OTP: the first sign-in on a new account ────────────────────────── */

// The real code is emailed, not returned to the caller (same reasoning as the password-reset test below not
// calling forgotPassword() to get a token) — write a known code's hash straight onto the row, the same way
// issueEmailOtp() would have, and drive verifyEmailOtp()/resendEmailOtp() against it for real.
const plantOtp = (userId, code, { expired = false } = {}) => pool.query(
  `UPDATE users SET email_otp_hash = $2, email_otp_expires_at = CURRENT_TIMESTAMP + INTERVAL '${expired ? '-1' : '10'} minutes' WHERE user_id = $1`,
  [userId, crypto.createHash('sha256').update(code).digest('hex')]
);

test('signup leaves the account unverified and hands back a challenge, not a session', { skip }, async () => {
  const res = await post(auth.signup, { name: 'Gia', email: 'gia@sec.test', phone: '9000000099', password: PASSWORD, business_name: 'Gia Co', business_type: 'RETAIL', accepted_terms: true });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.requires_email_otp, true);
  assert.ok(res.body.data.challenge);
  assert.equal(res.body.data.token, undefined);
  assert.equal(res.body.data.business, undefined);

  const row = (await pool.query(`SELECT user_id, email_verified, email_otp_hash, email_otp_expires_at FROM users WHERE email = 'gia@sec.test'`)).rows[0];
  assert.equal(row.email_verified, false);
  assert.ok(row.email_otp_hash, 'issueEmailOtp should have written a code hash');          // proves login()/signup() really call it
  assert.ok(new Date(row.email_otp_expires_at) > new Date());

  await plantOtp(row.user_id, '123456');
  const verified = await post(auth.verifyEmailOtp, { challenge: res.body.data.challenge, code: '123456' });
  assert.equal(verified.code, 200, JSON.stringify(verified.body));
  assert.ok(verified.body.data.token);
  assert.equal(verified.body.data.businesses.length, 1);
  assert.equal(verified.body.data.businesses[0].name, 'Gia Co');
  assert.equal((await pool.query(`SELECT email_verified, email_otp_hash FROM users WHERE user_id = $1`, [row.user_id])).rows[0].email_verified, true);
  assert.equal((await pool.query(`SELECT email_verified, email_otp_hash FROM users WHERE user_id = $1`, [row.user_id])).rows[0].email_otp_hash, null);   // spent
  assert.equal((await pool.query(`SELECT method FROM login_events WHERE user_id = $1 AND outcome = 'SUCCESS' ORDER BY event_id DESC LIMIT 1`, [row.user_id])).rows[0].method, 'EMAIL_OTP');

  // once verified, it never asks again
  assert.equal((await login('gia@sec.test')).body.data.requires_email_otp, undefined);
});

test('a login on an unverified account is gated the same way signup is, with a fresh code each time', { skip }, async () => {
  const heidi = await makeUser('heidi');
  await pool.query(`UPDATE users SET email_verified = FALSE WHERE user_id = $1`, [heidi.user_id]);   // simulate: never finished the first one

  const first = await login('heidi@sec.test');
  assert.equal(first.body.data.requires_email_otp, true);
  const firstHash = (await pool.query(`SELECT email_otp_hash FROM users WHERE user_id = $1`, [heidi.user_id])).rows[0].email_otp_hash;

  const second = await login('heidi@sec.test');       // tried again without ever entering the first code
  const secondHash = (await pool.query(`SELECT email_otp_hash FROM users WHERE user_id = $1`, [heidi.user_id])).rows[0].email_otp_hash;
  assert.notEqual(firstHash, secondHash, 'a new attempt should invalidate the old code');

  assert.equal((await post(auth.verifyEmailOtp, { challenge: 'garbage', code: '123456' })).code, 401);
  await plantOtp(heidi.user_id, '000111', { expired: true });
  const expired = await post(auth.verifyEmailOtp, { challenge: second.body.data.challenge, code: '000111' });
  assert.equal(expired.code, 401);
  assert.match(expired.body.message, /expired/);

  await plantOtp(heidi.user_id, '222333');
  const wrong = await post(auth.verifyEmailOtp, { challenge: second.body.data.challenge, code: '999999' });
  assert.equal(wrong.code, 401);
  // one for the expired code, one for the wrong one — the bad-challenge attempt above never reached the DB
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM login_events WHERE user_id = $1 AND outcome = 'EMAIL_OTP_FAILED'`, [heidi.user_id])).rows[0].n, 2);

  const right = await post(auth.verifyEmailOtp, { challenge: second.body.data.challenge, code: '222333' });
  assert.equal(right.code, 200, JSON.stringify(right.body));
  assert.ok(right.body.data.token);
});

test('resend sends a different code under the same challenge, and repeated wrong codes lock the account', { skip }, async () => {
  const ivan = await makeUser('ivan');
  await pool.query(`UPDATE users SET email_verified = FALSE WHERE user_id = $1`, [ivan.user_id]);
  const { challenge } = (await login('ivan@sec.test')).body.data;
  const before = (await pool.query(`SELECT email_otp_hash FROM users WHERE user_id = $1`, [ivan.user_id])).rows[0].email_otp_hash;

  const resent = await post(auth.resendEmailOtp, { challenge });
  assert.equal(resent.code, 200, JSON.stringify(resent.body));
  const after = (await pool.query(`SELECT email_otp_hash FROM users WHERE user_id = $1`, [ivan.user_id])).rows[0].email_otp_hash;
  assert.notEqual(before, after);
  // the reply carries a fresh sign-up session, so waiting on the code page does not outlive the new code
  assert.ok(resent.body.data.challenge, 'resend returns a session for the page to keep');
  assert.equal((await post(auth.resendEmailOtp, { challenge: resent.body.data.challenge })).code, 200, 'the renewed challenge works for the next resend');
  assert.equal((await post(auth.resendEmailOtp, { challenge: 'garbage' })).code, 401);

  for (let i = 0; i < 5; i += 1) assert.equal((await post(auth.verifyEmailOtp, { challenge, code: '000000' })).code, 401);
  const locked = await post(auth.verifyEmailOtp, { challenge, code: '000000' });
  assert.equal(locked.code, 429);
  assert.match(locked.body.message, /Try again in \d+ minute/);
});
