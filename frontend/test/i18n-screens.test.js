/* The screen texts (useT / tr('English text')): every text a screen asks for is in screens.json, and every language has a real translation of it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODES } from '../src/i18n/config.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const LOCALES = path.join(SRC, 'i18n/locales');
const load = (code) => JSON.parse(fs.readFileSync(path.join(LOCALES, code, 'screens.json'), 'utf8'));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(path.join(dir, e.name))) : /\.jsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

test('every tr(\'English text\') in the source has its text in screens.json', () => {
  const screens = new Set(Object.keys(load('en')));
  const problems = []; let used = 0;
  const re = /\b(?:tr|T)\(\s*'((?:[^'\\\n]|\\.)*)'/g;
  for (const file of walk(SRC)) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(re)) {
      used += 1;
      const text = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      if (!screens.has(text)) problems.push(`${path.relative(SRC, file)}: ${text.slice(0, 60)}`);
    }
  }
  assert.ok(used > 500, `expected many tr() texts (found ${used})`);
  assert.deepEqual(problems, []);
});

test('every text in screens.json is used by some screen (no leftovers)', () => {
  const used = new Set();
  const re = /\b(?:tr|T)\(\s*'((?:[^'\\\n]|\\.)*)'/g;
  for (const file of walk(SRC)) for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) used.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  const unused = Object.keys(load('en')).filter((k) => !used.has(k));
  assert.deepEqual(unused, []);
});

test('no language leaves a text as the English copy, unless it is a code or a name', () => {
  const en = load('en');
  const SAME_OK = /^(GSTIN|CGST|IGST|HSN \/ SAC|IRN|PIN|SKU:|MRP \(₹\)|A4 \/ PDF|Flow AI|· HSN|IND|MRP|SKU|CSV|GSTR-1|GSTR-3B|GSTIN|FIFA 26, Tekken 8, GTA V|make,model,vehicle_type,.*)( \{\{\w+\}\})?$/;
  const same = [];
  for (const code of CODES.filter((c) => c !== 'en')) {
    const t = load(code);
    for (const [k, v] of Object.entries(en)) if (t[k] === v && !SAME_OK.test(k) && /[A-Za-z]{4}/.test(k.replace(/\{\{\w+\}\}/g, '').replace(/[A-Z]{2,}/g, ''))) same.push(`${code}: ${k.slice(0, 40)}`);
  }
  assert.deepEqual(same, []);
});
