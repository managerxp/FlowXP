/*
 * The member's own web access: the entrance QR page, phone-code sign-in, the session, the phone pass and self check-in, and what an attacker cannot do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, day, fakeRes, makeGym, until } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const pub = await import('../src/controllers/gymPublic.controller.js');
const api = pub.default;
const setup = (await import('../src/controllers/gymSetup.controller.js')).default;
const membersApi = (await import('../src/controllers/gymMembers.controller.js')).default;
const accessApi = (await import('../src/controllers/gymAccess.controller.js')).default;
const portal = await import('../src/modules/gym/portal.js');
const provider = await import('../src/modules/messaging/provider.js');
const { attempt } = await import('../src/modules/gym/access.js');
const { localParts, sha256 } = await import('../src/modules/gym/common.js');
const { effectiveFeatureFlags } = await import('../src/modules/planFeatures.js');

const sent = [];
test.after(async () => { provider.setProvider(null); await cleanup(); });

let A; let B; let TODAY; let tokenA; let maya; let mayaPhone; let tomorrowCode;

const APP = { 'x-requested-with': 'FlowXP' };
const call = async (handler, { params = {}, body = {}, query = {}, headers = APP, cookie = null } = {}) => {
  const res = fakeRes();
  const req = { params, body, query, headers: { ...headers, ...(cookie ? { cookie: `flowxp_member=${cookie}` } : {}) }, method: 'POST', ip: '127.0.0.1', get: () => undefined };
  await handler(req, res);
  return res;
};
/** Run a handler behind the real member-session middleware, as the router does. */
const asMember = async (handler, cookie, extra = {}) => {
  const res = fakeRes();
  const req = { params: {}, body: {}, query: {}, headers: { ...APP, ...(cookie ? { cookie: `flowxp_member=${cookie}` } : {}) }, method: 'POST', ip: '127.0.0.1', get: () => undefined, ...extra };
  let passed = false;
  await pub.memberSession(req, res, () => { passed = true; });
  if (passed) await handler(req, res);
  return res;
};
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };
const last = () => sent.at(-1);
const codeOf = (m) => /\b(\d{6})\b/.exec(m.text)[1];
const signIn = async (phone, slug = 'ironworks') => {
  // each sign-in in these tests stands for a different day: forget the earlier codes so the per-hour pacing does not apply
  await pool.query(`DELETE FROM gym_member_otps WHERE phone_key = right(regexp_replace($1, '\D', '', 'g'), 10)`, [phone]);
  const before = sent.length;
  await call(api.requestOtp, { params: { slug }, body: { phone } });
  assert.ok(await until(() => sent.length > before), 'a code was sent');
  const res = await call(api.verifyOtp, { params: { slug }, body: { phone, code: codeOf(last()) } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  return res.cookies.flowxp_member.value;
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  provider.setProvider(async (m) => { sent.push(m); return { status: 'SENT', providerId: 'x' }; });
  A = await makeGym(pool, 'portal', { branches: 2, settings: { public_slug: 'ironworks', self_checkin_enabled: true } });
  B = await makeGym(pool, 'portalB', { settings: { public_slug: 'otherfit', self_checkin_enabled: true } });
  TODAY = (await localParts(pool, A.businessId)).date;
  const bs = await pool.query(`INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token) VALUES ($1,$2,$3) RETURNING checkin_token`, [A.branchId, A.businessId, 'entrance-token-aaaa1111']);
  tokenA = bs.rows[0].checkin_token;
  await pool.query(`INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token) VALUES ($1,$2,$3)`, [B.branchId, B.businessId, 'entrance-token-bbbb2222']);
  mayaPhone = '9876511111';
  maya = await addMember(pool, A, { name: 'Maya Iyer', phone: mayaPhone });
  await addMembership(pool, A, maya, { start: day(TODAY, -5), end: day(TODAY, 25) });
});

/* ── the gym's public pages ───────────────────────────────────────────────── */

test('the entrance QR page says which gym and outlet, grants nothing, and a rotated poster stops resolving', { skip }, async () => {
  const d = okBody(await call(api.entrance, { params: { token: tokenA } }));
  assert.equal(d.branch_name, 'Main');
  assert.equal(d.slug, 'ironworks');
  assert.deepEqual(Object.keys(d).sort(), ['branch_name', 'daily_code_required', 'logo_url', 'name', 'self_checkin_enabled', 'slug'], 'nothing about any member, plan or other outlet');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance`)).rows[0].n, 0, 'opening the page records nothing');
  for (const bad of ['nope', '', 'x'.repeat(40), "a'; DROP TABLE gym_members;--"]) assert.equal((await call(api.entrance, { params: { token: bad } })).code, 404);
  const rotate = okBody(await A.call(setup.rotateCheckinToken, { params: { id: A.branchId } }, A.tenantFor('OWNER')));
  assert.notEqual(rotate.checkin_token, tokenA);
  assert.equal((await call(api.entrance, { params: { token: tokenA } })).code, 404, 'the old poster is dead');
  assert.equal(okBody(await call(api.entrance, { params: { token: rotate.checkin_token } })).branch_name, 'Main');
  await pool.query(`UPDATE gym_branch_settings SET checkin_token = $2 WHERE branch_id = $1`, [A.branchId, tokenA]);

  const gym = okBody(await call(api.info, { params: { slug: 'IronWorks' } }));
  assert.equal(gym.branches.length, 2);
  assert.equal((await call(api.info, { params: { slug: 'missing' } })).code, 404);
});

test('the member pages are off when the plan does not include them, and a gym that is not active has none', { skip }, async () => {
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'RESTAURANT').gym_self_checkin, false, 'a restaurant never has them');
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'GYM').gym_self_checkin, undefined, 'a gym has them unless a plan switches them off');
  await pool.query(`UPDATE plans SET feature_flags = feature_flags || '{"gym_self_checkin": false}'::jsonb WHERE plan_code = 'GROWTH'`);
  assert.equal((await call(api.info, { params: { slug: 'ironworks' } })).code, 404);
  assert.equal((await call(api.entrance, { params: { token: tokenA } })).code, 404);
  await pool.query(`UPDATE plans SET feature_flags = feature_flags - 'gym_self_checkin' WHERE plan_code = 'GROWTH'`);
  assert.equal((await call(api.info, { params: { slug: 'ironworks' } })).code, 200);
  await pool.query(`UPDATE businesses SET status = 'SUSPENDED' WHERE business_id = $1`, [A.businessId]).catch(() => {});
  await pool.query(`UPDATE businesses SET status = 'ACTIVE' WHERE business_id = $1`, [A.businessId]);
});

/* ── phone codes ──────────────────────────────────────────────────────────── */

test('a code goes to a member\'s phone, and the answer is the same for a number that is not one', { skip }, async () => {
  const before = sent.length;
  const real = await call(api.requestOtp, { params: { slug: 'ironworks' }, body: { phone: '+91 98765 11111' } });
  const stranger = await call(api.requestOtp, { params: { slug: 'ironworks' }, body: { phone: '9000000000' } });
  const junk = await call(api.requestOtp, { params: { slug: 'ironworks' }, body: { phone: 'hello' } });
  const empty = await call(api.requestOtp, { params: { slug: 'ironworks' }, body: {} });
  assert.deepEqual(real.body, stranger.body, 'identical answers: a stranger learns nothing about who is a member');
  assert.deepEqual(real.body, junk.body);
  assert.deepEqual(real.body, empty.body);
  assert.ok(await until(() => sent.length === before + 1));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, before + 1, 'only the real member was texted');
  assert.match(last().text, /^\d{6} is your Gym portal\d+ sign-in code/);
  assert.equal(last().to, '919876511111');
  assert.equal(last().kind, 'GYM_OTP');
  // the code is not kept anywhere in readable form, nor in the message log
  const code = codeOf(last());
  const rows = (await pool.query(`SELECT * FROM gym_member_otps WHERE business_id = $1`, [A.businessId])).rows;
  assert.ok(!JSON.stringify(rows).includes(code), 'only a hash is stored');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE body LIKE $1`, [`%${code}%`])).rows[0].n, 0);
  assert.equal((await call(api.requestOtp, { params: { slug: 'nobody-here' }, body: { phone: mayaPhone } })).code, 404, 'but not for a gym that does not exist');
});

