/* Wholesale settings on the phone: the rules form, customer messages, salespeople, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFY, WHOLESALE_SETTINGS_TEXTS, canWholesaleSettings, emptySp, expiryDays, spBody, spForm, spProblem, spSub, wbody, wform, wproblem, type Salesperson, type WSettings } from '../src/lib/wholesaleSettings.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const s: WSettings = {
  credit_policy: 'WARN', block_when_overdue: false, overdue_grace_days: 3, default_payment_terms_days: 30, default_price_list_id: 7, reserve_on_confirm: true, fefo: true, expiry_alert_days: [30, 60, 90], order_approval_over: 50000, slow_moving_days: 60, dead_stock_days: 180,
  order_prefix: 'SO', invoice_footer: null, notifications: { order_confirmed: false, payment_due: true }, distributor_enabled: true, scheme_stacking: 'BEST', visit_location: false, field_collections: true, credit_manager_override: true
};

test('only people with the settings right', () => { assert.equal(canWholesaleSettings((p) => p === 'settings'), true); assert.equal(canWholesaleSettings(() => false), false); });

test('rules form: round trip, messages default on except the two reminders, checks, body', () => {
  const f = wform(s);
  assert.equal(f.expiry_alert_days, '30, 60, 90'); assert.equal(f.order_approval_over, '50000'); assert.equal(f.default_price_list_id, '7'); assert.equal(f.invoice_footer, ''); assert.equal(wproblem(f), '');
  assert.deepEqual(f.notifications, { order_confirmed: false, order_dispatched: true, invoice_issued: true, payment_received: true, payment_due: true, payment_overdue: false }); assert.equal(NOTIFY.length, 6);
  const b = wbody({ ...f, order_prefix: ' so2 ', order_approval_over: '', default_price_list_id: '', invoice_footer: ' Thanks ', expiry_alert_days: '90 30, 60' });
  assert.equal(b.order_prefix, 'SO2'); assert.equal(b.order_approval_over, null); assert.equal(b.default_price_list_id, null); assert.equal(b.invoice_footer, 'Thanks'); assert.deepEqual(b.expiry_alert_days, [90, 30, 60]); assert.equal(b.overdue_grace_days, 3);
  assert.deepEqual(expiryDays(''), []);
  assert.notEqual(wproblem({ ...f, overdue_grace_days: '400' }), ''); assert.notEqual(wproblem({ ...f, default_payment_terms_days: '' }), ''); assert.notEqual(wproblem({ ...f, order_approval_over: '0' }), ''); assert.notEqual(wproblem({ ...f, order_prefix: 'A-1' }), '');
  assert.notEqual(wproblem({ ...f, order_prefix: '' }), ''); assert.notEqual(wproblem({ ...f, expiry_alert_days: '1 2 3 4 5 6 7' }), ''); assert.notEqual(wproblem({ ...f, expiry_alert_days: '800' }), ''); assert.notEqual(wproblem({ ...f, slow_moving_days: '3' }), ''); assert.notEqual(wproblem({ ...f, dead_stock_days: '10' }), '');
});

test('salespeople', () => {
  const p: Salesperson = { salesperson_id: 1, name: 'Ravi', phone: '98', email: null, territory: 'Ameerpet', commission_pct: 1.5, commission_on: 'COLLECTIONS', status: 'ACTIVE', user_id: null, customers: 12 };
  const f = spForm(p);
  assert.equal(spProblem(f), ''); assert.deepEqual(spBody(f, true), { name: 'Ravi', phone: '98', email: null, territory: 'Ameerpet', commission_pct: 1.5, commission_on: 'COLLECTIONS', status: 'ACTIVE' }); assert.equal('status' in spBody(f, false), false);
  assert.equal(spBody(emptySp(), false).commission_pct, 0); assert.notEqual(spProblem({ ...f, name: 'R' }), ''); assert.notEqual(spProblem({ ...f, email: 'x' }), ''); assert.notEqual(spProblem({ ...f, commission_pct: '101' }), '');
  assert.equal(spSub(p), 'Ameerpet · 12 customers · 1.5% of collections'); assert.equal(spSub({ ...p, commission_on: 'SALES', territory: null, status: 'INACTIVE' }), '12 customers · 1.5% of sales · Inactive');
});

test('every text of the wholesale settings screen is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(WHOLESALE_SETTINGS_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
