/*
 * Signup requires agreeing to the Terms and Privacy Policy — checked here,
 * not only by the frontend's disabled button, since a direct API call must
 * not be able to skip it. Acceptance is timestamped on the user row as
 * evidence for the Terms' own "Acceptance" clause.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const auth = await import('../src/controllers/auth.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const signupBody = (overrides = {}) => ({
  name: 'Priya', email: 'priya-signup-test@flowxp.test', phone: '9000000001',
  password: 'rosewood-lamp-7', business_name: 'Priya Retail', business_type: 'RETAIL',
  accepted_terms: true, ...overrides
});
const call = (body) => { const res = fakeRes(); return auth.signup({ body, headers: {}, ip: '127.0.0.1' }, res).then(() => res); };

test('setup', { skip }, async () => { await runMigrations(pool); });

test('signup is refused without ticking the Terms/Privacy checkbox', { skip }, async () => {
  const res = await call(signupBody({ accepted_terms: false }));
  assert.equal(res.code, 400);
  assert.match(res.body.message, /agree/i);

  const missing = await call(signupBody({ accepted_terms: undefined }));
  assert.equal(missing.code, 400);

  assert.equal((await pool.query(`SELECT COUNT(*) n FROM users WHERE email = $1`, ['priya-signup-test@flowxp.test'])).rows[0].n, '0');
});

test('signup succeeds once accepted, and records when', { skip }, async () => {
  const res = await call(signupBody());
  assert.equal(res.code, 201);

  const user = (await pool.query(`SELECT terms_accepted_at FROM users WHERE email = $1`, ['priya-signup-test@flowxp.test'])).rows[0];
  assert.ok(user.terms_accepted_at, 'terms_accepted_at should be set');
  assert.ok(new Date(user.terms_accepted_at) <= new Date());
});
