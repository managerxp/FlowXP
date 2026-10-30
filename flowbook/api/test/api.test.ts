import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
const app = buildApp({ pool, allowedOrigins: ['https://app.flowbook.test'], limits: { register: 1000 } });
test.after(async () => { await app.close(); await cleanup(); });

type Res = { status: number; body: any; cookie: string | undefined };
const call = async (method: string, url: string, o: { token?: string; cookie?: string; origin?: string; body?: unknown; key?: string } = {}): Promise<Res> => {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin) headers.origin = o.origin;
  if (o.key) headers['idempotency-key'] = o.key;
  const r = await app.inject({ method: method as 'GET', url, headers, payload: o.body as object | undefined });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, cookie: r.headers['set-cookie'] as string | undefined };
};

const PASSWORD = 'correct horse battery';
let n = 0;
const signUp = async (name = 'Asha') => {
  n += 1;
  const email = `user${n}@example.com`;
  const r = await call('POST', '/v1/auth/register', { body: { name, email, password: PASSWORD } });
  assert.equal(r.status, 201);
  return { token: r.body.token as string, email, id: r.body.user.id as string };
};
const makeOrg = async (token: string, name = 'Asha Cafe') => (await call('POST', '/v1/organizations', { token, body: { name, fyStartYear: 2026 } })).body.id as string;
const journal = (org: string, token: string, key: string, extra: object = {}) => call('POST', `/v1/orgs/${org}/journals`, { token, key, body: {
  date: '2026-06-10', memo: 'cash sale', lines: [{ account: 'CASH', side: 'D', amount: '1180.00' }, { account: 'SALES', side: 'C', amount: '1000.00' }, { account: 'OUTPUT_CGST', side: 'C', amount: '90.00' }, { account: 'OUTPUT_SGST', side: 'C', amount: '90.00' }], ...extra } });

test('register, sign in, who am I, sign out; a wrong password and an unknown email look the same', { skip }, async () => {
  const email = 'login@example.com';
  assert.equal((await call('POST', '/v1/auth/register', { body: { name: 'L', email, password: 'short' } })).body.error.code, 'weak_password');
  const reg = await call('POST', '/v1/auth/register', { body: { name: 'L', email, password: PASSWORD } });
  assert.equal(reg.status, 201);
  assert.match(reg.cookie ?? '', /fb_session=.+HttpOnly.+SameSite=Lax/);
  assert.equal((await call('POST', '/v1/auth/register', { body: { name: 'L', email: email.toUpperCase(), password: PASSWORD } })).status, 409);

  const bad = await call('POST', '/v1/auth/login', { body: { email, password: 'wrong password!' } });
  const unknown = await call('POST', '/v1/auth/login', { body: { email: 'nobody@example.com', password: 'wrong password!' } });
  assert.equal(bad.status, 401); assert.deepEqual(bad.body, unknown.body);

  const login = await call('POST', '/v1/auth/login', { body: { email, password: PASSWORD } });
  assert.equal(login.status, 200);
  const who = await call('GET', '/v1/me', { token: login.body.token });
  assert.equal(who.body.user.email, email); assert.deepEqual(who.body.organizations, []);
  assert.equal((await call('GET', '/v1/me')).status, 401);
  assert.equal((await call('GET', '/v1/me', { token: 'not-a-token' })).status, 401);

  assert.equal((await call('POST', '/v1/auth/logout', { token: login.body.token })).status, 200);
  assert.equal((await call('GET', '/v1/me', { token: login.body.token })).status, 401, 'the ended session no longer works');
  const stored = (await pool.query(`SELECT password_hash FROM users WHERE email = $1`, [email])).rows[0].password_hash as string;
  assert.match(stored, /^argon2id\$/); assert.ok(!stored.includes(PASSWORD));
});

test('repeated wrong passwords are throttled', { skip }, async () => {
  const { email } = await signUp();
  let last = 0;
  for (let i = 0; i < 10; i += 1) last = (await call('POST', '/v1/auth/login', { body: { email, password: 'nope nope nope' } })).status;
  assert.equal(last, 429);
});

