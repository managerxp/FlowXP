import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
const app = buildApp({ pool, allowedOrigins: [], limits: { register: 1000 } });
test.after(async () => { await app.close(); await cleanup(); });

const call = async (method: string, url: string, token?: string, body?: object) => {
  const r = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

test('a new business gets seven free days, then can be read but not written to until it is switched on', { skip }, async () => {
  const reg = await call('POST', '/v1/auth/register', undefined, { name: 'T', email: 'trial@example.com', password: 'correct horse battery' });
  const token = reg.body.token as string;
  const org = (await call('POST', '/v1/organizations', token, { name: 'Trial Shop', fyStartYear: 2026 })).body.id as string;

  const mine = (await call('GET', '/v1/me', token)).body.organizations[0];
  assert.equal(mine.plan, 'TRIAL'); assert.equal(mine.trial_days_left, 7);
  const sale = { name: 'Walk-in', kind: 'CUSTOMER' };
  assert.equal((await call('POST', `/v1/orgs/${org}/parties`, token, sale)).status, 201, 'writing works during the trial');

  await pool.query(`UPDATE organizations SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, [org]);
  assert.equal((await call('GET', '/v1/me', token)).body.organizations[0].trial_days_left, 0);
  assert.equal((await call('GET', `/v1/orgs/${org}/parties`, token)).status, 200, 'reading still works');
  const blocked = await call('POST', `/v1/orgs/${org}/parties`, token, { ...sale, name: 'Second' });
  assert.equal(blocked.status, 402); assert.equal(blocked.body.error.code, 'trial_ended');

  await pool.query(`UPDATE organizations SET plan = 'ACTIVE' WHERE id = $1`, [org]);
  assert.equal((await call('POST', `/v1/orgs/${org}/parties`, token, { ...sale, name: 'Third' })).status, 201, 'switched on, it writes again');
});