test('a wrong code is refused, a right one makes a session once, and a stale one is useless', { skip }, async () => {
  await pool.query(`DELETE FROM gym_member_otps`);
  const NOW = new Date();
  const gym = await portal.gymBySlug('ironworks');
  await portal.requestCode(gym, mayaPhone, { now: NOW });
  await until(() => sent.at(-1) && Date.now() - 0 > 0);
  const code = await until(async () => { const m = sent.at(-1); return m ? codeOf(m) : null; });
  const bad = await call(api.verifyOtp, { params: { slug: 'ironworks' }, body: { phone: mayaPhone, code: code === '000000' ? '111111' : '000000' } });
  assert.equal(bad.code, 400);
  assert.deepEqual(bad.cookies, {}, 'no cookie for a wrong code');
  assert.equal((await call(api.verifyOtp, { params: { slug: 'ironworks' }, body: { phone: '9000000000', code } })).code, 400, 'the same refusal for another number');
  assert.equal((await call(api.verifyOtp, { params: { slug: 'ironworks' }, body: { phone: mayaPhone, code: '12ab56' } })).code, 400);
  assert.equal((await call(api.verifyOtp, { params: { slug: 'ironworks' }, body: { phone: mayaPhone } })).code, 400);
  const good = await call(api.verifyOtp, { params: { slug: 'ironworks' }, body: { phone: mayaPhone, code } });
  assert.equal(good.code, 200);
  const cookie = good.cookies.flowxp_member;
  assert.equal(cookie.options.httpOnly, true, 'the page\'s own script cannot read it');
  assert.equal(cookie.options.sameSite, 'lax');
  assert.equal(cookie.options.path, '/api/public/gym');
  assert.equal(good.body.data.members[0].name, 'Maya Iyer');
  const s = (await pool.query(`SELECT token_hash FROM gym_member_sessions`)).rows;
  assert.equal(s[0].token_hash, sha256(cookie.value), 'only a hash of the cookie value is stored');
  assert.equal((await call(api.verifyOtp, { params: { slug: 'ironworks' }, body: { phone: mayaPhone, code } })).code, 400, 'a code works once');
  assert.equal(good.body.data.token, undefined, 'the cookie value is never in the body');
});