test('a cookie session cannot change anything from another origin (CSRF); a bearer token is not affected', { skip }, async () => {
  const reg = await call('POST', '/v1/auth/register', { body: { name: 'C', email: 'csrf@example.com', password: PASSWORD } });
  const cookie = (reg.cookie ?? '').split(';')[0] as string;
  const org = { name: 'X' };
  assert.equal((await call('POST', '/v1/organizations', { cookie, origin: 'https://evil.example', body: org })).status, 403);
  assert.equal((await call('POST', '/v1/organizations', { cookie, body: org })).status, 403, 'no Origin header at all is also refused for a cookie');
  assert.equal((await call('POST', '/v1/organizations', { cookie, origin: 'https://app.flowbook.test', body: org })).status, 201);
  assert.equal((await call('GET', '/v1/me', { cookie })).status, 200, 'reads need no origin');
  assert.equal((await call('POST', '/v1/organizations', { token: reg.body.token, body: { name: 'Y' } })).status, 201);
});

test('creating an organization gives its chart of accounts, a financial year and an owner; templates apply', { skip }, async () => {
  const { token } = await signUp();
  const org = await makeOrg(token);
  const me = await call('GET', '/v1/me', { token });
  assert.deepEqual(me.body.organizations.map((o: any) => [o.id, o.role]), [[org, 'owner']]);
  const accounts = await call('GET', `/v1/orgs/${org}/accounts`, { token });
  assert.ok(accounts.body.length > 30); assert.ok(accounts.body.some((a: any) => a.system_key === 'AR'));
  assert.equal((await call('GET', `/v1/orgs/${org}/periods`, { token })).body.length, 12);
  assert.equal((await call('POST', '/v1/organizations', { token, body: { name: 'Gym', template: 'GYM' } })).status, 201);
  assert.equal((await call('POST', '/v1/organizations', { token, body: { name: 'Bad', template: 'NOPE' } })).status, 400);
  assert.equal((await call('POST', '/v1/organizations', { token, body: { name: 'Bad', pan: 'abc' } })).status, 400);
});

test('post a journal with an Idempotency-Key: retries return the same entry, and the key is required', { skip }, async () => {
  const { token } = await signUp();
  const org = await makeOrg(token);
  assert.equal((await call('POST', `/v1/orgs/${org}/journals`, { token, body: { date: '2026-06-10', lines: [] } })).status, 400);
  const noKey = await call('POST', `/v1/orgs/${org}/journals`, { token, body: { date: '2026-06-10', lines: [{ account: 'CASH', side: 'D', amount: '1.00' }, { account: 'SALES', side: 'C', amount: '1.00' }] } });
  assert.equal(noKey.body.error.code, 'idempotency_key_required');
  const first = await journal(org, token, 'key-0001-aaaa');
  assert.equal(first.status, 201); assert.equal(first.body.entryNo, 'JE-000001'); assert.equal(first.body.replayed, false);
  const again = await journal(org, token, 'key-0001-aaaa');
  assert.equal(again.status, 200); assert.equal(again.body.id, first.body.id); assert.equal(again.body.replayed, true);
  const unbalanced = await call('POST', `/v1/orgs/${org}/journals`, { token, key: 'key-0002-bbbb', body: { date: '2026-06-10', lines: [{ account: 'CASH', side: 'D', amount: '100.00' }, { account: 'SALES', side: 'C', amount: '99.99' }] } });
  assert.equal(unbalanced.status, 422); assert.equal(unbalanced.body.error.code, 'unbalanced');
  assert.equal((await call('POST', `/v1/orgs/${org}/journals`, { token, key: 'key-0003-cccc', body: { date: '2026-06-10', lines: [{ account: 'CASH', side: 'D', amount: '10.123' }, { account: 'SALES', side: 'C', amount: '10.12' }] } })).status, 400, 'three decimals are refused');
  assert.equal((await call('POST', `/v1/orgs/${org}/journals`, { token, key: 'key-0004-dddd', body: { date: '2031-06-10', lines: [{ account: 'CASH', side: 'D', amount: '1.00' }, { account: 'SALES', side: 'C', amount: '1.00' }] } })).body.error.code, 'no_period');

  const detail = await call('GET', `/v1/orgs/${org}/journals/${first.body.id}`, { token });
  assert.equal(detail.body.status, 'POSTED');
  assert.deepEqual(detail.body.lines.map((l: any) => [l.account_code, l.side, l.amount]), [['1000', 'D', '1180.00'], ['4000', 'C', '1000.00'], ['2100', 'C', '90.00'], ['2101', 'C', '90.00']]);
  const list = await call('GET', `/v1/orgs/${org}/journals?from=2026-06-01&to=2026-06-30`, { token });
  assert.equal(list.body.entries.length, 1); assert.equal(list.body.entries[0].total, '1180.00');
});

