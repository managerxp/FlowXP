import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { enter, fromHeader, identity, setup } from './helpers.ts';

const { pool, skip, cleanup } = await setup();

let off: string[] = [];
const app = fromHeader(buildApp({ pool, allowedOrigins: [], hostAuth: true, featuresOff: async (id) => (id === '88' ? off : []) }));
const free = fromHeader(buildApp({ pool, allowedOrigins: [], hostAuth: true }));
test.after(async () => { await app.close(); await free.close(); await cleanup(); });

const login = (bid: string) => enter(app, identity(bid));
const get = async (a: typeof app, who: { headers: object; org: string }, path: string) => a.inject({ method: 'GET', url: `/v1/orgs/${who.org}${path}`, headers: who.headers });

test('what the super admin switches off stops working in FlowBook, everyday screens stay, and a business not linked to FlowXP is never gated', { skip }, async () => {
  const shop = await login('88');
  off = [];
  assert.equal((await get(app, shop, '/bank/accounts')).statusCode, 200);

  off = ['flowbook_bank', 'flowbook_notes', 'flowbook_whatsapp'];
  const bank = await get(app, shop, '/bank/accounts');
  assert.equal(bank.statusCode, 403); assert.equal(bank.json().error.code, 'feature_off');
  assert.equal((await get(app, shop, '/credit-notes')).statusCode, 403);
  assert.equal((await get(app, shop, '/invoices')).statusCode, 200);            // everyday: always on
  assert.equal((await get(app, shop, '/parties')).statusCode, 200);
  assert.equal((await get(app, shop, '/reports/profit-and-loss?from=2026-04-01&to=2026-10-30')).statusCode, 200);
  const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: shop.headers })).json();
  assert.deepEqual(me.organizations[0].features_off, off);
  assert.equal(me.organizations[0].flowxp_business_id, undefined);

  // a field of an everyday request that belongs to an advanced feature
  off = ['flowbook_currency'];
  const post = (payload: object) => app.inject({ method: 'POST', url: `/v1/orgs/${shop.org}/invoices`, headers: shop.headers, payload });
  assert.equal((await post({ partyId: '1', date: '2026-10-30', currency: 'USD', fxRate: '83', lines: [{ description: 'x', quantity: '1', unitPrice: '1', taxCode: 'GST0' }] })).json().error.code, 'feature_off');
  assert.notEqual((await post({ partyId: '1', date: '2026-10-30', lines: [{ description: 'x', quantity: '1', unitPrice: '1', taxCode: 'GST0' }] })).json().error?.code, 'feature_off');

  // the whole app
  off = ['flowbook_app'];
  assert.equal((await get(app, shop, '/invoices')).json().error.code, 'feature_off');

  // books that are not a FlowXP business, and a host that says nothing is off
  off = [];
  const lone = await login('99');
  assert.equal((await get(app, lone, '/bank/accounts')).statusCode, 200);
  assert.equal((await get(free, shop, '/bank/accounts')).statusCode, 200);
});
