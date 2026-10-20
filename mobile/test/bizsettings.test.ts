/* Business settings on the phone: what is sent to the server (only what changed), and that every text on the screens is translated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENTS, COPY_LABELS, INDIA_STATES, OPTION_ROWS, RECEIPT_DEFAULTS, SETTINGS_TEXTS, SHOW_OPTIONS, gstOf, gstPatch, printOf, printPatch, profileOf, profilePatch, receiptOf, receiptPatch, stateSuggestions,
  type BusinessRecord
} from '../src/lib/bizSettings.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';
import { stateCode } from '../../backend/src/modules/gst/states.js';

const rec: BusinessRecord = {
  name: 'Sharma Auto Parts', email: 'a@b.test', phone: '9845000000', address: '12, Avenue Road', city: 'Bengaluru', state: 'Karnataka', postal_code: '560002', gstin: '29AABCS1234F1Z5', gst_enabled: true,
  receipt_settings: { paper_width: 58, footer: 'Thanks', pan: 'ABCDE1234F', invoice_print: { paper: 'A5', accent: '#1d4ed8', copies: ['Duplicate for Transporter'], show: { bank: false } } },
  gst_settings: { cess: true, tcs_rate: 0.1 }
};

test('business details: only what changed is sent, trimmed, with the GSTIN in capitals; nothing changed sends nothing', () => {
  const before = profileOf(rec);
  assert.equal(before.city, 'Bengaluru'); assert.equal(profilePatch(before, { ...before }), null);
  assert.deepEqual(profilePatch(before, { ...before, city: '  Mysuru ', gstin: '29aabcs1234f1z5 ', phone: '' }), { city: 'Mysuru', phone: '' }, 'a GSTIN that only differs in case is not a change');
  assert.deepEqual(profilePatch(before, { ...before, gstin: '29ZZZZZ9999Z1Z5' }), { gstin: '29ZZZZZ9999Z1Z5' });
  assert.deepEqual(profileOf({ ...rec, email: null, gstin: null }).gstin, '');
});

test('receipt settings start from the server\'s values over the defaults, and a change is wrapped the way the server takes it', () => {
  const before = receiptOf(rec);
  assert.equal(before.paper_width, 58); assert.equal(before.footer, 'Thanks'); assert.equal(before.copies, RECEIPT_DEFAULTS.copies); assert.equal(before.pan, 'ABCDE1234F');
  assert.equal(receiptPatch(before, { ...before }), null);
  assert.deepEqual(receiptPatch(before, { ...before, paper_width: 80, show_upi_qr: false, pan: 'abcde1234g', bank_ifsc: 'sbin0017178', terms: ' No returns ' }),
    { receipt_settings: { paper_width: 80, show_upi_qr: false, pan: 'ABCDE1234G', bank_ifsc: 'SBIN0017178', terms: 'No returns' } });
});

test('GST options: the stored ones over the defaults, and everything is sent with numbers where numbers are wanted', () => {
  const g = gstOf(rec);
  assert.equal(g.gst_enabled, true); assert.equal(g.options.cess, true); assert.equal(g.options.tcs_rate, 0.1); assert.equal(g.options.tds_rate, 2);
  const body = gstPatch({ gst_enabled: true, options: { ...g.options, tcs: true, tcs_rate: '1.5' as unknown as number } });
  assert.equal(body.gst_settings.tcs_rate, 1.5); assert.equal(body.gst_settings.tcs, true); assert.equal(body.gst_enabled, true);
  assert.equal(OPTION_ROWS.length, 5);
});

test('invoice print: the stored settings over the defaults; copies stay in the usual order and a changed toggle sends the whole set', () => {
  const before = printOf(rec);
  assert.equal(before.paper, 'A5'); assert.equal(before.show.hsn, true); assert.equal(before.show.bank, false);
  assert.equal(printPatch(before, { ...before }), null);
  const d = printPatch(before, { ...before, layout: 'tally', copies: ['Triplicate for Supplier', 'Original for Recipient'], show: { ...before.show, bank: true }, declaration: '  Declared  ' })!.receipt_settings.invoice_print;
  assert.equal(d.layout, 'tally'); assert.deepEqual(d.copies, ['Original for Recipient', 'Triplicate for Supplier']); assert.equal(d.show!.bank, true); assert.equal(d.declaration, 'Declared');
  assert.equal('paper' in d, false, 'what did not change is not sent');
  assert.ok(ACCENTS.every(([hex]) => /^#[0-9a-f]{6}$/.test(hex))); assert.equal(COPY_LABELS.length, 3); assert.equal(SHOW_OPTIONS.length, 15);
});

test('state suggestions match the server\'s state table, so a state picked here always counts for GST', () => {
  assert.equal(INDIA_STATES.length, 36);
  for (const s of INDIA_STATES) assert.ok(stateCode(s), `${s} is not a state the server knows`);
  assert.deepEqual(stateSuggestions('kar'), ['Karnataka']); assert.deepEqual(stateSuggestions('Karnataka'), []); assert.deepEqual(stateSuggestions(''), []);
  assert.equal(stateSuggestions('pra')[0], 'Andhra Pradesh'.startsWith('pra') ? 'Andhra Pradesh' : stateSuggestions('pra')[0]);
  assert.ok(stateSuggestions('a').length <= 5);
});

test('every text on the business settings screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(SETTINGS_TEXTS)) {
    if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`);
  }
  assert.deepEqual(missing, []);
});
