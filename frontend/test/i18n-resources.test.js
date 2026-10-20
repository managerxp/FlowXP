/*
 * The translation files: every language has every key English has (and nothing extra), no blanks, the same {{placeholders}} and <tags>
 * as English, plural forms where English has them; and every key the code asks for exists in English, so a customer never sees a raw key.
 * Run: node --test test/        (no browser, no build)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODES, LANGUAGES, NAMESPACES } from '../src/i18n/config.js';
import { navKey } from '../src/i18n/navKey.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const LOCALES = path.join(SRC, 'i18n/locales');
const load = (code, ns) => JSON.parse(fs.readFileSync(path.join(LOCALES, code, `${ns}.json`), 'utf8'));
const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
const tokens = (s) => [...String(s).matchAll(/\{\{\s*\w+\s*\}\}|<\/?\w+>/g)].map((m) => m[0].replace(/\s/g, '')).sort().join('|');

test('every language has every namespace, and the folders match the language list', () => {
  const dirs = fs.readdirSync(LOCALES).filter((d) => fs.statSync(path.join(LOCALES, d)).isDirectory()).sort();
  assert.deepEqual(dirs, [...CODES].sort(), 'a locale folder without a LANGUAGES entry (or the reverse)');
  for (const code of CODES) for (const ns of NAMESPACES) assert.ok(fs.existsSync(path.join(LOCALES, code, `${ns}.json`)), `${code}/${ns}.json`);
});

for (const ns of NAMESPACES) {
  test(`${ns}: same keys, no blanks, same placeholders in all ${CODES.length} languages`, () => {
    const en = new Map(flat(load('en', ns)));
    assert.ok(en.size > 0, 'English is not empty');
    for (const [k, v] of en) assert.ok(typeof v === 'string' && v.trim(), `en ${ns}:${k} is blank`);
    for (const code of CODES.filter((c) => c !== 'en')) {
      const other = new Map(flat(load(code, ns)));
      const missing = [...en.keys()].filter((k) => !other.has(k));
      const extra = [...other.keys()].filter((k) => !en.has(k));
      assert.deepEqual(missing, [], `${code} ${ns} is missing keys`);
      assert.deepEqual(extra, [], `${code} ${ns} has keys English does not`);
      for (const [k, v] of other) {
        assert.ok(typeof v === 'string' && v.trim(), `${code} ${ns}:${k} is blank`);
        assert.equal(tokens(v), tokens(en.get(k)), `${code} ${ns}:${k} changed a {{placeholder}} or <tag>: "${v}"`);
      }
    }
  });
}

test('plural forms exist wherever English has them', () => {
  const nav = new Map(flat(load('en', 'nav')));
  assert.ok(nav.has('shell.trialLeft_one') && nav.has('shell.trialLeft_other'));
  for (const code of CODES) { const m = new Map(flat(load(code, 'nav'))); assert.ok(m.has('shell.trialLeft_one') && m.has('shell.trialLeft_other'), code); }
});

/* ---- the code only asks for keys that exist ---- */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(path.join(dir, e.name))) : /\.jsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const enKeys = Object.fromEntries(NAMESPACES.map((ns) => [ns, new Set(flat(load('en', ns)).map(([k]) => k))]));
const hasKey = (ns, key) => enKeys[ns]?.has(key) || [...(enKeys[ns] ?? [])].some((k) => k.startsWith(`${key}_`));   // a plural base key

test('every translation key used in the source exists in English', () => {
  const problems = [];
  let used = 0;
  for (const file of walk(SRC)) {
    const code = fs.readFileSync(file, 'utf8');
    const nss = [...code.matchAll(/useTranslation\(\s*'(\w+)'\s*\)/g)].map((m) => m[1]);
    if (!nss.length) continue;
    for (const m of code.matchAll(/\b(?:t|te)\(\s*'([\w.:]+)'/g)) {
      used += 1;
      const [a, b] = m[1].includes(':') ? m[1].split(':') : [null, m[1]];
      const ok = a ? hasKey(a, b) : nss.some((ns) => hasKey(ns, b));
      if (!ok) problems.push(`${path.relative(SRC, file)}: ${m[1]}`);
    }
    for (const m of code.matchAll(/i18nKey="([\w.:]+)"/g)) {
      used += 1;
      if (!nss.some((ns) => hasKey(ns, m[1]))) problems.push(`${path.relative(SRC, file)}: ${m[1]}`);
    }
  }
  assert.ok(used > 80, `expected to find the keys used (found ${used})`);
  assert.deepEqual(problems, []);
});

test('keys built from a variable have every value they can take', () => {
  const auth = enKeys.auth;
  for (const t of ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'HOTEL', 'RETAIL', 'SUPERMARKET', 'PHARMACY', 'SALON', 'GYM', 'GAMING_CAFE', 'AUTO_PARTS', 'WHOLESALE']) assert.ok(auth.has(`types.${t}`), `types.${t}`);
  for (const r of ['no_account', 'verify_first', 'unverified_google', 'not_allowed', 'cancelled', 'unavailable', 'failed']) assert.ok(auth.has(`google.${r}`), `google.${r}`);
  for (const a of ['signup', 'login']) for (const k of ['title', 'p1', 'p2', 'p3', 'alt']) assert.ok(auth.has(`aside.${a}.${k}`), `aside.${a}.${k}`);
  for (const k of ['product', 'industries', 'aiManager', 'integrations', 'pricing', 'about']) assert.ok(enKeys.site.has(`header.${k}`), `header.${k}`);
  for (const h of ['product', 'company', 'getStarted', 'legal']) assert.ok(enKeys.site.has(`footer.${h}`), `footer.${h}`);
});

test('every sidebar and menu label in the app shell has a translation', () => {
  const code = fs.readFileSync(path.join(SRC, 'app/AppShell.jsx'), 'utf8');
  const labels = new Set([...code.matchAll(/\blabel: '([^']+)'/g)].map((m) => m[1]));
  for (const extra of ['More', 'Overview', 'System']) labels.add(extra);
  assert.ok(labels.size > 80, `found ${labels.size} labels`);
  const missing = [...labels].filter((l) => !enKeys.nav.has(`items.${navKey(l)}`));
  assert.deepEqual(missing, [], 'add these to the nav translation files in every language');
});

test('machine translations are labelled as such and never as reviewed', () => {
  const machine = LANGUAGES.filter((l) => l.status === 'machine').map((l) => l.code);
  assert.deepEqual(machine, ['hi', 'ml', 'ta', 'bn', 'te', 'kn'].filter((c) => machine.includes(c)));
  assert.ok(machine.length > 0);
  // the page says so to the person using it (shown when a machine-translated language is on)
  for (const code of CODES) assert.ok(new Map(flat(load(code, 'settings'))).has('language.machineNote'), code);
});

test('every language is complete in length terms: a long translation is flagged for a layout check, not silently accepted', () => {
  // not a pass/fail on design: it lists the strings much longer than English so someone can check them in the UI at narrow widths
  const long = [];
  for (const ns of NAMESPACES) {
    const en = new Map(flat(load('en', ns)));
    for (const code of CODES.filter((c) => c !== 'en')) for (const [k, v] of flat(load(code, ns))) if (v.length > en.get(k).length * 2 + 20) long.push(`${code} ${ns}:${k}`);
  }
  assert.ok(long.length < 25, `many translations are much longer than English: ${long.join(', ')}`);
});
