/* The business logo on the phone: what may be sent, the file name, the address shown, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_TEXTS, logoFileName, logoProblem, logoSrc, logoUrlOf } from '../src/lib/logo.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only PNG, JPEG or WebP up to 2 MB', () => {
  assert.equal(logoProblem('image/png', 1000), ''); assert.equal(logoProblem('image/JPEG', 2 * 1024 * 1024), ''); assert.equal(logoProblem('image/webp', null), ''); assert.equal(logoProblem(undefined, undefined), '');
  assert.notEqual(logoProblem('image/gif', 10), ''); assert.notEqual(logoProblem('application/pdf', 10), ''); assert.notEqual(logoProblem('image/png', 2 * 1024 * 1024 + 1), '');
});
test('the file name, and the address the phone shows', () => {
  assert.equal(logoFileName('image/png'), 'logo.png'); assert.equal(logoFileName('image/webp'), 'logo.webp'); assert.equal(logoFileName(undefined), 'logo.jpg');
  assert.equal(logoSrc(null, 'https://api.flowxp.in'), null); assert.equal(logoSrc('https://cdn.x/logo.png', 'https://api.flowxp.in/'), 'https://cdn.x/logo.png'); assert.equal(logoSrc('/uploads/logos/1/a.png', 'https://api.flowxp.in/'), 'https://api.flowxp.in/uploads/logos/1/a.png');
  assert.equal(logoUrlOf({ logo_url: '/a.png' }), '/a.png'); assert.equal(logoUrlOf({}), null); assert.equal(logoUrlOf(undefined), null);
});
test('every text of the logo setting is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(LOGO_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
