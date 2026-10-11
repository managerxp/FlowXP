/*
 * Offline price and stock changes against a running FlowXP server and the demo cafe: download (customers too) -> NETWORK OFF -> find a customer,
 * change a price and a stock count -> NETWORK ON -> both reach the server once -> the server shows them -> put them back.
 *   FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:changes
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as ACTIONS_SCHEMA, createActions } from '../src/lib/actions.ts';
import { nodeDb } from '../test/helpers.ts';

const session: Session = { token: null, businessId: null, branchId: null };
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const api = createApi({ baseUrl: process.env.FLOWXP_URL || 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
const ok = (c: unknown, m: string) => { if (!c) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(ACTIONS_SCHEMA);
const catalog = createCatalog(db); const actions = createActions(db);
await catalog.sync(api);
ok((await catalog.customerCount()) > 0, `${await catalog.customerCount()} customers kept on the phone`);
const tracked = (await catalog.search('', 200)).find((p) => p.track_inventory && (p.current_stock ?? 0) > 5) ?? (await catalog.search('', 1))[0];
const before = await api.get<{ selling_price: number; current_stock: number }>(`/products/${tracked.product_id}`);

offline = true;
const who = (await catalog.customers('a'))[0];
ok(who, `offline: found customer ${who.name} on the phone`);
const newPrice = before.selling_price + 1;
await catalog.setLocal(tracked.product_id, { selling_price: newPrice });
await actions.add({ id: newKey(), label: 'price', method: 'PATCH', path: `/products/${tracked.product_id}`, body: { selling_price: newPrice } });
const stockKey = newKey();
if (tracked.track_inventory) await actions.add({ id: stockKey, label: 'stock', method: 'POST', path: '/inventory/adjust', body: { product_id: tracked.product_id, quantity: 2, reason: 'phone drill' } });
ok((await catalog.byId(tracked.product_id))!.selling_price === newPrice, `offline: the till already shows ${tracked.name} at ${newPrice}`);
const send = async (a: { path: string; method: string; body: Record<string, unknown>; id: string }) => { await api.call(a.path, { method: a.method, body: a.body, idempotencyKey: a.id }); };
ok((await actions.flush(send)).stopped === 'offline', 'offline: sending stops and keeps both changes');

offline = false;
const r = await actions.flush(send);
ok(r.sent >= 1 && r.failed === 0, `online: ${r.sent} changes sent`);
if (tracked.track_inventory) await send({ id: stockKey, method: 'POST', path: '/inventory/adjust', body: { product_id: tracked.product_id, quantity: 2, reason: 'phone drill' } });   // a repeat of the same key
const after = await api.get<{ selling_price: number; current_stock: number }>(`/products/${tracked.product_id}`);
ok(after.selling_price === newPrice, 'the server has the new price');
if (tracked.track_inventory) ok(Math.abs(after.current_stock - (before.current_stock + 2)) < 0.001, `the stock moved by +2 once even though it was sent twice (${before.current_stock} -> ${after.current_stock})`);

await api.call(`/products/${tracked.product_id}`, { method: 'PATCH', body: { selling_price: before.selling_price } });
if (tracked.track_inventory) await api.call('/inventory/adjust', { method: 'POST', body: { product_id: tracked.product_id, quantity: -2, reason: 'phone drill undo' }, idempotencyKey: newKey() });
console.log('\nALL GOOD (values put back)');
