/* Restore from a backup on the phone: who may, the file check, how the preview and the result read, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RESTORE_TEXTS, canApply, canRestore, headline, isZipName, pickProblem, problemLines, shownTables, sourceLine, tableLine, type RestoreReport } from '../src/lib/restore.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const table = (over: Partial<RestoreReport['tables'][number]> = {}) => ({ file: 'customers.csv', label: 'Customers', found: true, rows: 10, added: 2, already_there: 8, not_needed: 0, skipped: 0, problems: [], ...over });
const report = (over: Partial<RestoreReport> = {}): RestoreReport => ({ applied: false, source: { name: 'Sharma Auto Parts', gstin: null, made_on: '2026-10-15' }, tables: [table(), table({ file: 'invoices.csv', label: 'Bills', added: 1, already_there: 4, skipped: 1, problems: [{ row: 3, why: 'it clashes with a record that is already here' }] }), table({ file: 'refunds.csv', label: 'Refunds', found: false, rows: 0 })], totals: { added: 3, already_there: 12, skipped: 1 }, notes: [], ...over });

test('only the owner may restore', () => { assert.equal(canRestore('OWNER'), true); assert.equal(canRestore('MANAGER'), false); assert.equal(canRestore(null), false); });

test('the file check', () => {
  assert.equal(isZipName('flowxp-backup-2026-10-15.zip'), true); assert.equal(isZipName('FLOWXP.ZIP'), true); assert.equal(isZipName('backup.csv'), false);
  assert.equal(pickProblem('b.zip', 1000), ''); assert.equal(pickProblem('b.pdf', 1000), 'Choose the ZIP file you downloaded from FlowXP'); assert.equal(pickProblem('b.zip', 60 * 1024 * 1024), 'That file is too large to restore here'); assert.equal(pickProblem('b.zip', null), '');
});

test('how the preview and the result read', () => {
  const r = report();
  assert.equal(sourceLine(r), 'From Sharma Auto Parts, made on 2026-10-15.'); assert.equal(sourceLine(report({ source: { name: null, gstin: null, made_on: null } })), '');
  assert.equal(headline(r), '3 records would be added.'); assert.equal(headline(report({ applied: true })), '3 records were added.');
  assert.equal(headline(report({ totals: { added: 0, already_there: 12, skipped: 0 } })), 'Nothing was missing: everything in the backup is already here.');
  assert.equal(tableLine(table(), false), '2 to add · 8 already here'); assert.equal(tableLine(table({ skipped: 1 }), true), '2 added · 8 already here · 1 skipped');
  assert.deepEqual(shownTables(r).map((x) => x.label), ['Customers', 'Bills'], 'a file that was not in the backup, or was empty, is not listed');
  assert.deepEqual(problemLines(r), ['Bills, row 3: it clashes with a record that is already here']);
  assert.equal(canApply(r), true); assert.equal(canApply(report({ applied: true })), false); assert.equal(canApply(report({ totals: { added: 0, already_there: 5, skipped: 0 } })), false); assert.equal(canApply(null), false);
});

test('every text of the restore screen is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(RESTORE_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
