/* The language choice on a running server, with the phone's own code: save it on the account, see it come back on the next sign-in (another phone), a business default,
   refusals, and that it touches nothing else. Uses the demo shops (npm run seed:cafe, seed:pharmacy in backend/).
   node --experimental-strip-types --no-warnings scripts/language-live.mts   (API on :5100; run from mobile/) */
import { createApi, ApiError, type Session } from '../src/lib/api.ts';
import { applyAccountLanguage, chooseLangFor, setLanguagePusher, setLanguageStore } from '../src/lib/langpref.ts';
import { getLang, setLangValue } from '../src/lib/i18n.ts';

type Me = { user: { user_id: number; language: string | null }; businesses: { business_id: number; default_language: string | null; currency: string }[] };
const mk = () => { const s: Session = { token: null, businessId: null, branchId: null }; return { s, api: createApi({ baseUrl: 'http://localhost:5100', getSession: () => s, onToken: (t) => { s.token = t; } }) }; };
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };
const refused = async (p: Promise<unknown>): Promise<ApiError | null> => { try { await p; return null; } catch (e) { return e instanceof ApiError ? e : null; } };
const signIn = async (email: string) => { const c = mk(); const l = await c.api.post<{ token: string }>('/auth/login', { email, password: 'demo1234' }, { signIn: true }); c.s.token = l.token; const me = await c.api.get<Me>('/auth/me'); c.s.businessId = me.businesses[0].business_id; return { ...c, me }; };

const phoneA = await signIn('cafe@flowxp.test');       // the owner, on phone A
const other = await signIn('pharmacy@flowxp.test');    // someone else entirely
const uid = phoneA.me.user.user_id;
const before = JSON.stringify({ cur: phoneA.me.businesses[0].currency, other: other.me.user.language });
ok('two people signed in', `owner ${uid}`);

// phone A: the person picks Tamil; the phone's own code sends it
const kv = new Map<string, string>(); setLanguageStore({ get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); } });
setLanguagePusher(async (lang) => { await phoneA.api.call('/auth/language', { method: 'PATCH', body: { language: lang } }); });
await chooseLangFor('ta', uid);
must(getLang() === 'ta', 'shown at once');
ok('Tamil chosen on phone A: shown at once and kept on the phone', kv.get('language'));
const meA = await phoneA.api.get<Me>('/auth/me');
must(meA.user.language === 'ta', 'saved on the account');
ok('the account now says Tamil');

// phone B, a different phone with nothing stored: the same person signs in and gets Tamil
const phoneB = await signIn('cafe@flowxp.test');
kv.clear(); setLangValue('en');
await applyAccountLanguage(phoneB.me.user, phoneB.me.businesses[0]);
must(getLang() === 'ta', 'phone B follows the account');
ok('phone B (nothing stored) opens in Tamil after signing in');

// someone else is not affected
const meO = await other.api.get<Me>('/auth/me');
must(meO.user.language === null, 'the other person has no choice');
ok('another person\'s language is untouched', 'still follows their business default / phone');

// refusals
const bad = await refused(phoneA.api.call('/auth/language', { method: 'PATCH', body: { language: 'klingon' } }));
must(bad && bad.status === 400, 'unknown language refused');
const anon = await refused(createApi({ baseUrl: 'http://localhost:5100', getSession: () => ({ token: null, businessId: null, branchId: null }) }).call('/auth/language', { method: 'PATCH', body: { language: 'hi' } }));
must(anon && anon.status === 401, 'needs a sign-in');
ok('an unknown language and a missing sign-in are both refused', `${bad?.status}, ${anon?.status}`);

// a business default; the person with their own choice keeps it, another with none follows the default
await phoneA.api.call('/businesses/current', { method: 'PATCH', body: { default_language: 'hi' } });
const meB = await phoneA.api.get<Me>('/auth/me');
must(meB.businesses[0].default_language === 'hi', 'default saved');
await applyAccountLanguage(meB.user, meB.businesses[0]);
must(getLang() === 'ta', 'their own choice still wins');
await phoneA.api.call('/auth/language', { method: 'PATCH', body: { language: null } });
const meC = await phoneA.api.get<Me>('/auth/me');
kv.clear(); await applyAccountLanguage(meC.user, meC.businesses[0]);
must(getLang() === 'hi', 'with no choice of their own they get the business default');
ok('business default: their own choice wins; cleared, they follow the default');

// language touches nothing else
await phoneA.api.call('/businesses/current', { method: 'PATCH', body: { default_language: '' } });
const after = await phoneA.api.get<Me>('/auth/me');
must(JSON.stringify({ cur: after.businesses[0].currency, other: meO.user.language }) === before, 'currency and others unchanged');
must(after.user.language === null && after.businesses[0].default_language === null, 'cleaned up');
ok('currency and everything else unchanged; the demo accounts are back as they were');
console.log('ALL STEPS PASSED');