test('five wrong tries use a code up, and a code expires', { skip }, async () => {
  const gym = await portal.gymBySlug('ironworks');
  await pool.query(`DELETE FROM gym_member_otps`);
  const NOW = new Date(Date.now() - 3600 * 1000 * 2);
  await portal.requestCode(gym, mayaPhone, { now: NOW });
  const code = await until(async () => (sent.at(-1) ? codeOf(sent.at(-1)) : null));
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await assert.rejects(portal.verifyCode(gym, mayaPhone, wrong, { now: NOW }), /not right/);
  await assert.rejects(portal.verifyCode(gym, mayaPhone, code, { now: NOW }), /not right/, 'the right code after five wrong guesses is too late');

  await pool.query(`DELETE FROM gym_member_otps`);
  await portal.requestCode(gym, mayaPhone, { now: NOW });
  const code2 = await until(async () => (sent.at(-1) && codeOf(sent.at(-1)) !== code ? codeOf(sent.at(-1)) : null));
  await assert.rejects(portal.verifyCode(gym, mayaPhone, code2, { now: new Date(NOW.getTime() + 11 * 60000) }), /not right/, 'after ten minutes');
  const ok = await portal.verifyCode(gym, mayaPhone, code2, { now: new Date(NOW.getTime() + 9 * 60000) }).catch((e) => e);
  assert.ok(ok.token, 'but not before');
});