test('reports over the API: trial balance, profit and loss, balance sheet, and the self-check', { skip }, async () => {
  const { token } = await signUp();
  const org = await makeOrg(token);
  await journal(org, token, 'rep-0001-aaaa');
  const tb = await call('GET', `/v1/orgs/${org}/reports/trial-balance?to=2026-12-31`, { token });
  assert.equal(tb.body.balanced, true); assert.equal(tb.body.totalDebit, '1180.00');
  const pl = await call('GET', `/v1/orgs/${org}/reports/profit-and-loss?from=2026-04-01&to=2027-03-31`, { token });
  assert.equal(pl.body.netProfit, '1000.00');
  const bs = await call('GET', `/v1/orgs/${org}/reports/balance-sheet?asOf=2026-12-31`, { token });
  assert.equal(bs.body.balanced, true); assert.equal(bs.body.totalAssets, '1180.00');
  assert.deepEqual((await call('GET', `/v1/orgs/${org}/reports/reconcile`, { token })).body, { issues: [] });
  assert.equal((await call('GET', `/v1/orgs/${org}/reports/trial-balance`, { token })).status, 400, 'a date is required');
});

test('reverse over the API; a second reversal is refused; the audit log shows who did what', { skip }, async () => {
  const { token } = await signUp('Ravi');
  const org = await makeOrg(token);
  const j = await journal(org, token, 'rev-0001-aaaa');
  const rev = await call('POST', `/v1/orgs/${org}/journals/${j.body.id}/reverse`, { token, body: { date: '2026-06-11', reason: 'entered twice' } });
  assert.equal(rev.status, 201); assert.equal(rev.body.entryNo, 'JE-000002');
  assert.equal((await call('POST', `/v1/orgs/${org}/journals/${j.body.id}/reverse`, { token, body: { date: '2026-06-12', reason: 'again' } })).body.error.code, 'already_reversed');
  assert.equal((await call('GET', `/v1/orgs/${org}/reports/profit-and-loss?from=2026-04-01&to=2027-03-31`, { token })).body.netProfit, '0.00');
  const audit = (await call('GET', `/v1/orgs/${org}/audit?limit=20`, { token })).body as any[];
  assert.ok(audit.some((a) => a.action === 'journal.reversed' && /^user:\d+$/.test(a.actor)));
});

test('roles: a viewer reads but cannot post; an auditor sees the audit log; a salesperson sees nothing of the books', { skip }, async () => {
  const owner = await signUp('Owner'); const viewer = await signUp('Viewer'); const auditor = await signUp('Auditor'); const sales = await signUp('Sales');
  const org = await makeOrg(owner.token);
  for (const [u, role] of [[viewer, 'viewer'], [auditor, 'auditor'], [sales, 'sales']] as const) {
    assert.equal((await call('POST', `/v1/orgs/${org}/members`, { token: owner.token, body: { email: u.email, role } })).status, 201);
  }
  assert.equal((await call('POST', `/v1/orgs/${org}/members`, { token: owner.token, body: { email: 'ghost@example.com', role: 'viewer' } })).body.error.code, 'no_such_user');
  await journal(org, owner.token, 'role-0001-aaaa');

  assert.equal((await call('GET', `/v1/orgs/${org}/reports/trial-balance?to=2026-12-31`, { token: viewer.token })).status, 200);
  assert.equal((await journal(org, viewer.token, 'role-0002-bbbb')).status, 403);
  assert.equal((await call('GET', `/v1/orgs/${org}/audit`, { token: viewer.token })).status, 403);
  assert.equal((await call('GET', `/v1/orgs/${org}/audit`, { token: auditor.token })).status, 200);
  assert.equal((await call('GET', `/v1/orgs/${org}/reports/trial-balance?to=2026-12-31`, { token: sales.token })).status, 403);
  assert.equal((await call('GET', `/v1/orgs/${org}/accounts`, { token: sales.token })).status, 200);
  assert.equal((await call('GET', `/v1/orgs/${org}/members`, { token: viewer.token })).status, 403);
  assert.equal((await call('PUT', `/v1/orgs/${org}/periods`, { token: viewer.token, body: { date: '2026-06-01', status: 'CLOSED' } })).status, 403);
});

test('a site supervisor can record stock and see projects, but sees no invoices, payments or reports', { skip }, async () => {
  const owner = await signUp('Owner2'); const site = await signUp('Site');
  const org = await makeOrg(owner.token);
  assert.equal((await call('POST', `/v1/orgs/${org}/members`, { token: owner.token, body: { email: site.email, role: 'site' } })).status, 201);
  const get = (path: string) => call('GET', `/v1/orgs/${org}/${path}`, { token: site.token });
  for (const ok of ['projects', 'stock', 'warehouses', 'bills']) assert.equal((await get(ok)).status, 200, ok);
  for (const no of ['invoices', 'payments', 'reports/trial-balance?to=2026-12-31', 'members']) assert.equal((await get(no)).status, 403, no);
  assert.equal((await journal(org, site.token, 'site-0001-aaaa')).status, 403);
});

