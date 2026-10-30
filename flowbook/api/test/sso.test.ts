import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { findConnection } from '../src/inbox.ts';
import { enter, fromHeader, identity, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
const app = fromHeader(buildApp({ pool, allowedOrigins: [], hostAuth: true }));
test.after(async () => { await app.close(); await cleanup(); });
const me = async (who: object) => (await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-test-who': JSON.stringify(who) } })).json();

test('inside FlowXP the books are the signed-in business, with its own trial; there is no other way in', { skip }, async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode, 401, 'nobody signed in by FlowXP');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/flowxp', payload: { token: 'x' } })).statusCode, 404, 'no handoff endpoint any more');

  const a = await me(identity('42', { sub: '7', email: 'owner@shop.example', bname: 'Corner Shop' }));
  assert.equal(a.organizations.length, 1);
  assert.equal(a.organizations[0].plan, 'TRIAL'); assert.equal(a.organizations[0].trial_days_left, 3);
  assert.equal(a.organizations[0].name, 'Corner Shop');

  const b = await me(identity('42', { sub: '7', email: 'owner@shop.example', status: 'ACTIVE' }));   // the next visit finds the same books and follows the plan
  assert.equal(b.organizations[0].id, a.organizations[0].id);
  assert.equal(b.organizations[0].plan, 'ACTIVE');

  assert.equal((await me(identity('42', { sub: '8', email: 'till@shop.example', role: 'STAFF', status: 'ACTIVE' }))).organizations[0].role, 'viewer', 'staff join as viewers');
  const stranger = await app.inject({ method: 'GET', url: '/v1/orgs/999999/accounts', headers: { 'x-test-who': JSON.stringify(identity('42')) } });
  assert.equal(stranger.statusCode, 404);
  const [x, y] = await Promise.all([me(identity('77', { staff: 1 })), me(identity('77', { staff: 2, role: 'STAFF', sub: '9', email: 'x@y.example' }))]);
  assert.ok(x.organizations.length === 1 || y.organizations.length === 1);
  assert.equal(((await app.inject({ method: 'GET', url: '/v1/me', headers: { 'x-test-who': JSON.stringify(identity('99', { role: 'STAFF' })) } })).statusCode), 403, 'staff cannot be the first in');
});

test('a person with books of their own in another business only ever sees the one they are signed in to', { skip }, async () => {
  const one = await enter(app, identity('501', { sub: '50', email: 'two@shop.example' }));
  const two = await enter(app, identity('502', { sub: '50', email: 'two@shop.example' }));
  assert.notEqual(one.org, two.org);
  assert.equal((await me(identity('501', { sub: '50', email: 'two@shop.example' }))).organizations.length, 1);
  const cross = await app.inject({ method: 'GET', url: `/v1/orgs/${two.org}/accounts`, headers: one.headers });
  assert.equal(cross.statusCode, 404, 'the other business is not reachable with this business chosen');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/organizations', headers: one.headers, payload: { name: 'Another' } })).statusCode, 404);
});

test('two requests for a new business arriving together make one set of books, connected to the FlowXP sales feed', { skip }, async () => {
  const who = identity('555', { sub: '55', email: 'race@shop.example' });
  const [x, y] = await Promise.all([me(who), me(identity('555', { sub: '55', email: 'race@shop.example', name: 'Same' }))]);
  assert.equal(x.organizations[0].id, y.organizations[0].id);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM organizations WHERE flowxp_business_id = '555'`)).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM organizations WHERE name = 'Corner Shop' AND flowxp_business_id IS NULL`)).rows[0].n, 0);
  const conn = await findConnection(pool, '555');
  assert.ok(conn && String(conn.organization_id) === x.organizations[0].id, 'sales from FlowXP find these books without anyone entering a secret');
});
