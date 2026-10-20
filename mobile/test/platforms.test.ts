/* Delivery platforms on the phone: connecting, the statement parser and its checks, the lines shown, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, DELIVERY_TEXTS, canDelivery, connectBody, disconnectBody, lineSub, missingText, parseRows, statementProblem, summaryText } from '../src/lib/platforms.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('connecting leaves blank credentials out; disconnecting only switches off', () => {
  assert.deepEqual(connectBody(' key123 ', ''), { is_enabled: true, credentials: { api_key: 'key123', outlet_id: undefined } }); assert.deepEqual(disconnectBody(), { is_enabled: false });
  assert.equal(canDelivery((p) => p === 'settings'), true); assert.equal(canDelivery(() => false), false);
});

test('a statement is one order per line in the column order; blanks are zero and a missing net is the gross', () => {
  assert.equal(COLUMNS.length, 9);
  const rows = parseRows('Z1234,2026-09-20,500,100,,,,,400\n\nZ1235,,300\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { external_order_id: 'Z1234', settlement_date: '2026-09-20', gross_amount: '500', commission: '100', payment_charges: 0, delivery_charges: 0, tax: 0, other_deductions: 0, net_settled: '400' });
  assert.equal(rows[1].settlement_date, undefined); assert.equal(rows[1].net_settled, '300', 'no net given: the gross');
  assert.equal(statementProblem('Z1,2026-09-20,500,100,,,,,400'), ''); assert.equal(statementProblem('  '), 'Paste at least one row first.');
  assert.match(statementProblem('Z1,2026-09-20,500\nZ2,20-09-2026,100'), /Line 2/); assert.match(statementProblem('Z1,2026-09-20,abc'), /Line 1/);
});

test('the lines and the summaries read plainly', () => {
  assert.equal(lineSub({ line_id: 1, order_number: 'ORD-9', external_order_id: 'Z1', gross_amount: 500, net_settled: 400, expected_settlement: 400, status: 'MATCHED' }), 'Gross ₹500.00 · Net settled ₹400.00 · Expected ₹400.00');
  assert.equal(summaryText({ count: 10, matched: 8, flagged: 2, net_settled_total: 5000 }), '8 matched, 2 flagged, out of 10: ₹5,000.00 settled in total.');
  assert.equal(missingText({ total_owed: 1200, orders: [{ order_id: 1, order_number: 'A', external_order_number: null, external_order_id: 'Z', total: 700 }, { order_id: 2, order_number: 'B', external_order_number: null, external_order_id: 'Y', total: 500 }] }), '₹1,200.00 across 2 orders');
});

test('every text of the delivery screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(DELIVERY_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
