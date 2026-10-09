/* Getting used to the app: the tour, the checklist, the hints, the Help guide, and the words on screen. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checklist, dismiss, empty, HINTS, load, mark, progress, reset, save, shouldOfferTour, shouldShowChecklist, showHint, tour, type HintId } from '../src/lib/onboarding.ts';
import { guide } from '../src/lib/guide.ts';

const memory = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); }, m }; };

test('what the person has seen is remembered, and nothing is counted twice', async () => {
  const kv = memory();
  assert.deepEqual(await load(kv), empty());
  let kept = mark(mark(empty(), 'first_bill'), 'first_bill');
  kept = dismiss(dismiss(kept, 'sell'), 'sell');
  assert.deepEqual(kept, { flags: ['first_bill'], hints: ['sell'] });
  await save(kv, kept);
  assert.deepEqual(await load(kv), kept, 'still there after the app is closed');
  kv.m.set('onboarding', '{broken'); assert.deepEqual(await load(kv), empty(), 'a damaged copy starts fresh instead of crashing');
  assert.deepEqual(reset(), empty());
});

test('a hint shows until it is dismissed, then never again; each hint is short enough to read at the counter', () => {
  let kept = empty();
  assert.equal(showHint(kept, 'sell'), true);
  kept = dismiss(kept, 'sell');
  assert.equal(showHint(kept, 'sell'), false); assert.equal(showHint(kept, 'tables'), true, 'other hints are untouched');
  for (const [id, h] of Object.entries(HINTS) as [HintId, { title: string; body: string }][]) {
    assert.ok(h.title.length <= 30 && h.body.length <= 190, `${id}: ${h.body.length} characters`);
    assert.ok(h.body.split(/[.!?]/).filter(Boolean).length <= 3, `${id}: no more than three sentences`);
  }
});

test('the checklist is ticked by what was done, differs for a café, and finishes by itself', () => {
  const retail = checklist(empty(), false); const food = checklist(empty(), true);
  assert.deepEqual(retail.map((s) => s.id), ['bill', 'scan', 'hold', 'bills']);
  assert.deepEqual(food.map((s) => s.id), ['bill', 'table', 'kitchen', 'bills'], 'a restaurant menu is tapped, so there is no scanning step');
  assert.deepEqual(progress(retail), { done: 0, total: 4, complete: false });
  let kept = mark(empty(), 'first_bill');
  assert.deepEqual(checklist(kept, false).filter((s) => s.done).map((s) => s.id), ['bill']);
  assert.equal(shouldShowChecklist(kept, false), true);
  for (const f of ['first_scan', 'first_hold', 'first_bills_page'] as const) kept = mark(kept, f);
  assert.deepEqual(progress(checklist(kept, false)), { done: 4, total: 4, complete: true });
  assert.equal(shouldShowChecklist(kept, false), false, 'all done: it goes away');
  assert.equal(shouldShowChecklist(kept, true), true, 'a café still has its table and kitchen steps');
  assert.equal(shouldShowChecklist(mark(empty(), 'checklist_hidden'), false), false, 'hidden stays hidden');
});

test('the tour is offered once: never again after it was finished or skipped', () => {
  assert.equal(shouldOfferTour(empty()), true);
  assert.equal(shouldOfferTour(mark(empty(), 'tour_done')), false);
  assert.equal(tour(false).length, 3); assert.equal(tour(true).length, 3, 'three screens at most');
  assert.notEqual(tour(true)[2].title, tour(false)[2].title, 'a café hears about tables and the kitchen');
  for (const slide of [...tour(true), ...tour(false)]) assert.ok(slide.lines.length >= 2 && slide.lines.every((l) => l.length <= 70), slide.title);
});

/* ── Help ───────────────────────────────────────────────────────────────── */

const SRC = join(import.meta.dirname, '..', 'src');
const routeFile = (route: string) => {
  const name = route.replace(/^\//, '');
  return [join(SRC, 'app', `${name}.tsx`), join(SRC, 'app', '(tabs)', `${name}.tsx`)].some(existsSync);
};

test('every task in Help is a few real steps, and every "Try it" and checklist link goes to a screen that exists', () => {
  for (const food of [false, true]) {
    const tasks = guide(food);
    assert.ok(tasks.length >= 6);
    for (const t of tasks) {
      assert.ok(t.steps.length >= 3 && t.steps.length <= 6, `${t.id}: ${t.steps.length} steps`);
      assert.ok(t.steps.every((st) => st.length <= 150), `${t.id}: each step is short`);
      if (t.go) assert.ok(routeFile(t.go), `${t.id} links to ${t.go}`);
    }
    for (const st of checklist(empty(), food)) assert.ok(routeFile(st.go), `checklist step ${st.id} links to ${st.go}`);
  }
  assert.ok(guide(true).some((t) => t.id === 'table') && guide(true).some((t) => t.id === 'kitchen'), 'a café is taught tables and the kitchen');
  assert.ok(!guide(false).some((t) => t.id === 'table'), 'a shop is not');
});

/* ── the words on screen ────────────────────────────────────────────────── */

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []; });
const quoted = (code: string) => [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]).filter((t) => /[A-Za-z]{3,} [A-Za-z]{2,}/.test(t) && !/^(\.|\/|https?:|@|[a-z]+:)/.test(t));

test('no technical word reaches a person: the screens talk about bills and products, not outboxes, catalogues or syncing', () => {
  const banned = /\b(outbox|catalogue|idempotency|idempotent|sync|synced|syncing|SKU|payload|endpoint|token expired|database|SQLite|NetworkError)\b/i;
  const found: string[] = [];
  for (const f of [...files(join(SRC, 'app')), ...files(join(SRC, 'lib'))]) {
    const code = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && !/^\s*import /.test(l)).map((l) => l.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/ .*$/, '')).join('\n');
    for (const t of quoted(code).map((x) => x.replace(/\$\{[^}]*(\}|$)/g, ''))) if (banned.test(t)) found.push(`${f.split('src')[1]}: "${t.slice(0, 80)}"`);
  }
  assert.deepEqual(found, [], 'jargon on screen');
});

test('one vocabulary: a bill is a bill (never "a sale" for one transaction), and the tab people use to find them is called Bills', () => {
  const layout = readFileSync(join(SRC, 'app', '(tabs)', '_layout.tsx'), 'utf8');
  assert.match(layout, /tab\('Bills'/); assert.doesNotMatch(layout, /tab\('Sales'/);
  const found: string[] = [];
  for (const f of [...files(join(SRC, 'app')), ...files(join(SRC, 'lib'))]) {
    const code = readFileSync(f, 'utf8');
    for (const t of quoted(code)) if (/\b(sales? (on|waiting|made|saved|are|have|is)|a sale\b|this sale|New sale|Sale saved)/i.test(t)) found.push(`${f.split('src')[1]}: "${t.slice(0, 80)}"`);
  }
  assert.deepEqual(found, [], 'say "bill" for one transaction; "sales" only for the money total');
});
