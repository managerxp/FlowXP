/* GST filing on the phone: months, which GSTIN, the files it asks for, the 3B table, and the checks made before sending. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GST_TEXTS, canFile, cleanIrn, einvoiceRequest, gstinOptions, gstr1Request, gstr3bRows, irnProblem, limitProblem, monthLabel, monthOf, pickGstin, recentMonths, type Filings, type Gstr3b } from '../src/lib/gstFiling.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('the months offered start with last month, newest first, across a year end', () => {
  assert.deepEqual(recentMonths(new Date(2026, 9, 15), 4), ['2026-09', '2026-08', '2026-07', '2026-06']);
  assert.deepEqual(recentMonths(new Date(2026, 0, 3), 3), ['2025-12', '2025-11', '2025-10']); assert.equal(recentMonths(new Date(2026, 9, 15)).length, 12);
  assert.equal(monthOf(new Date(2026, 2, 31)), '2026-03'); assert.equal(monthLabel('2026-09'), 'Sep 2026');
});

test('which GSTIN: the one already chosen if still offered, else the business\'s own, else the first with invoices', () => {
  const f = (business_gstin: string | null, gstins: string[]): Filings => ({ period: '2026-09', business_gstin, gst_enabled: true, gstins: gstins.map((g) => ({ gstin: g, invoices: 1, taxable_value: 1 })) });
  assert.equal(pickGstin('', f('29AAA', ['29AAA', '27BBB'])), '29AAA'); assert.equal(pickGstin('27BBB', f('29AAA', ['29AAA', '27BBB'])), '27BBB'); assert.equal(pickGstin('07ZZZ', f('29AAA', ['27BBB'])), '29AAA');
  assert.equal(pickGstin('', f(null, ['27BBB'])), '27BBB'); assert.equal(pickGstin('', f(null, [])), '');
  assert.deepEqual(gstinOptions(f('29AAA', ['29AAA', '27BBB'])), ['29AAA', '27BBB']); assert.deepEqual(gstinOptions(f(null, [])), []);
});

test('the file requests: the portal\'s file names, the right path, and the headers the app sends', () => {
  const sess = { token: 't', businessId: 4, branchId: null };
  const g1 = gstr1Request('https://api.flowxp.in/', sess, '2026-09', '29AABCS1234F1Z5');
  assert.equal(g1.url, 'https://api.flowxp.in/api/gst/gstr1?period=2026-09&gstin=29AABCS1234F1Z5&download=1'); assert.equal(g1.fileName, 'GSTR1_29AABCS1234F1Z5_092026.json'); assert.equal(g1.headers.Authorization, 'Bearer t');
  const ei = einvoiceRequest('https://api.flowxp.in', sess, '2026-09', '29AABCS1234F1Z5');
  assert.equal(ei.url, 'https://api.flowxp.in/api/gst/einvoice?period=2026-09&gstin=29AABCS1234F1Z5&download=1'); assert.equal(ei.fileName, 'einvoice_29AABCS1234F1Z5_2026-09.json');
});

test('the 3B table: outward supplies, nil-rated, each inter-state state, input credit, and the tax to pay in bold', () => {
  const d: Gstr3b = { outward_taxable: { taxable: 1000, igst: 0, cgst: 90, sgst: 90 }, outward_nil_or_exempt: { taxable: 50 }, inter_state_to_unregistered: [{ pos: '27', taxable: 400, igst: 72 }], itc: { igst: 0, cgst: 20, sgst: 20, ineligible: 5 }, tax_payable_in_cash: { igst: 72, cgst: 70, sgst: 70 }, notes: [] };
  const rows = gstr3bRows(d);
  assert.deepEqual(rows.map((r) => r.label), ['3.1(a) Outward taxable supplies (net of credit notes)', '3.1(c) Nil-rated, exempt', '3.2 Inter-state to unregistered, state 27', '4(A) Input tax credit you can claim', 'Tax to pay in cash (after credit)']);
  assert.deepEqual(rows[0], { label: rows[0].label, taxable: 1000, igst: 0, cgst: 90, sgst: 90 }); assert.equal(rows[2].igst, 72); assert.equal(rows[4].strong, true); assert.equal(rows.filter((r) => r.strong).length, 1);
  assert.equal(gstr3bRows({ ...d, inter_state_to_unregistered: [] }).length, 4);
  assert.equal(gstr3bRows({ ...d, outward_taxable: { taxable: 1 } })[0].cgst, 0, 'a missing tax is zero, not undefined');
});

test('an IRN is 64 hex characters (case and spaces forgiven); the limit is a positive amount; only owners and admins file', () => {
  const irn = 'a'.repeat(64);
  assert.equal(irnProblem(irn), ''); assert.equal(irnProblem(` ${irn.toUpperCase()} `), ''); assert.equal(cleanIrn(` ${irn.toUpperCase()} `), irn); assert.notEqual(irnProblem('a'.repeat(63)), ''); assert.notEqual(irnProblem('g'.repeat(64)), ''); assert.notEqual(irnProblem(''), '');
  assert.equal(limitProblem('250000'), ''); assert.notEqual(limitProblem('0'), ''); assert.notEqual(limitProblem('-5'), ''); assert.notEqual(limitProblem('x'), ''); assert.notEqual(limitProblem('200000000'), '');
  assert.equal(canFile('OWNER'), true); assert.equal(canFile('ADMIN'), true); assert.equal(canFile('ACCOUNTANT'), false); assert.equal(canFile(undefined), false);
});

test('every text of the GST filing screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(GST_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