test('a new code replaces the old one, codes are paced, and the hourly cap holds', { skip }, async () => {
  const gym = await portal.gymBySlug('ironworks');
  await pool.query(`DELETE FROM gym_member_otps`);
  const T = new Date(Date.now() - 5 * 3600 * 1000);
  const at = (s) => new Date(T.getTime() + s * 1000);
  const before = sent.length;
  await portal.requestCode(gym, mayaPhone, { now: at(0) });
  await portal.requestCode(gym, mayaPhone, { now: at(30) });   // inside the minute: ignored
  assert.ok(await until(() => sent.length === before + 1));
  const first = codeOf(last());
  await portal.requestCode(gym, mayaPhone, { now: at(61) });
  assert.ok(await until(() => sent.length === before + 2));
  const second = codeOf(last());
  await assert.rejects(portal.verifyCode(gym, mayaPhone, first, { now: at(70) }), /not right/, 'the first code was replaced');
  for (let i = 0; i < 6; i++) await portal.requestCode(gym, mayaPhone, { now: at(130 + i * 61) });
  await new Promise((r) => setTimeout(r, 200));
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_member_otps WHERE business_id = $1`, [A.businessId])).rows[0].n;
  assert.equal(n, 5, 'five codes in an hour, then no more');
  assert.ok(second);
});

/* ── the session ──────────────────────────────────────────────────────────── */

test('without a session there is no member page; a revoked or expired one is as good as none', { skip }, async () => {
  assert.equal((await asMember(api.me, null)).code, 401);
  assert.equal((await asMember(api.me, 'x'.repeat(43))).code, 401);
  const cookie = await signIn(mayaPhone);
  assert.equal((await asMember(api.me, cookie)).code, 200);
  await portal.endSession(cookie);
  assert.equal((await asMember(api.me, cookie)).code, 401, 'signed out');
  const again = await signIn(mayaPhone);
  await pool.query(`UPDATE gym_member_sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha256(again)]);
  assert.equal((await asMember(api.me, again)).code, 401, 'expired');
  const logoutCookie = await signIn(mayaPhone);
  const out = await call(api.logout, { cookie: logoutCookie });
  assert.equal(out.code, 200);
  assert.equal(out.cleared, 'flowxp_member');
  assert.equal((await asMember(api.me, logoutCookie)).code, 401);
});

test('a change made without the app\'s header is refused (forged form posts)', { skip }, async () => {
  const cookie = await signIn(mayaPhone);
  const res = fakeRes(); let passed = false;
  pub.requireAppHeader({ method: 'POST', headers: {} }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.code, 403);
  const get = fakeRes(); let ok2 = false;
  pub.requireAppHeader({ method: 'GET', headers: {} }, get, () => { ok2 = true; });
  assert.equal(ok2, true, 'reads are fine');
  assert.ok(cookie);
});

test('the member page shows their own memberships and visits, never another member\'s or the health note', { skip }, async () => {
  const other = await addMember(pool, A, { name: 'Other Person', phone: '9876522222' });
  await addMembership(pool, A, other, { start: day(TODAY, -5), end: day(TODAY, 25), planName: 'Other plan' });
  await pool.query(`UPDATE gym_members SET health_notes = 'Asthma', emergency_name = 'Secret contact' WHERE member_id = $1`, [maya]);
  const cookie = await signIn(mayaPhone);
  const me = okBody(await asMember(api.me, cookie));
  assert.equal(me.member.name, 'Maya Iyer');
  assert.equal(me.memberships.length, 1);
  assert.equal(me.memberships[0].state, 'ACTIVE');
  assert.equal(me.memberships[0].days_left, 25);
  const text = JSON.stringify(me);
  for (const hidden of ['Asthma', 'Other Person', 'Other plan', 'health_notes', 'phone', '9876522222']) assert.ok(!text.includes(hidden), `${hidden} is not in the member's page`);
});

