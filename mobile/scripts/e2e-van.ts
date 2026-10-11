/*
 * Van sales against a running FlowXP server and the demo distributor (npm run seed:distributor in backend), as a FIELD REP with a van: the van and its
 * stock, then NETWORK OFF -> two sales from the van (one within what it holds, one for more than it holds) -> NETWORK ON -> the queue sends the visit and
 * both sales in order -> each reached the server once, took stock off the van once, is marked "Taken offline", the oversell is flagged -> the same key
 * again returns the same bill -> the rep's van list shows the new stock.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale-field1@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:van
 *
 * It makes real demo sales (small ones). A van sale cannot be undone from the app: it is a real bill and real stock leaving the van.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as ACTIONS_SCHEMA, createActions } from '../src/lib/actions.ts';
import { addFLine, ensureVisit, estimateOrder, sendOrQueue, setFQty, unitFactor } from '../src/lib/field.ts';
import { leftOnVan, overVan, pendingOnVan, stockByProduct, vanSaleBody, type VanDetail, type Vehicle } from '../src/lib/van.ts';
import { dayOf } from '../src/lib/till.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const day = dayOf(Date.now());

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'wholesale-field1@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;

say('The van');
const vans = await api.get<Vehicle[]>('/distributor/vehicles');
ok(vans.length === 1, `the rep sees their own van only: ${vans[0]?.vehicle_no} (${vans[0]?.route})`);
const vehicleId = vans[0].vehicle_id;
const detail = await api.get<VanDetail>(`/distributor/vehicles/${vehicleId}`);
const stock = stockByProduct(detail.stock);
ok(stock.length > 0, `${stock.length} products on the van, e.g. ${stock[0].name}: ${stock[0].qty} ${stock[0].unit}; sold today ${detail.today.sales} sales`);

say('The phone\'s copy');
const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(ACTIONS_SCHEMA);
const catalog = createCatalog(db); const actions = createActions(db);
await catalog.sync(api);
const carried = [];
for (const p of stock) { const x = await catalog.byId(p.product_id); if (x?.wholesale) carried.push({ van: p, product: x }); }
ok(carried.length >= 2, `${carried.length} of them are on the phone with wholesale prices`);
const [a, b] = carried;
const kvData = new Map<string, string>();
const deps = { api, actions, kv: { get: async (k: string) => kvData.get(k) ?? null, set: async (k: string, v: string) => { kvData.set(k, v); } } };

const shops = await api.get<{ beats: { beat_id: number; customers: { customer_id: number; name: string }[] }[] }>('/distributor/field/today');
let shop = shops.beats[0]?.customers[0];
let beatId: number | null = shops.beats[0]?.beat_id ?? null;
if (!shop) { const bs = await api.get<{ beat_id: number }[]>('/distributor/beats'); const f = await api.get<{ customers: { customer_id: number; name: string }[] }>(`/distributor/beats/${bs[0].beat_id}`); shop = f.customers[0]; beatId = bs[0].beat_id; }

say('NETWORK OFF: two sales from the van');
offline = true;
const visit = await ensureVisit(deps, { date: day, customerId: shop.customer_id, shopName: shop.name, outcome: 'ORDER', beatId });
ok(!visit.sent, `a visit to ${shop.name} is kept on the phone`);
const sale = (product: typeof a.product, qty: number) => { const l = addFLine([], product); const lines = setFQty(l, l[0].key, String(qty)); return { lines, body: vanSaleBody({ customerId: shop.customer_id, lines, mode: 'FULL', paid: '', method: 'CASH', reference: '', expectedTotal: estimateOrder(lines).totalPaise / 100, visitRef: visit.ref }) }; };
const piece = Math.max(1, a.product.wholesale!.moq);
const s1 = sale(a.product, piece);
const k1 = newKey(); const k2 = newKey();
const r1 = await sendOrQueue(deps, { id: k1, label: 'Van sale 1', method: 'POST', path: `/distributor/vehicles/${vehicleId}/sell`, body: s1.body });
const over = Math.ceil(b.van.qty / unitFactor(b.product, null)) + 3;   // three more than the van holds
const s2 = sale(b.product, over);
const r2 = await sendOrQueue(deps, { id: k2, label: 'Van sale 2', method: 'POST', path: `/distributor/vehicles/${vehicleId}/sell`, body: s2.body });
ok(r1.kind === 'queued' && r2.kind === 'queued', `kept on the phone: ${piece} of ${a.product.name}, and ${over} of ${b.product.name} when the van holds ${b.van.qty}`);
const pending = pendingOnVan(await actions.list(), vehicleId, (id, unit) => unitFactor(carried.find((c) => c.product.product_id === id)!.product, unit));
ok(leftOnVan(b.van, pending) === 0 && overVan(s2.lines, new Map([[b.van.product_id, leftOnVan(b.van, new Map())]])).length === 1, 'the van screen would show it empty, and the sale screen warned about the oversell');
const sender = async (x: { path: string; method: string; body: Record<string, unknown>; id: string }) => { await api.call(x.path, { method: x.method, body: x.body, idempotencyKey: x.id, headers: /\/sell$/.test(x.path) ? { 'X-Offline-Sale': '1', 'X-Sale-Date': day } : undefined }); };
ok((await actions.flush(sender)).stopped === 'offline', 'sending while offline stops and loses nothing');

say('NETWORK ON');
offline = false;
const flushed = await actions.flush(sender);
ok(flushed.sent === 3 && flushed.failed === 0, 'the visit and both sales are sent, in that order');
const after = await api.get<VanDetail>(`/distributor/vehicles/${vehicleId}`);
const left = (id: number) => stockByProduct(after.stock).find((p) => p.product_id === id)?.qty ?? 0;
ok(Math.abs((a.van.qty - left(a.van.product_id)) - piece * unitFactor(a.product, null)) < 1e-6, `${a.product.name}: ${a.van.qty} -> ${left(a.van.product_id)}, taken off the van once`);
ok(left(b.van.product_id) === 0, `${b.product.name}: the van is now empty, never negative`);
ok(after.today.sales >= detail.today.sales + 2, `the van shows ${after.today.sales} sales today (was ${detail.today.sales})`);
const bills = await api.get<{ invoice_id: number; invoice_number: string; notes: string | null; created_at: string }[]>(`/invoices?from=${day}&to=${day}&search=${encodeURIComponent('Van sale')}`).catch(() => []);
say(`  ${bills.length} van bills found today by the rep`);
const replay = await api.post<{ invoice_id: number; review: string[] }>(`/distributor/vehicles/${vehicleId}/sell`, s2.body, { idempotencyKey: k2, headers: { 'X-Offline-Sale': '1', 'X-Sale-Date': day } });
ok(replay.invoice_id > 0 && (await api.get<VanDetail>(`/distributor/vehicles/${vehicleId}`)).today.sales === after.today.sales, 'the same key again returns the same bill and makes nothing new');
// the rep has no right to read bills (and needs none); the office reads it
const osession: Session = { token: null, businessId: session.businessId, branchId: session.branchId };
const oapi = createApi({ baseUrl: url, getSession: () => osession, onToken: (t) => { osession.token = t; } });
osession.token = (await oapi.post<{ token: string }>('/auth/login', { email: 'wholesale@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const inv = await oapi.get<{ notes?: string }>(`/invoices/${replay.invoice_id}`);
ok(/Taken offline/.test(inv.notes ?? '') && /more sold than the van held/.test(inv.notes ?? ''), `the oversell is written on the bill: "${inv.notes}"`);
say('All good.');
