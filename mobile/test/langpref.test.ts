/* Languages on the phone: which one shows (same rules as the website), how the choice is kept and sent, and the new dictionaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';
import { DICTS, HI, LANGS, coverage, getLang, setLangValue, t } from '../src/lib/i18n.ts';
import { deviceLang, isChoice, normaliseLang, parseStored, resolveLang } from '../src/lib/langrules.ts';
import { applyAccountLanguage, chooseLangFor, loadLanguage, setLanguagePusher, setLanguageStore } from '../src/lib/langpref.ts';

const me = { user_id: 7, language: null as string | null };

test('the seven languages, each written in itself', () => {
  assert.deepEqual(LANGS.map((l) => l.id), ['en', 'hi', 'ml', 'ta', 'bn', 'te', 'kn']);
  assert.ok(LANGS.every((l) => l.label && l.english));
});

test('codes, phone language, and the saved format (old bare code still read)', () => {
  assert.equal(normaliseLang('hi-IN'), 'hi'); assert.equal(normaliseLang('ML'), 'ml'); assert.equal(normaliseLang('fr'), null); assert.equal(normaliseLang(''), null);
  assert.deepEqual(parseStored('ta'), { lang: 'ta', uid: null, pending: false, derived: false }, 'the old format');
  assert.deepEqual(parseStored('{"lang":"bn","uid":3,"pending":true}'), { lang: 'bn', uid: 3, pending: true, derived: false });
  assert.equal(parseStored('{oops'), null); assert.equal(parseStored('klingon'), null); assert.equal(parseStored(null), null);
  assert.ok([null, 'en', 'hi', 'ml', 'ta', 'bn', 'te', 'kn'].includes(deviceLang()), 'whatever this machine says, it is one we offer or nothing');
});

test('which language shows: own choice > chosen here before signing in > business default > phone > English; another person\'s is never used', () => {
  const st = (lang: 'ta', uid: number | null, derived = false) => ({ lang, uid, pending: false, derived });
  assert.equal(resolveLang({ stored: st('ta', null), device: 'hi' }), 'ta', 'signed out');
  assert.equal(resolveLang({ device: 'bn' }), 'bn'); assert.equal(resolveLang({}), 'en');
  assert.equal(resolveLang({ user: { ...me, language: 'ml' }, business: { default_language: 'hi' }, stored: st('ta', null), device: 'bn' }), 'ml');
  assert.equal(resolveLang({ user: me, business: { default_language: 'hi' }, stored: st('ta', null), device: 'bn' }), 'ta');
  assert.equal(resolveLang({ user: me, business: { default_language: 'hi' }, device: 'bn' }), 'hi');
  assert.equal(resolveLang({ user: me, business: { default_language: null }, device: 'bn' }), 'bn');
  assert.equal(resolveLang({ user: me, business: null, device: null }), 'en');
  assert.equal(resolveLang({ user: me, business: { default_language: 'hi' }, stored: st('ta', 99), device: 'bn' }), 'hi', 'somebody else\'s choice on this phone');
  assert.equal(resolveLang({ user: me, business: { default_language: 'hi' }, stored: st('ta', 7, true), device: 'bn' }), 'hi', 'what was merely shown is not a choice');
  assert.equal(resolveLang({ checking: true, stored: st('ta', 7), device: 'hi' }), 'ta', 'starting up or offline');
  assert.equal(isChoice(me, null), false); assert.equal(isChoice({ ...me, language: 'hi' }, null), true); assert.equal(isChoice(me, st('ta', null)), true);
});

const memoryStore = () => { const d = new Map<string, string>(); setLanguageStore({ get: async (k) => d.get(k) ?? null, set: async (k, v) => { d.set(k, v); } }); return d; };

test('choosing while signed out is remembered; the phone opens in it with no network', async () => {
  const d = memoryStore(); setLanguagePusher(async () => { throw new Error('should not be called signed out'); });
  await chooseLangFor('ta', null);
  assert.equal(getLang(), 'ta'); assert.deepEqual(JSON.parse(d.get('language')!), { lang: 'ta', uid: null, pending: false, derived: false });
  setLangValue('en'); await loadLanguage(); assert.equal(getLang(), 'ta');
});

test('choosing while signed in is saved on the account; offline it stays pending and is sent later; nothing else is sent', async () => {
  const d = memoryStore(); const sent: unknown[] = [];
  let online = false;
  setLanguagePusher(async (lang) => { if (!online) throw new Error('offline'); sent.push(lang); });
  await chooseLangFor('ml', 7);
  assert.equal(getLang(), 'ml', 'shown at once, even with no signal');
  assert.deepEqual(JSON.parse(d.get('language')!), { lang: 'ml', uid: 7, pending: true, derived: false });
  online = true;
  await applyAccountLanguage({ user_id: 7, language: 'hi' }, { default_language: 'ta' });   // the account still says hi: the pending choice wins and is sent
  assert.deepEqual(sent, ['ml']); assert.equal(getLang(), 'ml');
  assert.equal(JSON.parse(d.get('language')!).pending, false);
  await applyAccountLanguage({ user_id: 7, language: 'bn' }, null);   // later, another phone changed it: the account wins
  assert.equal(getLang(), 'bn');
});

test('signing in as someone else: their own language, never the previous person\'s', async () => {
  const d = memoryStore(); setLanguagePusher(async () => {});
  await chooseLangFor('ta', 7);
  await applyAccountLanguage({ user_id: 8, language: null }, { default_language: 'hi' });
  assert.equal(getLang(), 'hi', 'person 8 follows the business default');
  assert.equal(JSON.parse(d.get('language')!).derived, true, 'it was not their choice');
  await applyAccountLanguage({ user_id: 9, language: null }, null);
  assert.equal(getLang(), deviceLang() ?? 'en');
});

test('a language picked on the sign-in screen becomes the account\'s once they sign in', async () => {
  const d = memoryStore(); const sent: string[] = [];
  setLanguagePusher(async (l) => { sent.push(l); });
  await chooseLangFor('bn', null);
  await applyAccountLanguage({ user_id: 5, language: null }, { default_language: 'hi' });
  assert.equal(getLang(), 'bn'); await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent, ['bn']);
  assert.deepEqual(JSON.parse(d.get('language')!), { lang: 'bn', uid: 5, pending: false, derived: false });
});

test('the new dictionaries: only texts the app has (Hindi has them all), placeholders kept, no blanks, honest about coverage', () => {
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const [name, dict] of [['ml', ML], ['ta', TA], ['bn', BN], ['te', TE], ['kn', KN]] as const) {
    assert.ok(Object.keys(dict).length > 80, `${name} has a core set`);
    for (const [en, tr] of Object.entries(dict)) {
      assert.ok(en in HI, `${name}: "${en}" is not a text the app shows (not in the Hindi dictionary)`);
      assert.ok(tr.trim(), `${name}: "${en}" is blank`);
      assert.equal(ph(tr), ph(en), `${name}: "${en}" changed a {placeholder}`);
    }
    assert.ok(coverage(name) > 0 && coverage(name) < 0.9, `${name} covers ${(coverage(name) * 100).toFixed(0)}% of the app's texts so far`);
    assert.equal(DICTS[name], dict);
  }
  assert.equal(coverage('en'), 1); assert.equal(coverage('hi'), 1);
  setLangValue('ml'); assert.equal(t('Sign in'), 'സൈൻ ഇൻ'); assert.equal(t('A text nobody translated'), 'A text nobody translated');
  setLangValue('ta'); assert.equal(t('Take payment'), 'கட்டணம் பெறு');
  setLangValue('bn'); assert.equal(t('Hold bill'), 'বিল হোল্ড করুন');
  setLangValue('en');
});