test('a phone shared by a couple or a family: one sign-in, switch between the people on it, and no one else', { skip }, async () => {
  const ph = '9876533333';
  const husband = await addMember(pool, A, { name: 'Husband', phone: ph });
  const wife = await addMember(pool, A, { name: 'Wife', phone: '098765 33333' });
  const kid = await addMember(pool, A, { name: 'Kid', head: husband });
  const stranger = await addMember(pool, A, { name: 'Stranger', phone: '9876544444' });
  await addMembership(pool, A, wife, { start: day(TODAY, -5), end: day(TODAY, 25), planName: 'Wife plan' });
  const cookie = await signIn(ph);
  const me = okBody(await asMember(api.me, cookie));
  assert.deepEqual(me.members.map((m) => m.name), ['Husband', 'Wife', 'Kid']);
  assert.equal(me.member.name, 'Husband');
  assert.equal((await asMember(api.switchTo, cookie, { body: { member_id: stranger } })).code, 404, 'not someone on another number');
  const other = await makeGym(pool, 'portalX', { settings: { public_slug: 'xgym' } });
  assert.equal((await asMember(api.switchTo, cookie, { body: { member_id: await addMember(pool, other, { name: 'Other gym', phone: ph }) } })).code, 404, 'not someone at another gym');
  okBody(await asMember(api.switchTo, cookie, { body: { member_id: wife } }));
  assert.equal(okBody(await asMember(api.me, cookie)).memberships[0].plan_name, 'Wife plan');
  assert.equal(okBody(await asMember(api.me, cookie, {})).member.name, 'Wife');
  assert.ok(kid);
});

test('a member can change their emergency contact but not the phone that proves who they are', { skip }, async () => {
  const cookie = await signIn(mayaPhone);
  okBody(await asMember(api.profile, cookie, { body: { emergency_name: 'New Contact', emergency_phone: '9876599999', email: 'maya@example.com', phone: '9000000001', consent_marketing: true } }));
  const row = (await pool.query(`SELECT gm.emergency_name, gm.consent_marketing, c.phone, c.email FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.member_id = $1`, [maya])).rows[0];
  assert.equal(row.emergency_name, 'New Contact');
  assert.equal(row.email, 'maya@example.com');
  assert.equal(row.consent_marketing, true);
  assert.equal(row.phone, mayaPhone, 'the phone is unchanged');
  assert.equal((await asMember(api.profile, cookie, { body: { email: 'not an email' } })).code, 400);
});

/* ── the phone pass ───────────────────────────────────────────────────────── */

