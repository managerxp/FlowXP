import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import type { AiBridge } from '../src/assistant.ts';
import { setup } from './helpers.ts';

process.env.FLOWBOOK_SSO_SECRET = 'test-shared-secret-test-shared-secret';
const { pool, skip, cleanup } = await setup();

/** a stand-in provider: asks for the snapshot, then for a customer that does not exist, then answers from what it was given */
const seen: unknown[][] = [];
const ai: AiBridge = {
  configured: () => true,
  complete: async ({ messages }) => {
    seen.push(JSON.parse(JSON.stringify(messages)));
    const results = messages.filter((m) => (m as { role: string }).role === 'user' && Array.isArray((m as { content: unknown }).content)).length;
    if (results === 0) return { stopReason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'business_snapshot', input: {} }, { type: 'tool_use', id: 't2', name: 'find_customer_or_vendor', input: { name: 'Nobody' } }] };
    return { stopReason: 'end_turn', content: [{ type: 'text', text: 'Customers owe you nothing yet.' }] };
  }
};
const on = buildApp({ pool, allowedOrigins: [], ai });
const off = buildApp({ pool, allowedOrigins: [] });
test.after(async () => { await on.close(); await off.close(); await cleanup(); });

const login = async () => {
  const body = Buffer.from(JSON.stringify({ sub: '9', email: 'a@shop.example', name: 'A', bid: '77', bname: 'Shop', role: 'OWNER', status: 'TRIAL', tend: new Date(Date.now() + 3 * 86400_000).toISOString(), exp: Date.now() + 60_000 })).toString('base64url');
  const r = (await on.inject({ method: 'POST', url: '/v1/auth/flowxp', payload: { token: `${body}.${createHmac('sha256', process.env.FLOWBOOK_SSO_SECRET as string).update(body).digest('base64url')}` } })).json();
  return { headers: { authorization: `Bearer ${r.token}` }, org: r.organizationId as string };
};

test('the assistant looks things up read-only, answers in words, and is off without a provider', { skip }, async () => {
  const { headers, org } = await login();
  assert.equal((await on.inject({ method: 'GET', url: `/v1/orgs/${org}/assistant/status`, headers })).json().available, true);
  assert.equal((await off.inject({ method: 'GET', url: `/v1/orgs/${org}/assistant/status`, headers })).json().available, false);

  const before = (await pool.query('SELECT (SELECT count(*) FROM journal_entries) + (SELECT count(*) FROM documents) AS n')).rows[0].n;
  const r = await on.inject({ method: 'POST', url: `/v1/orgs/${org}/assistant`, headers, payload: { question: 'Who owes me money?', page: '/' } });
  assert.equal(r.statusCode, 200);
  const out = r.json();
  assert.equal(out.answer, 'Customers owe you nothing yet.');
  assert.deepEqual(out.used, ['Your overall position', 'Customer or vendor']);
  // the model was handed the figures as results, and the books did not change
  const last = JSON.stringify(seen[seen.length - 1]);
  assert.match(last, /customers_owe_you/); assert.match(last, /No customer or vendor has that name/);
  assert.equal((await pool.query('SELECT (SELECT count(*) FROM journal_entries) + (SELECT count(*) FROM documents) AS n')).rows[0].n, before);

  assert.equal((await off.inject({ method: 'POST', url: `/v1/orgs/${org}/assistant`, headers, payload: { question: 'hi' } })).statusCode, 503);
  assert.equal((await on.inject({ method: 'POST', url: `/v1/orgs/${org}/assistant`, payload: { question: 'hi' } })).statusCode, 401);
});
