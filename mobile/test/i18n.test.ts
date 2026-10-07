/* Hindi: the dictionary is complete for what the shared screens say, placeholders survive, and a missing text shows English, never a blank. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HI, fill, getLang, setLangValue, t, tx } from '../src/lib/i18n.ts';
import { HINTS, tour, checklist, empty } from '../src/lib/onboarding.ts';
import { guide } from '../src/lib/guide.ts';

test('English stays English; Hindi translates what it knows and falls back to English for what it does not', () => {
  setLangValue('en'); assert.equal(t('Take payment'), 'Take payment');
  setLangValue('hi'); assert.equal(t('Take payment'), 'पेमेंट लें'); assert.equal(t('A text nobody translated'), 'A text nobody translated');
  assert.equal(tx(42), 42, 'only strings are translated'); assert.equal(tx('Back'), 'पीछे');
  setLangValue('en'); assert.equal(getLang(), 'en');
});

test('values are filled in, in either language, and an unknown name is left visible rather than blank', () => {
  assert.equal(fill('{n} items · GST {gst}', { n: 3, gst: '₹5.00' }), '3 items · ₹5.00'.replace('items · ', 'items · GST ').replace('GST ₹5.00', 'GST ₹5.00'));
  setLangValue('hi'); assert.equal(t('{n} items · GST {gst}', { n: 3, gst: '₹5.00' }), '3 आइटम · GST ₹5.00'); assert.equal(t('{done} of {total}', { done: 1, total: 4 }), '4 में से 1');
  assert.equal(fill('Hello {who}', {}), 'Hello {who}'); setLangValue('en');
});

test('every translation keeps the same {placeholders} as its English, and none is empty', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [en, hi] of Object.entries(HI)) { assert.ok(hi.trim().length > 0, `empty: ${en}`); assert.equal(names(hi), names(en), `placeholders differ: ${en}`); }
});

test('the tour, the hints, the checklist and Help are all translated', () => {
  const needed = new Set<string>();
  for (const h of Object.values(HINTS)) { needed.add(h.title); needed.add(h.body); }
  for (const food of [true, false]) {
    for (const sl of tour(food)) { needed.add(sl.title); sl.lines.forEach((l) => needed.add(l)); }
    for (const st of checklist(empty(), food)) { needed.add(st.label); needed.add(st.why); }
    for (const g of guide(food)) { needed.add(g.title); g.steps.forEach((x) => needed.add(x)); if (g.goLabel) needed.add(g.goLabel); }
  }
  const missing = [...needed].filter((x) => !(x in HI));
  assert.deepEqual(missing, [], 'not yet in Hindi');
});

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []; });

test('every button, tab and list row written as plain text in the screens has a Hindi version', () => {
  const src = join(import.meta.dirname, '..', 'src');
  const skip = /^(58 mm|80 mm|FlowXP|Email|Name|GSTIN|MRP|UPI|CASH|UPI|CARD)/;
  const missing = new Set<string>();
  for (const f of files(src)) {
    const code = readFileSync(f, 'utf8');
    for (const m of code.matchAll(/\b(?:title|left|sub|placeholder)="([A-Z][^"{}]{2,})"/g)) if (!(m[1] in HI) && !skip.test(m[1])) missing.add(m[1]);
  }
  assert.deepEqual([...missing].sort(), [], 'Hindi missing for these on-screen texts');
});