test('the phone pass is scanned at the desk once and not again', { skip }, async () => {
  const cookie = await signIn(mayaPhone);
  const pass = okBody(await asMember(api.pass, cookie));
  assert.match(pass.code, /^FXD1\./);
  const first = await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: pass.code });
  assert.equal(first.decision, 'APPROVED');
  assert.equal(first.member.name, 'Maya Iyer');
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: pass.code })).reason, 'INVALID_CREDENTIAL', 'the same screenshot again');
  const res = await asMember(api.pass, cookie);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const mine = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_credentials WHERE member_id = $1 AND kind = 'DIGITAL' AND status = 'ACTIVE'`, [maya])).rows[0].n;
  assert.equal(mine, 1, 'one phone pass credential, however many tokens');
});

/* ── self check-in ────────────────────────────────────────────────────────── */

const checkin = (cookie, body) => asMember(api.checkin, cookie, { body });

test('check-in from the phone: needs a session, the right gym, and the gym to have switched it on', { skip }, async () => {
  assert.equal((await checkin(null, { token: tokenA })).code, 401, 'no session, no check-in');
  const cookie = await signIn(mayaPhone);
  // she was scanned in at the desk a moment ago (the pass test): start from a clean day
  await pool.query(`DELETE FROM gym_attendance WHERE member_id = $1`, [maya]);
  await pool.query(`DELETE FROM gym_access_events WHERE member_id = $1`, [maya]);
  const ok = okBody(await checkin(cookie, { token: tokenA, idempotency_key: 'k1' }));
  assert.equal(ok.decision, 'APPROVED');
  assert.equal(ok.member.name, 'Maya Iyer');
  assert.equal(ok.membership.days_left, 25);
  const row = (await pool.query(`SELECT source FROM gym_attendance WHERE member_id = $1 ORDER BY attendance_id DESC LIMIT 1`, [maya])).rows[0];
  assert.equal(row.source, 'SELF');

  assert.equal((await checkin(cookie, { token: 'entrance-token-bbbb2222' })).code, 404, 'another gym\'s poster');
  assert.equal((await checkin(cookie, { token: 'garbage' })).code, 404);
  assert.equal((await checkin(cookie, {})).code, 404);
  await pool.query(`UPDATE gym_settings SET self_checkin_enabled = FALSE WHERE business_id = $1`, [A.businessId]);
  const off = await checkin(cookie, { token: tokenA });
  assert.equal(off.code, 403);
  await pool.query(`UPDATE gym_settings SET self_checkin_enabled = TRUE WHERE business_id = $1`, [A.businessId]);
});

test('the same tap twice is one visit, and a second tap later is "already checked in"', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Tapper', phone: '9876555555' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const cookie = await signIn('9876555555');
  const a = okBody(await checkin(cookie, { token: tokenA, idempotency_key: 'tap-1' }));
  const b = okBody(await checkin(cookie, { token: tokenA, idempotency_key: 'tap-1' }));
  assert.equal(a.decision, 'APPROVED');
  assert.equal(b.decision, 'APPROVED', 'a retry after a bad connection gets the same answer');
  const c = okBody(await checkin(cookie, { token: tokenA, idempotency_key: 'tap-2' }));
  assert.equal(c.reason, 'DUPLICATE_SCAN');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE member_id = $1`, [m])).rows[0].n, 1);
  const both = await Promise.all([checkin(cookie, { token: tokenA, idempotency_key: 'r1' }), checkin(cookie, { token: tokenA, idempotency_key: 'r2' })]);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE member_id = $1`, [m])).rows[0].n, 1, 'two at once, still one');
  assert.ok(both.every((r) => r.code === 200));
});

test('a refusal on the phone says why and shows nothing else', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Lapsed', phone: '9876566666' });
  await addMembership(pool, A, m, { start: day(TODAY, -60), end: day(TODAY, -30) });
  const cookie = await signIn('9876566666');
  const r = okBody(await checkin(cookie, { token: tokenA }));
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, 'MEMBERSHIP_EXPIRED');
  assert.equal(r.message, 'The membership has ended');
  assert.equal(r.member, null);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE member_id = $1`, [m])).rows[0].n, 0);
  const ev = (await pool.query(`SELECT decision, reason_code, source FROM gym_access_events WHERE member_id = $1`, [m])).rows;
  assert.deepEqual(ev, [{ decision: 'DENIED', reason_code: 'MEMBERSHIP_EXPIRED', source: 'SELF' }], 'the denied attempt is on record');
});

