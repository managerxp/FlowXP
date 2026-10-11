/*
 * The field-sales offline drill, against a running FlowXP server and the demo distributor (npm run seed:distributor in backend). The app's own code, Node's
 * SQLite standing in for the phone, signed in as a FIELD REP:
 *   download the catalogue (with wholesale details) -> NETWORK OFF -> visit a shop, take an order from the phone's own prices, collect a payment ->
 *   NETWORK ON -> the queue sends visit, order, payment in that order -> each reached the server once, linked to the visit, marked "Taken offline",
 *   a total that differs from the server's price is written on the order -> sending again makes nothing new.
 * Then the owner cancels the order and reverses the receipt so the demo is left as it was.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale-field1@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:field
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as ACTIONS_SCHEMA, createActions } from '../src/lib/actions.ts';
import { addFLine, ensureVisit, estimateOrder, fieldOrderBody, fieldReceiptBody, sendOrQueue, setFQty, type FieldShop, type FieldToday } from '../src/lib/field.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const make = async (email: string) => {
  const session: Session = { token: null, businessId: null, branchId: null };
  const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
  const login = await api.post<{ token: string }>('/auth/login', { email, password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
  session.token = login.token;
  const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
  const b = me.businesses[0];
  session.businessId = b.business_id; session.branchId = b.outlets[0].branch_id;
  return { api, type: b.business_type };
};

const rep = await make(process.env.FLOWXP_EMAIL || 'wholesale-field1@flowxp.test');
const owner = await make('wholesale@flowxp.test');
ok(['WHOLESALE', 'DISTRIBUTOR'].includes(rep.type), `the field rep is signed in to a ${rep.type.toLowerCase()} business`);

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(ACTIONS_SCHEMA);
const catalog = createCatalog(db); const actions = createActions(db);
const kvData = new Map<string, string>();
const kv = { get: async (k: string) => kvData.get(k) ?? null, set: async (k: string, v: string) => { kvData.set(k, v); } };

say('online: the route and the catalogue');
const route = await rep.api.get<FieldToday>('/distributor/field/today');
say(`  today's route: ${route.beats.length} beats, ${route.summary.planned} shops, ${route.summary.visited} visited; month target ${route.summary.month_target ? `${route.summary.month_target.achievement_pct}%` : 'none'}`);
let shopId = route.beats[0]?.customers[0]?.customer_id;
let beatId: number | null = route.beats[0]?.beat_id ?? null;
if (!shopId) {   // no beat today: take a shop from any of the rep's beats
  const beats = await rep.api.get<{ beat_id: number }[]>('/distributor/beats');
  const full = await rep.api.get<{ customers: { customer_id: number }[] }>(`/distributor/beats/${beats[0].beat_id}`);
  shopId = full.customers[0].customer_id; beatId = beats[0].beat_id;
  say(`  (no beat today: using ${shopId} from beat ${beatId})`);
}
const shop = await rep.api.get<FieldShop>(`/distributor/field/customers/${shopId}`);
ok(shop.customer.customer_id === shopId, `the shop card: ${shop.customer.name} owes ${shop.credit.outstanding}, limit ${shop.credit.limit}, ${shop.open_invoices.length} unpaid bills`);
await catalog.sync(rep.api);
const prods = (await catalog.search('', 300)).filter((p) => p.wholesale && p.is_available);
ok(prods.length > 0, `${prods.length} products on the phone, each with its wholesale details`);
const product = prods.find((p) => p.wholesale!.units.length > 0) ?? prods[0];
say(`  ordering ${product.name}: wholesale price ${product.wholesale!.wholesale_price}, minimum ${product.wholesale!.moq}, units ${product.wholesale!.units.map((u) => `${u.unit_name} (${u.factor})`).join(', ') || 'none'}`);

say('NETWORK OFF: visit, order, payment');
offline = true;
const deps = { api: rep.api, actions, kv };
const visit = await ensureVisit(deps, { date: day, customerId: shopId, shopName: shop.customer.name, outcome: 'ORDER', beatId });
ok(!visit.sent, 'the visit is kept on the phone');
let lines = addFLine([], product);
lines = setFQty(lines, lines[0].key, String(Math.max(Number(lines[0].quantity), product.wholesale!.moq)));
const est = estimateOrder(lines);
const okey = newKey(); const rkey = newKey(); const okey2 = newKey();
const o1 = await sendOrQueue<{ order_id: number }>(deps, { id: okey, label: 'Order (e2e)', method: 'POST', path: '/wholesale/orders', body: fieldOrderBody(shopId, lines, visit.ref, est.totalPaise / 100, { notes: 'e2e field drill' }) });
const r1 = await sendOrQueue(deps, { id: rkey, label: 'Payment (e2e)', method: 'POST', path: '/wholesale/receipts', body: fieldReceiptBody(shopId, '100', 'CASH', '', visit.ref, 'e2e field drill') });
// a second order whose shown total is deliberately wrong, as if the price had changed since the phone last synced
const o2 = await sendOrQueue(deps, { id: okey2, label: 'Order 2 (e2e)', method: 'POST', path: '/wholesale/orders', body: fieldOrderBody(shopId, lines, visit.ref, 1, { notes: 'e2e field drill 2' }) });
ok([o1.kind, r1.kind, o2.kind].every((k) => k === 'queued') && (await actions.counts()).pending === 4, `visit, two orders and a payment kept on the phone (about ${est.totalPaise / 100} for the first order)`);
const sender = (api: typeof rep.api) => async (a: { path: string; method: string; body: Record<string, unknown>; id: string }) => { await api.call(a.path, { method: a.method, body: a.body, idempotencyKey: a.id, headers: /^\/wholesale/.test(a.path) ? { 'X-Offline-Sale': '1' } : undefined }); };
ok((await actions.flush(sender(rep.api))).stopped === 'offline', 'sending while offline stops and loses nothing');

say('NETWORK ON');
offline = false;
const flushed = await actions.flush(sender(rep.api));
ok(flushed.sent === 4 && flushed.failed === 0, 'visit, both orders and the payment sent, in that order');
const after = await rep.api.get<FieldShop>(`/distributor/field/customers/${shopId}`);
const todays = after.visits.filter((v) => String(v.visit_date).slice(0, 10) === day);
const linked = todays.find((v) => v.order_value > 0 && v.collection >= 100);
ok(linked, `today's visit has orders worth ${linked?.order_value} and ${linked?.collection} collected, linked to it`);
const orders = await owner.api.get<{ order_id: number; status: string; notes: string | null; total: number }[]>(`/wholesale/orders?customer_id=${shopId}&limit=10`);
const mine = orders.filter((o) => /e2e field drill/.test(o.notes ?? '') && o.status !== 'CANCELLED');
ok(mine.length === 2 && mine.every((o) => o.status === 'PENDING' && /Taken offline/.test(o.notes ?? '')), 'both orders arrived PENDING, for the office to confirm, marked "Taken offline"');
const flagged = mine.filter((o) => /Check: the phone showed/.test(o.notes ?? ''));
ok(flagged.length === 1 && /drill 2/.test(flagged[0].notes ?? ''), `only the order the server priced HIGHER than shown is flagged (not the one it priced lower): "${flagged[0]?.notes}"`);
const again = await actions.flush(sender(rep.api));
ok(again.sent === 0, 'sending again changes nothing');
const replay = await rep.api.post<{ order_id: number }>('/wholesale/orders', fieldOrderBody(shopId, lines, visit.ref, est.totalPaise / 100, { notes: 'e2e field drill' }), { idempotencyKey: okey, headers: { 'X-Offline-Sale': '1' } });
ok(mine.some((o) => o.order_id === replay.order_id), 'the same key again returns the same order');

say('Cleaning up (as the owner)');
for (const o of mine) await owner.api.post(`/wholesale/orders/${o.order_id}/cancel`, { reason: 'e2e field drill' }, { idempotencyKey: newKey() });
const receipts = await owner.api.get<{ receipt_id: number; notes: string | null; status: string }[]>(`/wholesale/receipts?customer_id=${shopId}&limit=10`);
for (const r of receipts.filter((x) => /e2e field drill/.test(x.notes ?? '') && x.status === 'POSTED')) await owner.api.post(`/wholesale/receipts/${r.receipt_id}/reverse`, { reason: 'e2e field drill' }, { idempotencyKey: newKey() });
ok(true, 'the two orders are cancelled and the receipt is reversed');
say('All good.');
