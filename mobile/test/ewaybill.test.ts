/* E-way bills on the phone: who may prepare one, the form checks, the body sent, the file name, the number the portal returns, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EWAY_TEXTS, canEway, cleanNumber, distanceProblem, emptyEway, ewayBody, fileName, fileText, formProblem, gstinProblem, numberProblem, recordBody, savedText } from '../src/lib/ewayBill.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only owners and admins, for a customer with a GSTIN', () => {
  assert.equal(canEway('OWNER', true), true); assert.equal(canEway('ADMIN', true), true); assert.equal(canEway('CASHIER', true), false); assert.equal(canEway('OWNER', false), false); assert.equal(canEway(undefined, true), false);
});

test('the form: distance up to 4000 whole km, a transporter GSTIN of the right shape, both optional', () => {
  assert.equal(distanceProblem(''), ''); assert.equal(distanceProblem('250'), ''); assert.equal(distanceProblem('4000'), ''); assert.notEqual(distanceProblem('4001'), ''); assert.notEqual(distanceProblem('12.5'), ''); assert.notEqual(distanceProblem('-3'), '');
  assert.equal(gstinProblem(''), ''); assert.equal(gstinProblem('29aabcs1234f1z5'), ''); assert.notEqual(gstinProblem('29AABCS1234F1Z'), ''); assert.notEqual(gstinProblem('hello'), '');
  assert.equal(formProblem(emptyEway()), ''); assert.notEqual(formProblem({ ...emptyEway(), distance_km: 'x' }), '');
});

test('the body sent: vehicle and GSTIN tidied, no distance when blank', () => {
  const b = ewayBody(7, { mode: 'road', distance_km: '120', vehicle_no: ' ka 01 ab 1234 ', transporter_id: ' 29aabcs1234f1z5 ', transporter_name: ' Sharma Transport ' });
  assert.deepEqual(b, { invoice_id: 7, transport: { mode: 'road', distance_km: 120, vehicle_no: 'KA01AB1234', transporter_id: '29AABCS1234F1Z5', transporter_name: 'Sharma Transport' } });
  assert.equal(ewayBody(7, emptyEway()).transport.distance_km, undefined);
});

test('the file and the number: a safe file name, readable JSON, 12 digits with spaces forgiven', () => {
  assert.equal(fileName('INV/2026/0042'), 'eway_INV_2026_0042.json');
  const r = { invoice_number: 'A1', ready: true, errors: [], warnings: [], json: { version: '1.0.0321', billLists: [{ a: 1 }] } };
  assert.deepEqual(JSON.parse(fileText(r)), r.json); assert.match(fileText(r), /\n {2}"version"/);
  assert.equal(numberProblem('1234 5678 9012'), ''); assert.equal(cleanNumber('1234 5678 9012'), '123456789012'); assert.notEqual(numberProblem('12345678901'), ''); assert.notEqual(numberProblem('12345678901a'), '');
  assert.deepEqual(recordBody('1234 5678 9012', '2026-10-16'), { eway_bill_no: '123456789012', date: '2026-10-16' }); assert.equal(savedText('123456789012'), 'E-way bill 123456789012 is saved on this invoice.');
});

test('every text of the e-way bill screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(EWAY_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
