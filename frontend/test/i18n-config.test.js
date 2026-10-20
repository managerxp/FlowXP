/* Which language is shown, and how it is remembered: precedence, account switching, offline start, unknown codes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CODES, LANGUAGES, detectDeviceLang, dirOf, intlTag, normaliseLang, readStored, resolveLanguage, writeStored } from '../src/i18n/config.js';

const mem = () => { const d = new Map(); return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => d.set(k, v), removeItem: (k) => d.delete(k) }; };
const me = { user_id: 7, language: null };

test('the seven languages, each written in itself', () => {
  assert.deepEqual(CODES, ['en', 'hi', 'ml', 'ta', 'bn', 'te', 'kn']);
  for (const l of LANGUAGES) assert.ok(l.name && l.english && l.dir === 'ltr', l.code);
  assert.equal(LANGUAGES.find((l) => l.code === 'en').status, 'source');
  assert.ok(LANGUAGES.filter((l) => l.code !== 'en').every((l) => ['machine', 'reviewed'].includes(l.status)), 'never presented as professionally reviewed until someone says so');
});

test('codes and device languages', () => {
  assert.equal(normaliseLang('hi-IN'), 'hi'); assert.equal(normaliseLang('ML'), 'ml'); assert.equal(normaliseLang('fr'), null); assert.equal(normaliseLang(''), null); assert.equal(normaliseLang(undefined), null);
  assert.equal(detectDeviceLang(['fr-FR', 'ta-IN', 'en']), 'ta', 'the first one we offer');
  assert.equal(detectDeviceLang(['fr', 'de']), null); assert.equal(detectDeviceLang([]), null);
  assert.equal(dirOf('hi'), 'ltr'); assert.equal(dirOf('zz'), 'ltr'); assert.equal(intlTag('en'), 'en-IN'); assert.equal(intlTag('ml'), 'ml-IN');
});

test('signed out: this device\'s choice, then the device language, then English', () => {
  assert.equal(resolveLanguage({ stored: { lang: 'ta', uid: null }, device: 'hi' }), 'ta');
  assert.equal(resolveLanguage({ device: 'bn' }), 'bn');
  assert.equal(resolveLanguage({}), 'en');
  assert.equal(resolveLanguage({ device: 'fr' }), 'en');
});

test('signed in: own choice > a choice made here before signing in > business default > device > English', () => {
  assert.equal(resolveLanguage({ user: { ...me, language: 'ml' }, business: { default_language: 'hi' }, stored: { lang: 'ta', uid: null }, device: 'bn' }), 'ml');
  assert.equal(resolveLanguage({ user: me, business: { default_language: 'hi' }, stored: { lang: 'ta', uid: null }, device: 'bn' }), 'ta', 'picked on the sign-in page');
  assert.equal(resolveLanguage({ user: me, business: { default_language: 'hi' }, device: 'bn' }), 'hi', 'the business default');
  assert.equal(resolveLanguage({ user: me, business: { default_language: null }, device: 'bn' }), 'bn', 'the device');
  assert.equal(resolveLanguage({ user: me, business: null, device: 'fr' }), 'en');
  assert.equal(resolveLanguage({ user: me, business: { default_language: 'xx' }, device: 'bn' }), 'bn', 'an unknown business default is ignored');
});

test('account switching: another person\'s remembered language is never used', () => {
  const stored = { lang: 'ta', uid: 99 };
  assert.equal(resolveLanguage({ user: me, business: { default_language: 'hi' }, stored, device: 'bn' }), 'hi');
  assert.equal(resolveLanguage({ user: { user_id: 99, language: null }, business: { default_language: 'hi' }, stored, device: 'bn' }), 'ta', 'their own');
  assert.equal(resolveLanguage({ user: { user_id: 8, language: 'ml' }, stored, device: 'bn' }), 'ml', 'the saved choice always wins');
});

test('what was merely shown (not chosen) does not outrank a later business default', () => {
  const shown = { lang: 'bn', uid: 7, derived: true };
  assert.equal(resolveLanguage({ user: me, business: { default_language: 'hi' }, stored: shown, device: 'bn' }), 'hi');
});

test('while the session is being checked, or offline, the device\'s last language is used so nothing flashes', () => {
  assert.equal(resolveLanguage({ checking: true, stored: { lang: 'ml', uid: 7 }, device: 'hi' }), 'ml');
  assert.equal(resolveLanguage({ checking: true, device: 'hi' }), 'hi');
  assert.equal(resolveLanguage({ checking: true }), 'en');
});

test('the remembered choice survives bad storage', () => {
  const s = mem();
  assert.equal(readStored(s), null);
  writeStored({ lang: 'ta', uid: 7, pending: true }, s);
  assert.deepEqual(readStored(s), { lang: 'ta', uid: 7, pending: true, derived: false });
  s.setItem('flowxp.lang', '{not json'); assert.equal(readStored(s), null);
  s.setItem('flowxp.lang', JSON.stringify({ lang: 'klingon' })); assert.equal(readStored(s), null);
  writeStored(null, s); assert.equal(s.getItem('flowxp.lang'), null);
  assert.doesNotThrow(() => writeStored({ lang: 'hi' }, { setItem() { throw new Error('private mode'); } }));
  assert.equal(readStored({ getItem() { throw new Error('blocked'); } }), null);
});
