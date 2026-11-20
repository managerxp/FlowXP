import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HI } from '../src/lib/i18n.ts';
import { ML, TA, BN, TE, KN } from '../src/lib/i18n.more.ts';
import { DESIGN_TEXTS, ICONS, DEFAULT_LOOK, cardBody, canDesign, lookOf, readableOn, suggestedIcons } from '../src/lib/cardDesign.ts';

test('the icons offered are exactly the ones the server accepts', () => {
  const src = readFileSync(new URL('../../backend/src/modules/loyaltyEngine.js', import.meta.url), 'utf8');
  const server = [...(/CARD_ICONS = \[([^\]]*)\]/.exec(src)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(ICONS).sort(), server);
});

test('a barber sees scissors, a Caesar crown and a coffee mug among five; every business gets five or six, all real icons', () => {
  assert.deepEqual(suggestedIcons('SALON'), ['scissors', 'crown', 'coffee', 'sparkles', 'smile']);
  assert.equal(suggestedIcons('SALON', 'heart').length, 6);          // the icon already chosen stays visible
  for (const t of ['RESTAURANT', 'CAFE', 'GYM', 'MECHANIC', 'CLOTHING', 'SOMETHING_ELSE', undefined]) { const l = suggestedIcons(t); assert.equal(l.length, 5); assert.ok(l.every((k) => k in ICONS)); }
});

test('own colours: text turns dark on light and white on dark; only real colours are sent', () => {
  assert.equal(readableOn('#fef3c7'), '#111827'); assert.equal(readableOn('#111827'), '#ffffff');
  const body = cardBody({ ...DEFAULT_LOOK, bg: '#ABCDEF', accent: 'red', title: '  Hi  ', message: 'x'.repeat(200) }).card;
  assert.equal(body.bg, '#abcdef'); assert.equal(body.accent, DEFAULT_LOOK.accent); assert.equal(body.title, 'Hi'); assert.equal(body.message.length, 140);
  assert.equal(lookOf({ card: { icon: 'nope', bg: '#112233' } }).icon, 'star'); assert.equal(lookOf({ card: null }).bg, DEFAULT_LOOK.bg);
});

test('owners and admins design cards', () => { assert.equal(canDesign('OWNER'), true); assert.equal(canDesign('ADMIN'), true); assert.equal(canDesign('CASHIER'), false); });

test('every text of the card designer is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(DESIGN_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