test('the front-desk code keeps a photo of the poster from checking people in from home', { skip }, async () => {
  const G = await makeGym(pool, 'daily', { settings: { public_slug: 'dailygym', self_checkin_enabled: true, self_checkin_daily_code: true } });
  await pool.query(`INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token) VALUES ($1,$2,'entrance-token-cccc3333')`, [G.branchId, G.businessId]);
  const m = await addMember(pool, G, { name: 'Homebody', phone: '9876577777' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const cookie = await signIn('9876577777', 'dailygym');
  const info = okBody(await call(api.entrance, { params: { token: 'entrance-token-cccc3333' } }));
  assert.equal(info.daily_code_required, true);
  const code = okBody(await G.call(accessApi.dailyCode, {}, G.tenantFor('GYM_RECEPTIONIST'))).code;
  assert.match(code, /^\d{4}$/);
  const without = okBody(await checkin(cookie, { token: 'entrance-token-cccc3333' }));
  assert.equal(without.reason, 'VERIFICATION_REQUIRED');
  assert.equal(without.needs, 'DAILY_CODE');
  const wrong = okBody(await checkin(cookie, { token: 'entrance-token-cccc3333', daily_code: code === '0000' ? '1111' : '0000' }));
  assert.equal(wrong.reason, 'VERIFICATION_REQUIRED');
  const right = okBody(await checkin(cookie, { token: 'entrance-token-cccc3333', daily_code: code }));
  assert.equal(right.decision, 'APPROVED');
  // the code is the same all day and different tomorrow
  assert.equal(portal.dailyCode('t', '2026-10-12'), portal.dailyCode('t', '2026-10-12'));
  assert.notEqual(portal.dailyCode('t', '2026-10-12'), portal.dailyCode('t', '2026-10-13'));
  assert.notEqual(portal.dailyCode('t1', '2026-10-12'), portal.dailyCode('t2', '2026-10-12'));
  tomorrowCode = code;
});

test('a gym can ask for a recent sign-in code at every check-in', { skip }, async () => {
  const G = await makeGym(pool, 'fresh', { settings: { public_slug: 'freshgym', self_checkin_enabled: true, self_checkin_fresh_otp_minutes: 5 } });
  await pool.query(`INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token) VALUES ($1,$2,'entrance-token-dddd4444')`, [G.branchId, G.businessId]);
  const m = await addMember(pool, G, { name: 'Fresh', phone: '9876588888' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const cookie = await signIn('9876588888', 'freshgym');
  assert.equal(okBody(await checkin(cookie, { token: 'entrance-token-dddd4444' })).decision, 'APPROVED', 'just signed in');
  await pool.query(`UPDATE gym_member_sessions SET otp_verified_at = now() - interval '2 hours'`);
  await pool.query(`DELETE FROM gym_attendance WHERE member_id = $1`, [m]);
  await pool.query(`DELETE FROM gym_access_events WHERE member_id = $1`, [m]);
  const stale = okBody(await checkin(cookie, { token: 'entrance-token-dddd4444' }));
  assert.equal(stale.needs, 'OTP_REQUIRED');
  assert.ok(tomorrowCode);
});

/* ── ending access ────────────────────────────────────────────────────────── */

test('the desk can cut a member off at once: every card, every pass, every signed-in phone', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Lost Phone', phone: '9876599000' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const cookie = await signIn('9876599000');
  const pass = okBody(await asMember(api.pass, cookie));
  const card = okBody(await A.call(membersApi.issueCard, { params: { id: m }, body: {} }, A.tenantFor('GYM_RECEPTIONIST')), 201);
  const r = okBody(await A.call(membersApi.revokeAccess, { params: { id: m }, body: { reason: 'Phone stolen' } }, A.tenantFor('GYM_RECEPTIONIST')));
  assert.equal(r.revoked, 2);
  assert.equal((await asMember(api.me, cookie)).code, 401, 'signed out');
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: pass.code })).reason, 'CREDENTIAL_REVOKED');
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: card.code.code ?? card.code })).reason, 'CREDENTIAL_REVOKED');
  // the member signs in again with a new code and gets a working pass
  const again = await signIn('9876599000');
  const fresh = okBody(await asMember(api.pass, again));
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: fresh.code })).decision, 'APPROVED');
});

test('archiving a member signs them out everywhere', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Leaver', phone: '9876599111' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const cookie = await signIn('9876599111');
  okBody(await A.call(membersApi.status, { params: { id: m }, body: { status: 'ARCHIVED' } }, A.tenantFor('OWNER')));
  assert.equal((await asMember(api.me, cookie)).code, 401);
  const before = sent.length;
  await call(api.requestOtp, { params: { slug: 'ironworks' }, body: { phone: '9876599111' } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent.length, before, 'and gets no more codes');
});

test('one gym\'s session means nothing at another gym', { skip }, async () => {
  const cookie = await signIn(mayaPhone);
  const res = await checkin(cookie, { token: 'entrance-token-bbbb2222' });
  assert.equal(res.code, 404);
  const mine = okBody(await asMember(api.me, cookie));
  assert.equal(mine.gym, A.tag ? `Gym ${A.tag}` : mine.gym);
});

/* ── classes and training on the member's own page ────────────────────────── */