test('another organization looks like it does not exist: no leak by id, in any route', { skip }, async () => {
  const a = await signUp('A'); const b = await signUp('B');
  const orgA = await makeOrg(a.token, 'A Cafe'); const orgB = await makeOrg(b.token, 'B Cafe');
  const j = await journal(orgB, b.token, 'iso-0001-aaaa');
  for (const [m, u] of [['GET', `/v1/orgs/${orgB}/accounts`], ['GET', `/v1/orgs/${orgB}/journals`], ['GET', `/v1/orgs/${orgB}/journals/${j.body.id}`], ['GET', `/v1/orgs/${orgB}/audit`],
    ['GET', `/v1/orgs/${orgB}/reports/trial-balance?to=2026-12-31`], ['GET', `/v1/orgs/${orgB}/members`], ['GET', `/v1/orgs/${orgB}/periods`]] as const) {
    assert.equal((await call(m, u, { token: a.token })).status, 404, u);
  }
  assert.equal((await journal(orgB, a.token, 'iso-0002-bbbb')).status, 404);
  // org A's own route with org B's entry id: not found, never B's data
  assert.equal((await call('GET', `/v1/orgs/${orgA}/journals/${j.body.id}`, { token: a.token })).status, 404);
  assert.equal((await call('POST', `/v1/orgs/${orgA}/journals/${j.body.id}/reverse`, { token: a.token, body: { date: '2026-06-11', reason: 'x' } })).body.error.code, 'not_found');
  assert.equal((await call('GET', `/v1/orgs/abc/accounts`, { token: a.token })).status, 404);
});

test('locking a period: posting is refused, an override needs a role that has it, and reopening a closed period too', { skip }, async () => {
  const owner = await signUp('Owner'); const admin = await signUp('Admin');
  const org = await makeOrg(owner.token);
  await call('POST', `/v1/orgs/${org}/members`, { token: owner.token, body: { email: admin.email, role: 'admin' } });
  assert.equal((await call('PUT', `/v1/orgs/${org}/periods`, { token: owner.token, body: { date: '2026-06-15', status: 'CLOSED' } })).status, 200);
  assert.equal((await journal(org, owner.token, 'lock-0001-aaaa')).body.error.code, 'period_locked');
  assert.equal((await journal(org, admin.token, 'lock-0002-bbbb', { overrideReason: 'late bill' })).status, 403, 'admin has no override right');
  assert.equal((await journal(org, owner.token, 'lock-0002-bbbb', { overrideReason: 'late bill' })).status, 201);
  assert.equal((await call('PUT', `/v1/orgs/${org}/periods`, { token: admin.token, body: { date: '2026-06-15', status: 'OPEN' } })).status, 403);
  assert.equal((await call('PUT', `/v1/orgs/${org}/periods`, { token: owner.token, body: { date: '2026-06-15', status: 'OPEN' } })).status, 200);
  assert.equal((await journal(org, owner.token, 'lock-0003-cccc')).status, 201);
});

test('custom accounts: created, listed, duplicate codes refused', { skip }, async () => {
  const { token } = await signUp();
  const org = await makeOrg(token);
  const r = await call('POST', `/v1/orgs/${org}/accounts`, { token, body: { code: '5250', name: 'Electricity', type: 'EXPENSE' } });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', `/v1/orgs/${org}/accounts`, { token, body: { code: '5250', name: 'Again', type: 'EXPENSE' } })).status, 409);
  assert.equal((await call('POST', `/v1/orgs/${org}/accounts`, { token, body: { code: 'bad code!', name: 'x', type: 'EXPENSE' } })).status, 400);
  assert.ok((await call('GET', `/v1/orgs/${org}/accounts`, { token })).body.some((a: any) => a.code === '5250'));
});

test('unknown routes and malformed bodies get clean errors, never a stack trace', { skip }, async () => {
  assert.equal((await call('GET', '/v1/nothing')).body.error.code, 'not_found');
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{not json' });
  assert.equal(r.statusCode, 400); assert.ok(!/at .*\.ts/.test(r.body));
  assert.deepEqual(JSON.parse((await app.inject({ method: 'GET', url: '/health' })).body), { ok: true });
});
