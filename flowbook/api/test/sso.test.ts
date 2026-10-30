import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { setup } from './helpers.ts';

process.env.FLOWBOOK_SSO_SECRET = 'test-shared-secret-test-shared-secret';
const { pool, skip, cleanup } = await setup();
const app = buildApp({ pool, allowedOrigins: [], limits: { register: 1000, login: 1000 } });
test.after(async () => { await app.close(); await cleanup(); });

const handoff = (over: object = {}, secret = process.env.FLOWBOOK_SSO_SECRET as string) => {
  const body = Buffer.from(JSON.stringify({ sub: '7', email: 'owner@shop.example', name: 'Owner', bid: '42', bname: 'Corner Shop', role: 'OWNER', status: 'TRIAL', tend: new Date(Date.now() + 3 * 86400000).toISOString(), exp: Date.now() + 60000, ...over })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const go = async (token: string) => { const r = await app.inject({ method: 'POST', url: '/v1/auth/flowxp', payload: { token } }); return { status: r.statusCode, body: JSON.parse(r.body) }; };

test('FlowXP sign-in opens the business books with its own trial, and a forged or old handoff is refused', { skip }, async () => {
  assert.equal((await go(handoff({}, 'wrong-secret-wrong-secret-wrong-secret'))).status, 401);
  assert.equal((await go(handoff({ exp: Date.now() - 1 }))).status, 401);

  const a = await go(handoff());
  assert.equal(a.status, 200);
  const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${a.body.token}` } })).json();
  assert.equal(me.organizations.length, 1);
  assert.equal(me.organizations[0].plan, 'TRIAL'); assert.equal(me.organizations[0].trial_days_left, 3);

  const b = await go(handoff({ status: 'ACTIVE' }));   // the second visit finds the same books and follows the plan
  assert.equal(b.body.organizationId, a.body.organizationId);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${b.body.token}` } })).json().organizations[0].plan, 'ACTIVE');

  const staff = await go(handoff({ sub: '8', email: 'till@shop.example', role: 'STAFF', status: 'ACTIVE' }));   // staff join as viewers
  assert.equal(staff.status, 200);
  assert.equal((await go(handoff({ bid: '99', email: 'x@y.example', role: 'STAFF' }))).status, 403, 'staff cannot be the first in');
});

test('two handoffs for a new business arriving together make one set of books', { skip }, async () => {
  const [x, y] = await Promise.all([go(handoff({ bid: '555', sub: '55', email: 'race@shop.example' })), go(handoff({ bid: '555', sub: '55', email: 'race@shop.example' }))]);
  assert.equal(x.status, 200); assert.equal(y.status, 200);
  assert.equal(x.body.organizationId, y.body.organizationId);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM organizations WHERE flowxp_business_id = '555'`)).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM organizations WHERE name = 'Corner Shop' AND flowxp_business_id IS NULL`)).rows[0].n, 0);
});
