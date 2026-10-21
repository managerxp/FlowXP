/* Workshop extras on the phone: mechanic mode, labour services, earnings, WhatsApp choices, quick racks, the customer file, help me find, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRAS_TEXTS, showHelpButton, canImport, canMechanicMode, checkLine, dayLine, earningStats, errorLines, findTasks, importFileProblem, monthStart, parseCsv, quickRacksProblem, quickRacksSummary, serviceBody, serviceLabourBody, serviceLine, serviceProblem, serviceSub, shareFor, storeCode, workshopOn
} from '../src/lib/workshopExtras.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('mechanic mode: on unless the server says off, owner only', () => {
  assert.equal(workshopOn({ workshop_mode: false }), false); assert.equal(workshopOn({ workshop_mode: true }), true); assert.equal(workshopOn({}), true, 'an older server leaves things as they were'); assert.equal(workshopOn(null), true);
  assert.equal(canMechanicMode('OWNER'), true); assert.equal(canMechanicMode('MANAGER'), false);
});

test('services: the form, the body and the one-tap labour line', () => {
  const sv = { service_id: 1, name: 'Wheel alignment', price_paise: 65000, tax_rate: 12 };
  assert.equal(serviceLine(sv), 'Wheel alignment · ₹650.00'); assert.equal(serviceSub(sv), 'GST 12%'); assert.equal(serviceSub({ ...sv, tax_rate: null }), 'Shop GST rate');
  assert.equal(serviceProblem(' ', '1', ''), 'Give the service a name'); assert.equal(serviceProblem('Oil', '', ''), 'Enter the charge'); assert.equal(serviceProblem('Oil', '300', '120'), 'GST is a number from 0 to 100'); assert.equal(serviceProblem('Oil', '300', ''), '');
  assert.deepEqual(serviceBody(' Oil change ', '300', ''), { name: 'Oil change', price: 300 }); assert.deepEqual(serviceBody('Oil', '300', '12'), { name: 'Oil', price: 300, tax_rate: 12 });
  assert.deepEqual(serviceLabourBody(sv), { kind: 'LABOUR', description: 'Wheel alignment', unit_price: 650, tax_rate: 12 }); assert.deepEqual(serviceLabourBody({ ...sv, tax_rate: null }), { kind: 'LABOUR', description: 'Wheel alignment', unit_price: 650 });
});

test('earnings read plainly', () => {
  const e = { from: '2026-10-01', to: '2026-10-21', totals: { jobs: 3, labour_paise: 150000, parts_paise: 400000, total_paise: 650000 }, days: [{ day: '2026-10-20', jobs: 2, labour_paise: 100000, parts_paise: 300000, total_paise: 470000 }], mechanics: [] };
  assert.deepEqual(earningStats(e), [['Jobs billed', '3'], ['Labour', '₹1,500.00'], ['Parts', '₹4,000.00'], ['Billed with GST', '₹6,500.00']]);
  assert.equal(dayLine(e.days[0]), '2 jobs · Labour ₹1,000.00 · Parts ₹3,000.00'); assert.equal(monthStart('2026-10-21'), '2026-10-01');
});

test('WhatsApp choices follow the job: no estimate with nothing on it, no bill before there is one, nobody without a number', () => {
  const j = { status: 'OPEN', lines: [] as unknown[], invoice_id: null as number | null, customer_phone: '9000000010' as string | null };
  assert.deepEqual(shareFor(j).map((c) => c.id), ['received', 'ready']);
  assert.deepEqual(shareFor({ ...j, lines: [1] }).map((c) => c.id), ['received', 'estimate', 'ready']);
  assert.deepEqual(shareFor({ ...j, status: 'BILLED', lines: [1], invoice_id: 9 }).map((c) => c.id), ['bill']);
  assert.deepEqual(shareFor({ ...j, customer_phone: null }), []); assert.deepEqual(shareFor({ ...j, status: 'CANCELLED' }), []);
});

test('quick racks: the numbers, the code and the sentence', () => {
  assert.equal(quickRacksProblem({ store: '', racks: '5', bins: '4' }), 'Name your store or godown'); assert.notEqual(quickRacksProblem({ store: 'Main', racks: '41', bins: '4' }), ''); assert.notEqual(quickRacksProblem({ store: 'Main', racks: '5', bins: '27' }), ''); assert.notEqual(quickRacksProblem({ store: 'Main', racks: '2.5', bins: '4' }), '');
  assert.equal(quickRacksProblem({ store: 'Main store', racks: '5', bins: '4' }), '');
  assert.equal(storeCode('Main store'), 'MAINSTOR'); assert.equal(storeCode('!!'), 'MAIN');
  assert.equal(quickRacksSummary({ store: 'Main store', racks: '5', bins: '4' }), 'This makes 5 racks and 20 bins. The first bin will be called MAINSTOR-R01-A.');
});

test('the customer file: CSV with quotes, the file check and the result lines', () => {
  const rows = parseCsv('﻿Name,Phone,Address\r\n"Ravi, Motors",98765 43210,"12 ""Main"" Road"\r\nAnil,,\r\n\r\n');
  assert.deepEqual(rows, [{ Name: 'Ravi, Motors', Phone: '98765 43210', Address: '12 "Main" Road' }, { Name: 'Anil', Phone: '', Address: '' }]); assert.deepEqual(parseCsv('Name\n'), []);
  assert.equal(importFileProblem('c.csv', 100), ''); assert.notEqual(importFileProblem('c.xlsx', 100), ''); assert.equal(importFileProblem('c.csv', 9 * 1024 * 1024), 'That file is too large');
  const c = { rows: 3, to_create: 2, already_here: 1, total_errors: 0, errors: [], applied: false, created: 0 };
  assert.equal(checkLine(c), '2 to add, 1 already here.'); assert.equal(canImport(c), true); assert.equal(canImport({ ...c, total_errors: 1 }), false); assert.equal(canImport({ ...c, applied: true, created: 2 }), false); assert.equal(canImport(null), false);
  assert.equal(checkLine({ ...c, applied: true, created: 2 }), '2 customers were added.');
  assert.deepEqual(errorLines({ ...c, total_errors: 1, errors: [{ row: 3, message: 'Enter a valid phone number' }] }), ['Row 3: Enter a valid phone number']);
});

test('help me find: only what this person can open, best match first', () => {
  const ctx = { parts: true, workshop: true, owner: true };
  assert.equal(findTasks('racks', ctx)[0].go, '/parts-manage'); assert.equal(findTasks('job card', ctx)[0].go, '/job-cards');
  assert.ok(!findTasks('job card', { parts: true, workshop: false, owner: false }).some((x) => x.go === '/job-cards'), 'mechanic mode off hides the workshop');
  assert.ok(!findTasks('backup', { parts: true, workshop: true, owner: false }).some((x) => x.go === '/restore-backup'), 'owner only');
  assert.ok(findTasks('', { parts: false, workshop: false, owner: false }).every((x) => x.need === 'any'), 'a shop that is not a parts shop sees only the general ones');
  assert.deepEqual(findTasks('zzzz', ctx), []); assert.equal(findTasks('', ctx).length, 6);
});

test('the floating help button stays off sign in, the till, paying, the receipt and the help screen', () => {
  for (const p of ['/', '/login', '/signup', '/sell', '/pay', '/receipt', '/receipt/', '/scan', '/help-find']) assert.equal(showHelpButton(p), false, p);
  for (const p of ['/home', '/more', '/job-cards', '/job-card/5', '/parts-manage', '/customers']) assert.equal(showHelpButton(p), true, p);
});

test('every text of the workshop extras is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(EXTRAS_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
