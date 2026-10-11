/*
 * The salon service menu against a running FlowXP server and the demo salon (npm run seed:salon in backend), with the app's own code: add a service (the same key twice is one),
 * see it on the menu and on the till's catalogue, change only the price and time, a duplicate name refused in plain words, remove it, bring it back, remove it again.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=salon@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:salon-menu
 *
 * It makes a real demo service (named with the time) and leaves it removed.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { blank, changedBody, durationText, fromService, grouped, rowText, serviceBody, serviceProblem, type MenuService } from '../src/lib/salonMenu.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'salon@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(me.businesses[0].business_type === 'SALON', 'signed in to a salon');
const get = (id: number) => api.get<MenuService>(`/salon/services/${id}`);
const put = (id: number, body: unknown) => api.call<MenuService>(`/salon/services/${id}`, { method: 'PUT', body }).then((r) => r.data);
const refused = async (work: () => Promise<unknown>) => { try { await work(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };

const menu = await api.get<MenuService[]>('/salon/services?status=ACTIVE&limit=200');
ok(menu.length > 0 && grouped(menu).length > 0, `${menu.length} services on the menu, in ${grouped(menu).length} groups`);

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const d = { ...blank('18'), name: `Drill Spa ${stamp}`, price: '1200', minutes: '90', gender: 'WOMEN' };
ok(serviceProblem({ ...d, name: '' }) !== '' && serviceProblem({ ...d, minutes: '3' }) !== '' && serviceProblem(d) === '', 'the app checks the name, the price and the time');
const key = newKey();
const made = await api.post<MenuService>('/salon/services', serviceBody(d), { idempotencyKey: key });
const again = await api.post<MenuService>('/salon/services', serviceBody(d), { idempotencyKey: key });
ok(made.service_id && again.service_id === made.service_id, `${made.name} is added (${durationText(made.duration_min)}, ₹${made.price}, ${made.gender}); the same key twice does not make a second`);
const count = (await api.get<MenuService[]>('/salon/services?status=ACTIVE&limit=200')).filter((x) => x.name === made.name).length;
ok(count === 1, 'only one on the menu');
ok(rowText(made) === '1 h 30 min · Women', `it reads: ${rowText(made)}`);

const catalog = await api.get<{ services: { service_id: number }[] }>('/salon/pos/catalog');
ok(catalog.services.some((s) => s.service_id === made.service_id), 'it is on the till catalogue');

console.log('Edit only what changed');
const start = fromService(made);
ok(Object.keys(changedBody(start, start)).length === 0, 'no change sends nothing');
const edit = changedBody(start, { ...start, price: '1300', minutes: '75' });
ok(JSON.stringify(Object.keys(edit).sort()) === JSON.stringify(['duration_min', 'price']), `only the price and time go: ${JSON.stringify(edit)}`);
const after = await put(made.service_id, edit);
ok(after.price === 1300 && after.duration_min === 75 && after.gender === 'WOMEN' && after.tax_rate === 18, 'saved; who it is for and GST are untouched');

const clash = await refused(() => api.post('/salon/services', serviceBody({ ...d, name: made.name.toUpperCase() }), { idempotencyKey: newKey() }));
ok(/already have a service called/.test(clash), `a duplicate name is refused: "${clash}"`);

console.log('Remove and bring back');
await api.post(`/salon/services/${made.service_id}/archive`, {});
ok((await get(made.service_id)).status === 'ARCHIVED' && !(await api.get<MenuService[]>('/salon/services?status=ACTIVE&limit=200')).some((x) => x.service_id === made.service_id), 'removed from the menu');
ok(rowText(await get(made.service_id)).endsWith('removed'), 'it shows as removed');
await api.post(`/salon/services/${made.service_id}/restore`, {});
ok((await get(made.service_id)).status === 'ACTIVE', 'brought back');
await api.post(`/salon/services/${made.service_id}/archive`, {});
ok((await get(made.service_id)).status === 'ARCHIVED', 'removed again (left removed)');
console.log('All good.');
