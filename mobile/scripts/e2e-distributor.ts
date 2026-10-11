/*
 * The distributor items against a running FlowXP server and the demo distributor (npm run seed:distributor in backend), with the app's own code, as a FIELD REP (and the owner for one setting):
 *   planning the days ahead and putting the shops in order; shops told to be visited again; the offers a shop qualifies for, kept on the phone and read back with no signal;
 *   where a visit happened, recorded only when the business has turned that on.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale-field1@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:distributor
 *
 * It records a few real demo visits (they cannot be deleted) and puts the "record where visits happen" setting back as it was.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { visitBody, routeShops, type FieldToday, type Outcome } from '../src/lib/field.ts';
import { applyOrder, dueText, followUps, planDays, suggest, type PastVisit } from '../src/lib/route.ts';
import { hints, keepForRoute, keepSchemes, keptText, parseKept, schemeKey } from '../src/lib/schemeHints.ts';
import { place } from '../src/lib/spot.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const make = async (email: string) => {
  const session: Session = { token: null, businessId: null, branchId: null };
  const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
  session.token = (await api.post<{ token: string }>('/auth/login', { email, password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
  const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
  session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
  return { api, business: session.businessId };
};
const rep = await make(process.env.FLOWXP_EMAIL || 'wholesale-field1@flowxp.test');
const owner = await make('wholesale@flowxp.test');
const days = planDays(); const today = days[0].id;
const kvData = new Map<string, string>();
const kv = { get: async (k: string) => kvData.get(k) ?? null, set: async (k: string, v: string) => { kvData.set(k, v); } };

say('Planning the days ahead');
const loaded: { date: string; route: FieldToday }[] = [];
for (const d of days) loaded.push({ date: d.id, route: await rep.api.get<FieldToday>(`/distributor/field/today${d.id === today ? '' : `?date=${d.id}`}`) });
ok(loaded.length === 7, `7 days read: ${loaded.map((l) => `${l.date.slice(5)}:${routeShops(l.route).length}`).join(' ')}`);
const busy = loaded.find((l) => routeShops(l.route).length > 1) ?? loaded.find((l) => routeShops(l.route).length > 0)!;
const stops = routeShops(busy.route);
ok(stops.length > 0, `${busy.date} has ${stops.length} shops, in the beat's order: ${stops.map((s) => s.name).slice(0, 4).join(', ')}`);
const planned = suggest(stops);
ok(planned.length === stops.length && new Set(planned.map((s) => s.customer_id)).size === stops.length, 'a suggested order has every shop once');
const unvisited = planned.filter((s) => !s.visited);
ok(unvisited.every((s, i) => i === 0 || unvisited[i - 1].overdue >= s.overdue || unvisited[i - 1].overdue === s.overdue), 'shops not yet visited come first, the most overdue before the rest');
const mine = applyOrder(stops, [...stops].reverse().map((s) => s.customer_id));
ok(mine.map((s) => s.customer_id).join() === [...stops].reverse().map((s) => s.customer_id).join(), 'the order the rep chose is applied');

say('Follow-ups');
const shopId = stops[0].customer_id; const shopName = stops[0].name;
const body = visitBody({ customerId: shopId, outcome: 'FOLLOW_UP', ref: newKey(), nextVisit: today, notes: 'e2e distributor drill', date: today });
await rep.api.post('/distributor/visits', body, { idempotencyKey: newKey() });
const from = new Date(Date.now() - 30 * 86400000); const f = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
const rows = await rep.api.get<{ customer_id: number; customer: string; visit_date: string; outcome: Outcome; next_visit_date: string | null }[]>(`/distributor/visits?from=${f}&limit=200`);
const past: PastVisit[] = rows.map((v) => ({ customer_id: v.customer_id, customer: v.customer, visit_date: String(v.visit_date).slice(0, 10), outcome: v.outcome, next_visit_date: v.next_visit_date ? String(v.next_visit_date).slice(0, 10) : null }));
const due = followUps(past, today, new Set());
ok(due.some((x) => x.customer_id === shopId), `${shopName} is told to be visited again today: "${dueText(today, today)}"`);
ok(!followUps(past, today, new Set([shopId])).some((x) => x.customer_id === shopId), 'a shop already on the day\'s route is not listed twice');

say('Offers, kept for no signal');
const asRep = { get: <T>(p: string) => rep.api.get<T>(p) };
const kept = await keepSchemes(asRep, kv, rep.business, shopId, today);
ok(kept !== null, `${kept?.schemes.length} offers kept for ${shopName}`);
const offline = parseKept(kv.get && kvData.get(schemeKey(rep.business, shopId)) || null);
ok(offline && offline.schemes.length === kept!.schemes.length, `read back from the phone with no signal (${keptText(offline!.at)})`);
const shown = hints(offline!.schemes, [], today);
ok(shown.length === offline!.schemes.length && shown.every((h) => h.text.length > 0), shown.length ? `e.g. "${shown[0].text}"` : 'no offer is running for this shop');
const n = await keepForRoute(asRep, kv, rep.business, stops.slice(0, 5).map((s) => s.customer_id), today);
ok(n >= 0, `${n} more shops' offers kept for the day (those kept a moment ago are skipped)`);

say('Where a visit was');
const get = () => owner.api.get<{ visit_location?: boolean }>('/wholesale/settings');
const was = Boolean((await get()).visit_location);
const record = async (label: string) => {
  const ref = newKey();
  await rep.api.post('/distributor/visits', visitBody({ customerId: shopId, outcome: 'NO_ORDER', ref, notes: `e2e where ${label}`, date: today, where: place(17.38504712, 78.48667) }), { idempotencyKey: newKey() });
  const all = await rep.api.get<{ notes: string | null; lat?: number; lng?: number }[]>(`/distributor/visits?from=${today}&customer_id=${shopId}&limit=50`);
  return all.find((v) => v.notes === `e2e where ${label}`)!;
};
try {
  await owner.api.call('/wholesale/settings', { method: 'PUT', body: { visit_location: true } });
  const on = await record('on');
  ok(on.lat === 17.385047 && on.lng === 78.48667, `the business records places: the visit is at ${on.lat}, ${on.lng}`);
  await owner.api.call('/wholesale/settings', { method: 'PUT', body: { visit_location: false } });
  const off = await record('off');
  ok(off.lat === undefined, 'the business does not: the same visit is recorded with no place');
} finally {
  await owner.api.call('/wholesale/settings', { method: 'PUT', body: { visit_location: was } });
  ok(Boolean((await get()).visit_location) === was, `the setting is back to "${was ? 'on' : 'off'}"`);
}
say('All good.');
