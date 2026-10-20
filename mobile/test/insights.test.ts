/* Profit, forecast, leakage and kitchen reports on the phone: ranges, wording, sorting, the cost-assumption form, event and review bodies, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSIGHT_TEXTS, ITEM_SORTS, accuracyText, assumptionsBody, assumptionsForm, assumptionsProblem, changeText, dayLine, daysAgoISO, deltaGood, deltaText, draftNote, emptyEvent, eventBody, eventLine, eventProblem, evidenceCell, findingCounts, hourLabel, minText, pctText, rangeQuery, rangeText,
  reviewBody, share, showValue, slowerDishes, sortItems, stockSub, type Day, type Finding, type Kitchen, type Leakage, type Profit
} from '../src/lib/insights.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('date ranges include today and count back across a month end', () => {
  const now = new Date(2026, 9, 3);
  assert.equal(daysAgoISO(0, now), '2026-10-03'); assert.equal(daysAgoISO(6, now), '2026-09-27'); assert.equal(rangeQuery(7, now), 'from=2026-09-27&to=2026-10-03');
});

test('small formats: percent, minutes, change arrows (and which direction is good), hour labels, ranges', () => {
  assert.equal(pctText(null), '—'); assert.equal(pctText(42), '42%'); assert.equal(minText(null), '—'); assert.equal(minText(18), '18 min');
  assert.equal(deltaText(4.2), '▲ 4.2%'); assert.equal(deltaText(-3, ' pts'), '▼ 3 pts'); assert.equal(deltaText(0), 'no change'); assert.equal(deltaText(null), 'no change');
  assert.equal(deltaGood(5), true); assert.equal(deltaGood(5, false), false); assert.equal(deltaGood(-2, false), true); assert.equal(deltaGood(0), null);
  assert.equal(hourLabel(0), '12am'); assert.equal(hourLabel(13), '1pm'); assert.equal(hourLabel(12), '12pm'); assert.equal(rangeText({ low: 3, high: 7.4 }), '3–7'); assert.equal(rangeText(null), '—'); assert.equal(share(25, 200), 13); assert.equal(share(5, 0), 0);
});

test('menu items sort by the chosen figure; margin lowest first', () => {
  const items = [
    { product_id: 1, name: 'A', quantity: 10, revenue: 100, food_cost_pct: 30, contribution_per_unit: 5, contribution: 50, contribution_margin_pct: 50 },
    { product_id: 2, name: 'B', quantity: 3, revenue: 300, food_cost_pct: 20, contribution_per_unit: 40, contribution: 120, contribution_margin_pct: 40 },
    { product_id: 3, name: 'C', quantity: 7, revenue: 70, food_cost_pct: 40, contribution_per_unit: 2, contribution: 14, contribution_margin_pct: 20 }
  ] as Profit['items'];
  assert.deepEqual(sortItems(items, 'contribution').map((i) => i.name), ['B', 'A', 'C']); assert.deepEqual(sortItems(items, 'quantity').map((i) => i.name), ['A', 'C', 'B']); assert.deepEqual(sortItems(items, 'margin').map((i) => i.name), ['C', 'B', 'A']);
  assert.equal(ITEM_SORTS.length, 5);
});

test('cost assumptions: the form from the server, checked, sent as numbers (blank is zero)', () => {
  const f = assumptionsForm({ payment_fee_pct: { CASH: 0, UPI: 0.5, CARD: 2 }, platform_commission_pct: { ZOMATO: 25 }, packaging_per_order: 8 });
  assert.equal(f.fees.UPI, '0.5'); assert.equal(f.commissions.SWIGGY, ''); assert.equal(f.packaging, '8'); assert.equal(assumptionsProblem(f), '');
  assert.deepEqual(assumptionsBody(f), { payment_fee_pct: { CASH: 0, UPI: 0.5, CARD: 2 }, platform_commission_pct: { ZOMATO: 25, SWIGGY: 0, ONDC: 0, MAGICPIN: 0 }, packaging_per_order: 8 });
  assert.notEqual(assumptionsProblem({ ...f, fees: { ...f.fees, CARD: '101' } }), ''); assert.notEqual(assumptionsProblem({ ...f, packaging: '-1' }), ''); assert.equal(assumptionsProblem({ ...f, packaging: '' }), '');
});

test('forecast wording: a day, accuracy, events, stock lines, draft orders', () => {
  const day: Day = { date: '2026-10-17', weekday: 'Saturday', confidence: 'high', orders: { predicted: 52.4, low: 40, high: 66 }, revenue: { predicted: 18500 }, events: [{ event_id: 1, label: 'Diwali' }] };
  assert.equal(dayLine(day), '52 orders · typically 40–66 · ₹18,500.00 · high · Diwali'); assert.equal(dayLine({ ...day, orders: null }), 'Not enough history');
  assert.match(accuracyText({ orders: { days: 28, mape_pct: 12, bias_pct: 5 } }), /off by 12% on average for orders\. It tended to run 5% high\./); assert.match(accuracyText({ orders: { days: 28, mape_pct: 12, bias_pct: -5 } }), /5% low/); assert.match(accuracyText(undefined), /Not enough history/);
  assert.match(eventLine({ event_id: 1, date: '2026-10-31', label: 'Match night', multiplier: 1.25 }), /Match night \(\+25%\)/); assert.match(eventLine({ event_id: 2, date: '2026-10-31', label: 'Closed', multiplier: 0.5 }), /\(-50%\)/);
  const e = { ...emptyEvent(), date: '2026-10-31', label: ' Match night ' };
  assert.equal(eventProblem(e), ''); assert.deepEqual(eventBody(e), { date: '2026-10-31', label: 'Match night', uplift_pct: 25 }); assert.notEqual(eventProblem({ ...e, date: '31-10-2026' }), ''); assert.notEqual(eventProblem({ ...e, label: ' ' }), ''); assert.notEqual(eventProblem({ ...e, uplift_pct: '' }), ''); assert.notEqual(eventProblem({ ...e, date: '2026-13-01' }), '');
  assert.equal(stockSub({ product_id: 1, name: 'Rice', unit: 'kg', current_stock: 12, tomorrow_need: 4, days_of_cover: 3, reorder_point: 8, static_min_stock: 5, status: 'ORDER_SOON', recommended_qty: 20, estimated_cost: 800 }), 'in stock 12 kg · tomorrow 4 kg · 3 days of cover · buy 20 kg');
  assert.equal(draftNote({ orders: [1], already_on_order: [] }), 'Draft orders created. See Purchases.'); assert.match(draftNote({ orders: [], already_on_order: [1] }), /already on an open order/); assert.match(draftNote({ orders: [], already_on_order: [] }), /Nothing needs ordering/);
});

test('leakage: figures with their units, counts, evidence cells, and the review body', () => {
  assert.equal(showValue(1250, '₹'), '₹1,250.00'); assert.equal(showValue(12, '%'), '12%'); assert.equal(showValue(3), '3');
  const l = { summary: { potential: 5000, open: 2, critical: 1, by_category: [] }, findings: [], note: '', period: { days: 30 } } as Leakage;
  assert.equal(findingCounts(l), '2 open findings, 1 needing attention'); assert.equal(findingCounts({ ...l, summary: { ...l.summary, open: 1, critical: 0 } }), '1 open finding');
  assert.equal(evidenceCell(350, 'Amount collected'), '₹350.00'); assert.equal(evidenceCell(12, '% off'), '12%'); assert.equal(evidenceCell(4, 'Count'), '4'); assert.equal(evidenceCell('Ravi', 'Customer'), 'Ravi');
  const f = { fingerprint: 'abc' } as Finding;
  assert.deepEqual(reviewBody(f, 'DISMISSED', ' fine '), { fingerprint: 'abc', status: 'DISMISSED', note: 'fine' }); assert.equal(reviewBody(f, 'OPEN').note, undefined);
});

test('kitchen: the dishes getting slower (2+ minutes), and change text', () => {
  const k = { items: [{ name: 'Biryani', change_minutes: 9, avg_minutes: 27, previous_avg_minutes: 18 }, { name: 'Tea', change_minutes: 1 }, { name: 'Roti', change_minutes: -3 }, { name: 'Dal', change_minutes: null }, { name: 'Soup', change_minutes: 2 }] } as unknown as Kitchen;
  assert.deepEqual(slowerDishes(k).map((i) => i.name), ['Biryani', 'Soup']); assert.equal(changeText(9), '▲ 9 min'); assert.equal(changeText(-3), '▼ 3 min'); assert.equal(changeText(null), '—');
});

test('every text of the insight screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(INSIGHT_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
