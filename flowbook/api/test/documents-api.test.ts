import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { gstinCheckChar } from '../src/gst.ts';
import { setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();
const app = buildApp({ pool, limits: { register: 1000 } });
test.after(async () => { await app.close(); await cleanup(); });

type Res = { status: number; body: any };
const call = async (method: string, url: string, o: { token?: string; body?: unknown; key?: string } = {}): Promise<Res> => {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.key) headers['idempotency-key'] = o.key;
  const r = await app.inject({ method: method as 'GET', url, headers, payload: o.body as object | undefined });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
let n = 0;
const signUp = async () => { n += 1; return (await call('POST', '/v1/auth/register', { body: { name: `U${n}`, email: `doc${n}@example.com`, password: 'correct horse battery' } })).body.token as string; };

test('sell, collect and look at the books over HTTP; each role does only its own part', { skip }, async () => {
  const owner = await signUp(); const sales = await signUp(); const viewer = await signUp();
  const org = (await call('POST', '/v1/organizations', { token: owner, body: { name: 'Asha Traders', fyStartYear: 2026 } })).body.id as string;
  const b = `/v1/orgs/${org}`;
  for (const [t, role] of [[sales, 'sales'], [viewer, 'viewer']] as const) {
    const email = (await call('GET', '/v1/me', { token: t })).body.user.email;
    await call('POST', `${b}/members`, { token: owner, body: { email, role } });
  }

  const g = '27AAPFU0939F1Z';
  assert.equal((await call('PUT', `${b}/profile`, { token: owner, body: { gstin: g + 'X' } })).body.error.code, 'bad_gstin');
  const profile = await call('PUT', `${b}/profile`, { token: owner, body: { gstin: g + gstinCheckChar(g) } });
  assert.equal(profile.body.state_code, '27');

  const rates = (await call('GET', `${b}/tax-rates`, { token: owner })).body;
  assert.deepEqual(rates.map((r: any) => r.code), ['GST0', 'GST12', 'GST18', 'GST28', 'GST5']);

  const party = await call('POST', `${b}/parties`, { token: sales, body: { kind: 'CUSTOMER', name: 'Ravi Stores', stateCode: '29' } });
  assert.equal(party.status, 201); assert.equal(typeof party.body.id, 'string');
  const item = await call('POST', `${b}/items`, { token: owner, body: { sku: 'TEA', name: 'Tea box', taxCode: 'GST18', salePrice: '500' } });
  assert.equal((await call('POST', `${b}/items`, { token: sales, body: { sku: 'X', name: 'X' } })).status, 403, 'sales cannot change the item list');

  const draft = await call('POST', `${b}/invoices`, { token: sales, body: { partyId: party.body.id, date: '2026-06-10', lines: [{ itemId: item.body.id, quantity: '2.5' }] } });
  assert.equal(draft.status, 201);
  const inv = `${b}/invoices/${draft.body.id}`;
  const shown = (await call('GET', inv, { token: sales })).body;
  assert.deepEqual([shown.status, shown.number, shown.total_minor, shown.inter_state], ['DRAFT', null, '1475.00', true]);   // 2.5 x 500 = 1250, IGST 225
  assert.equal(shown.lines[0].quantity, '2.500');
  assert.equal((await call('POST', `${b}/invoices`, { token: viewer, body: { partyId: party.body.id, date: '2026-06-10', lines: [{ description: 'x', unitPrice: '1', taxCode: 'GST0' }] } })).status, 403);

  const issued = await call('POST', `${inv}/issue`, { token: sales });
  assert.deepEqual([issued.status, issued.body.number], [200, 'INV-26-27-000001']);
  assert.equal((await call('POST', `${inv}/issue`, { token: sales })).body.error.code, 'not_draft');
  assert.equal((await call('PUT', inv, { token: sales, body: { partyId: party.body.id, date: '2026-06-10', lines: [{ description: 'x', unitPrice: '1', taxCode: 'GST0' }] } })).body.error.code, 'not_draft');

  const pay = { direction: 'IN', partyId: party.body.id, date: '2026-06-11', mode: 'UPI', amount: '1000.00', allocations: [{ documentId: draft.body.id, amount: '1000.00' }] };
  assert.equal((await call('POST', `${b}/payments`, { token: sales, key: 'http-pay-0001', body: pay })).status, 403, 'sales does not take payments');
  assert.equal((await call('POST', `${b}/payments`, { token: owner, body: pay })).body.error.code, 'idempotency_key_required');
  const paid = await call('POST', `${b}/payments`, { token: owner, key: 'http-pay-0001', body: pay });
  assert.deepEqual([paid.status, paid.body.number, paid.body.replayed], [201, 'RCT-26-27-000001', false]);
  const replay = await call('POST', `${b}/payments`, { token: owner, key: 'http-pay-0001', body: pay });
  assert.deepEqual([replay.status, replay.body.id], [200, paid.body.id]);

  assert.equal((await call('GET', inv, { token: viewer })).body.balance_minor, '475.00');
  const ageing = (await call('GET', `${b}/reports/ageing?type=receivables&asOf=2026-06-30`, { token: viewer })).body;
  assert.equal(ageing.total, '475.00'); assert.equal(ageing.rows[0].party_name, 'Ravi Stores');
  assert.equal((await call('GET', `${b}/reports/ageing?type=receivables&asOf=2026-06-30`, { token: sales })).status, 403);
  assert.deepEqual((await call('GET', `${b}/reports/reconcile`, { token: owner })).body, { issues: [] });

  assert.equal((await call('POST', `${inv}/void`, { token: owner, body: { date: '2026-06-20', reason: 'oops' } })).body.error.code, 'has_allocations');
  assert.equal((await call('GET', `${b}/invoices/999999`, { token: owner })).status, 404);
  assert.equal((await call('GET', `${b}/invoices/abc`, { token: owner })).status, 400);

  const other = await signUp();
  assert.equal((await call('GET', inv, { token: other })).status, 404, 'a stranger cannot tell the organization exists');
});
