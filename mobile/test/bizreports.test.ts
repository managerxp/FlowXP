/* The business reports on the phone: each builder turns the server's JSON into figures and rows; the list follows permissions; every fixed text is translated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFS, REPORT_TEXTS, defOf, listFor, statementView } from '../src/lib/bizReports.ts';
import { HI, setLangValue, t } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const m = (n: number) => `₹${n.toFixed(2)}`;
const range = { from: '2026-10-01', to: '2026-10-15' };

test('every report has a unique id, asks the server for a path with the period, and the stock ones have none', () => {
  assert.equal(new Set(DEFS.map((d) => d.id)).size, DEFS.length);
  for (const d of DEFS) {
    assert.match(d.path(range), /^\/reports\//, d.id);
    assert.equal(d.path(range).includes('from='), d.dated && d.id !== 'customers-dues' && d.id !== 'suppliers-dues', `${d.id}: the period is sent only to reports that have one`);
  }
  assert.equal(defOf('stock-low')?.dated, false); assert.equal(defOf('nope'), undefined);
});

test('the list shows only what the person may open, in order, and never an empty group', () => {
  const all = listFor(() => true).map((g) => g.group);
  assert.deepEqual(all, ['Money', 'Profit', 'GST', 'Stock', 'Parties']);
  assert.deepEqual(listFor((p) => p === 'inventory').map((g) => g.group), ['Stock']);
  assert.deepEqual(listFor(() => false), []);
  assert.ok(!listFor((p) => p === 'reports').some((g) => g.defs.some((d) => d.perm !== 'reports')), 'GST and stock need their own permission');
});

test('Day Book: figures from the summary, a row per entry with its type, party and what is due', () => {
  const v = defOf('daybook')!.build({ summary: { sales: 1000, purchases: 400, money_in: 900, money_out: 300 }, truncated: true, rows: [
    { type: 'SALE', date: '2026-10-14T00:00:00.000Z', number: 'INV-7', party: 'Ravi Motors', total: 1180, balance: 180, status: 'ISSUED' },
    { type: 'PAYMENT_IN', date: '2026-10-15', number: '#9', party: 'Ravi Motors', total: 500, balance: 0, status: 'ISSUED' }] }, m);
  assert.deepEqual(v.stats.map((s) => s.value), ['₹1000.00', '₹400.00', '₹900.00', '₹300.00']);
  assert.deepEqual(v.sections[0].rows[0], { left: 'Sale · INV-7', right: '₹1180.00', sub: '2026-10-14 · Ravi Motors · Due ₹180.00' });
  assert.equal(v.sections[0].rows[1].left, 'Money in · #9'); assert.match(v.note!, /Only the latest/);
});

test('Profit & Loss: the sums, a loss shown as bad, and the uncosted-bills warning', () => {
  const v = defOf('pnl')!.build({ gross_sales: 1000, discounts: 50, returns: 0, net_sales: 950, cost_of_goods: 600, gross_profit: 350, gross_margin_pct: 37, expenses: [{ category: 'Rent', amount: 500 }], total_expenses: 500, net_profit: -150, net_margin_pct: -16, uncosted_bills: 2 }, m);
  assert.equal(v.stats[2].bad, true); assert.equal(v.stats[2].value, '₹-150.00');
  assert.deepEqual(v.sections[1].rows.map((r) => r.left), ['Rent', 'Total expenses']);
  assert.match(v.note!, /2 bills have items with no cost price/);
});

test('GST reports: by rate, by HSN, and the options report', () => {
  const rates = defOf('gst-rates')!.build({ totals: { output_tax: 280, input_tax: 100, net_tax: 180 }, rows: [{ rate: 28, sales_taxable: 1000, output_tax: 280, purchase_taxable: 400, input_tax: 100, net_tax: 180 }] }, m);
  assert.equal(rates.sections[0].rows[0].left, '28%'); assert.match(rates.sections[0].rows[0].sub!, /Sales ₹1000.00/);
  const hsn = defOf('gst-hsn')!.build({ totals: { taxable: 1000, tax: 280 }, rows: [{ code: '8708', rate: 28, qty: 3, taxable: 1000, tax: 280, total: 1280 }, { code: '', rate: 18, qty: 1, taxable: 10, tax: 2, total: 12 }] }, m);
  assert.equal(hsn.sections[0].rows[0].left, '8708'); assert.equal(hsn.sections[0].rows[1].left, 'No HSN');
  const opt = defOf('gst-options')!.build({ totals: { cess: 120, tcs: 10, tds: 20, reverse_charge_bills: 1, reverse_charge_value: 1000, composite_turnover: 0, composite_rate: 1, composite_tax: 0 }, rows: [{ number: 'INV-1', party: 'A', date: '2026-10-15', total: 1410, cess: 120, tcs: 10, tds: 20, reverse_charge: true, bill_of_supply: false }] }, m);
  assert.equal(opt.stats[5].label, 'Composite tax payable (1%)'); assert.match(opt.sections[0].rows[0].sub!, /Cess ₹120.00 · TCS ₹10.00 · TDS ₹20.00 · Reverse charge/);
});

test('stock reports, parties and dues: dues skips anyone who owes nothing, and a party row opens its statement', () => {
  const low = defOf('stock-low')!.build({ totals: { items: 1, out_of_stock: 1, refill_cost: 200 }, rows: [{ name: 'Brake pad', qty: 0, min_stock: 5, short: 5, supplier: 'Bosch', refill_cost: 200, out_of_stock: true }] }, m);
  assert.equal(low.stats[1].bad, true); assert.deepEqual(low.sections[0].rows[0], { left: 'Brake pad', right: '0 left', sub: 'Out of stock · Short by 5 · Bosch · Refill ₹200.00' });
  const dues = defOf('customers-dues')!.build({ totals: { due: 300, owing: 1 }, rows: [{ party_id: 4, name: 'Ravi', phone: '98', due: 300, over_limit: true, last_date: '2026-10-01' }, { party_id: 5, name: 'Asha', phone: '', due: 0 }] }, m);
  assert.equal(dues.sections[0].rows.length, 1);
  assert.deepEqual(dues.sections[0].rows[0].open, { id: 'statement', params: { kind: 'customer', party: '4', name: 'Ravi' } });
  const byParty = defOf('purchases-by-party')!.build({ totals: { total: 500, paid: 0, balance: 500 }, rows: [{ party_id: 8, name: 'Bosch', docs: 2, total: 500, balance: 500, last_date: '2026-10-10' }] }, m);
  assert.equal(byParty.sections[0].rows[0].open!.params.kind, 'supplier'); assert.match(byParty.sections[0].rows[0].sub!, /2 purchases/);
});

test('a statement shows the opening and closing balance and a running balance per line', () => {
  const v = statementView({ opening_balance: 0, closing_balance: 180, lines: [{ date: '2026-10-14', type: 'Sale', number: 'INV-7', debit: 1180, credit: 0, balance: 1180 }, { date: '2026-10-15', type: 'Payment', number: '#9', debit: 0, credit: 1000, balance: 180, note: 'UPI' }] }, m);
  assert.equal(v.stats[1].bad, true);
  assert.deepEqual(v.sections[0].rows[1], { left: 'Payment · #9', right: '₹180.00', sub: '2026-10-15 · −₹1000.00 · UPI' });
});

test('every fixed report text is in Hindi and in the other five languages, with the same {placeholders}', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(REPORT_TEXTS)) {
    if (!(k in dict)) missing.push(`${name}: ${k}`);
    else assert.equal(names(dict[k]), names(k), `${name} placeholders: ${k}`);
  }
  assert.deepEqual(missing, []);
});

test('a phrase with a number is translated whole', () => {
  setLangValue('hi'); assert.equal(t('{n} sold', { n: 3 }), '3 बिके'); assert.equal(t('Due {amount}', { amount: '₹5.00' }), 'बकाया ₹5.00'); setLangValue('en');
});
