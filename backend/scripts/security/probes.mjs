/* node scripts/security/probes.mjs   (needs the server running in development mode; uses up the password-reset rate limit for this address for an hour) */
import crypto from 'node:crypto';
const base = 'http://localhost:5100';
const out = [];
const check = (name, ok, detail = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// a real token to take apart
const login = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: 'cafe@flowxp.test', password: 'demo1234' }) })).json();
const token = login.data.token; const [h, p, s] = token.split('.');
const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
const me = (t, extra = {}) => fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + t, ...extra } }).then((r) => r.status);

check('a real token works', (await me(token)) === 200);
check('token with alg "none" is refused', (await me(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`)) === 401);
check('token with the payload changed (another user) is refused', (await me(`${h}.${b64({ ...payload, sub: payload.sub + 1 })}.${s}`)) === 401);
check('token signed with a guessed secret is refused', (await me(`${h}.${p}.${crypto.createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url')}`)) === 401);
check('an expired token is refused', (await me(`${h}.${b64({ ...payload, exp: 1 })}.${s}`)) === 401);
check('no token is refused', (await fetch(base + '/api/invoices')).status === 401);
check('a token from the cookie works only with the app header on a change (cross-site forgery)', await (async () => {
  const cookie = `flowxp_session=${token}`;
  const noHeader = await fetch(base + '/api/customers', { method: 'POST', headers: { cookie, 'x-business-id': '21', 'content-type': 'application/json' }, body: '{"name":"csrf test"}' });
  return noHeader.status === 403;
})(), 'a POST with the cookie and without X-Requested-With');

// CORS
const evil = await fetch(base + '/api/auth/login', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
check('another website is not allowed to call the API (CORS)', !evil.headers.get('access-control-allow-origin'), `status ${evil.status}`);

// headers
const r = await fetch(base + '/api/plans');
const hd = Object.fromEntries(r.headers);
check('security headers are sent', hd['x-content-type-options'] === 'nosniff' && hd['x-frame-options'] === 'DENY' && hd['referrer-policy'] === 'no-referrer');
check('answers are not cached by shared proxies', hd['cache-control'] === 'no-store');
check('the server does not announce its software', !hd['x-powered-by'], `x-powered-by: ${hd['x-powered-by'] ?? 'none'}`);

// errors do not leak
const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
const badText = await bad.text();
check('malformed JSON gives a plain 400, no stack trace', bad.status === 400 && !/at .*\.js|node_modules/.test(badText));
const huge = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(2_000_000) }) });
check('an oversized body is refused (1 MB limit)', huge.status === 413);

// injection in login fields
const sqli = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: "' OR 1=1 --", password: "' OR '1'='1" }) });
check('SQL-injection text in the login form is just a wrong password', [400, 401].includes(sqli.status), `status ${sqli.status}`);
const objInj = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: { $ne: null }, password: { $ne: null } }) });
check('an object where an email should be is refused cleanly', [400, 401].includes(objInj.status) && objInj.status < 500, `status ${objInj.status}`);

// path traversal on the static uploads
for (const path of ['/uploads/../.env', '/uploads/%2e%2e/.env', '/uploads/..%2f..%2fpackage.json', '/uploads/%2e%2e%2f%2e%2e%2fserver.js']) {
  const t = await fetch(base + path); const txt = await t.text();
  check(`path traversal ${path} gives nothing`, !/JWT_SECRET|DATABASE_URL|express/.test(txt), `status ${t.status}`);
}
const dot = await fetch(base + '/.env'); check('/.env is not served', dot.status === 404);
const git = await fetch(base + '/.git/config'); check('/.git is not served', git.status === 404);

// rate limiting: five reset requests from one address in an hour are allowed, the sixth is not
let last = 0; for (let i = 0; i < 7; i++) { last = (await fetch(base + '/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: `nobody${i}@example.invalid` }) })).status; }
check('password-reset requests are rate limited (429 after 5)', last === 429, `7th answer ${last}`);
const same = await Promise.all(['cafe@flowxp.test', 'nobody-at-all@example.invalid'].map(async (e) => (await (await fetch(base + '/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e }) })).text())));
console.log(out.join('\n'));
const fails = out.filter((x) => x.startsWith('FAIL')).length;
console.log(fails ? `\n${fails} FAILED` : '\nAll probes passed.');