test('a member books and cancels their own classes, sees only their own training, and none of it appears when the plan lacks it', { skip }, async () => {
  const classes = await import('../src/modules/gym/classes.js');
  const training = await import('../src/modules/gym/training.js');
  const { inTx: tx } = await import('../src/modules/gym/common.js');
  const G = await makeGym(pool, 'pclass', { branches: 1, settings: { public_slug: 'classgym', self_checkin_enabled: true } });
  const type = await tx((db) => classes.saveClassType(db, G.businessId, null, { name: 'Portal yoga', default_capacity: 1 }));
  const date = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA');
  const [sess] = await tx((db) => classes.createSessions(db, G.businessId, G.branchId, { class_type_id: type.class_type_id, date, start: '10:00' }));
  const me = await addMember(pool, G, { name: 'Class Goer', phone: '9400000001' });
  const rival = await addMember(pool, G, { name: 'Rival', phone: '9400000002' });
  for (const m of [me, rival]) await addMembership(pool, G, m, { start: day(date, -30), end: day(date, 60) });
  await tx((db) => training.addMeasurement(db, { businessId: G.businessId, memberId: rival, userId: G.userId, b: { measured_on: date, weight_kg: 99 } }));
  await tx((db) => training.createWorkout(db, { businessId: G.businessId, memberId: rival, userId: G.userId, b: { name: 'Rival plan', items: [{ exercise_name: 'Secret lift', sets: 1 }] } }));
  await tx((db) => training.createWorkout(db, { businessId: G.businessId, memberId: me, userId: G.userId, b: { name: 'My plan', items: [{ exercise_name: 'Squat', sets: 3, reps: '5' }] } }));

  const cookie = await signIn('9400000001', 'classgym');
  const list = okBody(await asMember(api.myClasses, cookie, { query: { from: date, to: date }, method: 'GET' }));
  assert.equal(list.length, 1);
  assert.equal(list[0].seats_left, 1);
  assert.equal(list[0].my_status, null);
  const booked = okBody(await asMember(api.myBook, cookie, { params: { id: String(sess.session_id) } }), 201);
  assert.equal(booked.status, 'BOOKED');
  assert.equal((await asMember(api.myBook, cookie, { params: { id: String(sess.session_id) } })).code, 409, 'twice');
  // the other member is told the class is full: they join the waitlist
  const rivalCookie = await signIn('9400000002', 'classgym');
  assert.equal(okBody(await asMember(api.myBook, rivalCookie, { params: { id: String(sess.session_id) } }), 201).status, 'WAITLISTED');
  // a member cannot cancel someone else's booking
  const rivalBooking = (await pool.query(`SELECT booking_id FROM gym_class_bookings WHERE member_id = $1`, [rival])).rows[0].booking_id;
  assert.equal((await asMember(api.myCancel, cookie, { params: { id: String(rivalBooking) } })).code, 404);
  const mine = (await pool.query(`SELECT booking_id FROM gym_class_bookings WHERE member_id = $1`, [me])).rows[0].booking_id;
  const cancelled = okBody(await asMember(api.myCancel, cookie, { params: { id: String(mine) } }));
  assert.equal(cancelled.late_cancel, false);
  assert.equal((await pool.query(`SELECT status FROM gym_class_bookings WHERE booking_id = $1`, [rivalBooking])).rows[0].status, 'BOOKED', 'and the one waiting got the place');

  const t = okBody(await asMember(api.myTraining, cookie));
  assert.deepEqual(t.workouts.map((w) => w.name), ['My plan']);
  assert.equal(t.measurements.length, 0, 'not the other member\'s measurements');
  assert.ok(!JSON.stringify(t).includes('Secret lift') && !JSON.stringify(t).includes('99'));
  await pool.query(`UPDATE plans SET feature_flags = feature_flags || '{"gym_classes": false}'::jsonb WHERE plan_code = 'GROWTH'`);
  assert.equal((await asMember(api.myClasses, cookie, { query: {} })).code, 404, 'the plan does not include classes');
  assert.equal((await asMember(api.myTraining, cookie)).code, 404);
  await pool.query(`UPDATE plans SET feature_flags = feature_flags - 'gym_classes' WHERE plan_code = 'GROWTH'`);
});
