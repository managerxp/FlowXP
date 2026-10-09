/*
 * Membership plans and service packages against a running FlowXP server and the demo salon (npm run seed:salon in backend), with the app's own code: add a membership
 * (a discount, a free service, priority booking), change only its price, keep the extra benefits it already had, switch it off; add a package, see what the client saves,
 * change its services. The same key twice is one.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=salon@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:salon-plans
 *
 * It makes a real demo plan and package (named with the time) and leaves them switched off.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import {
  blankPackage, blankPlan, packageBody, packageChanged, packageFrom, packageLine, packageProblem, planBody, planChanged, planFrom, planLine, planProblem, savingText, valueOf,
  type Package, type Plan, type ServiceRef
} from '../src/lib/salonPlans.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'salon@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(me.businesses[0].business_type === 'SALON', 'signed in to a salon');
const money = (n: number) => `₹${n}`;
const put = <T>(path: string, body: unknown) => api.call<T>(path, { method: 'PUT', body }).then((r) => r.data);

const services = await api.get<ServiceRef[]>('/salon/services?status=ACTIVE&limit=200');
const [s1, s2] = services.filter((s) => s.price > 0);
ok(s1 && s2, `using ${s1.name} (${money(s1.price)}) and ${s2.name} (${money(s2.price)})`);
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');

console.log('A membership');
const d = { ...blankPlan('18'), name: `Drill Gold ${stamp}`, price: '5000', discount: '10', free: [{ service_id: s1.service_id, qty: '2' }], priority: true };
ok(planProblem({ ...blankPlan(), name: 'X', price: '1' }) !== '' && planProblem(d) === '', 'the app wants a name, a price and something to give');
const key = newKey();
const made = await api.post<Plan>('/salon/membership-plans', planBody(d), { idempotencyKey: key });
const again = await api.post<Plan>('/salon/membership-plans', planBody(d), { idempotencyKey: key });
const all = await api.get<Plan[]>('/salon/membership-plans');
ok(made.plan_id && again.plan_id === made.plan_id && all.filter((p) => p.name === d.name).length === 1, `${made.name} is added; asking twice with one key makes one`);
ok(planLine(made) === '1 year · 10% off · 1 free service · priority booking', `it reads: ${planLine(made)}`);

const start = planFrom(made);
ok(Object.keys(planChanged(start, start)).length === 0, 'no change sends nothing');
// the plan has extra benefits the app does not edit (points multiplier): put some on through the website's route, then edit through the app
await put(`/salon/membership-plans/${made.plan_id}`, { benefits: { ...made.benefits, points_multiplier: 2, perks: ['Free tea'] } });
const withExtras = (await api.get<Plan[]>('/salon/membership-plans')).find((p) => p.plan_id === made.plan_id)!;
const s2draft = planFrom(withExtras);
const edit = planChanged(s2draft, { ...s2draft, discount: '15' });
const after = await put<Plan>(`/salon/membership-plans/${made.plan_id}`, edit);
ok(after.benefits.discount_pct === 15 && after.benefits.points_multiplier === 2 && after.benefits.perks?.[0] === 'Free tea' && after.benefits.free_services?.length === 1, 'a change to the discount keeps the points multiplier, the perk and the free service');
const priced = await put<Plan>(`/salon/membership-plans/${made.plan_id}`, planChanged(planFrom(after), { ...planFrom(after), price: '5500' }));
ok(priced.price === 5500 && priced.benefits.discount_pct === 15, 'a price change sends only the price');
const off = await put<Plan>(`/salon/membership-plans/${made.plan_id}`, planChanged(planFrom(priced), { ...planFrom(priced), active: false }));
ok(off.is_active === false && planLine(off).endsWith('switched off'), 'switched off');

console.log('A package');
const k = { ...blankPackage('18'), name: `Drill Bundle ${stamp}`, price: '1000', days: '90', items: [{ service_id: s1.service_id, qty: '3' }, { service_id: s2.service_id, qty: '1' }] };
const value = valueOf(k.items, services);
ok(packageProblem({ ...k, items: [] }) !== '' && packageProblem(k) === '', 'the app wants at least one service');
ok(value === s1.price * 3 + s2.price, `worth ${money(value)} one by one: "${savingText(k.price, value, money)}"`);
const pk = await api.post<Package>('/salon/packages', packageBody(k), { idempotencyKey: newKey() });
ok(pk.package_id && pk.services_value === value, `${pk.name} is added; the server agrees it is worth ${money(pk.services_value)}`);
ok(packageLine(pk).startsWith('3 months · 4 visits'), `it reads: ${packageLine(pk)}`);
const pkStart = packageFrom(pk);
ok(Object.keys(packageChanged(pkStart, pkStart)).length === 0, 'no change sends nothing');
const pk2 = await put<Package>(`/salon/packages/${pk.package_id}`, packageChanged(pkStart, { ...pkStart, items: [{ service_id: s1.service_id, qty: '5' }, pkStart.items[1]] }));
ok(pk2.items.find((i) => i.service_id === s1.service_id)?.quantity === 5 && pk2.price === 1000, 'a change to the visits keeps the price');
const pk3 = await put<Package>(`/salon/packages/${pk.package_id}`, packageChanged(packageFrom(pk2), { ...packageFrom(pk2), active: false }));
ok(pk3.is_active === false, 'switched off');
console.log('All good.');
