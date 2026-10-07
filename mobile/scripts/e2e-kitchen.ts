/*
 * The kitchen display against a running FlowXP server and the demo café, with the app's own code:
 *   a table orders a latte (with options), a muffin and a toast -> the tickets appear under To make, by station, with a "cook now" row ->
 *   rush -> a dish is marked ready (it moves to Ready) -> undo puts it back -> a cancelled dish shows as "do not make" -> everything served.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:kitchen
 *
 * It makes one table order and cancels it at the end; no bill is made.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA } from '../src/lib/outbox.ts';
import { cookNow, itemsIn, sortTickets, statsOf, ticketTitle, type KitchenData } from '../src/lib/kitchen.ts';
import { initialChoice, picked } from '../src/lib/options.ts';
import { tableState, type TableRow } from '../src/lib/orders.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
const catalog = createCatalog(db); await catalog.sync(api);
const latte = (await catalog.search('latte')).find((p) => p.modifier_group_ids.length)!;
const muffin = (await catalog.search('muffin'))[0];
const sandwich = (await catalog.search('sandwich'))[0] ?? (await catalog.search('', 5, 'Sandwiches'))[0];
const options = picked(await catalog.groupsFor(latte), initialChoice(await catalog.groupsFor(latte)));

const tickets = () => api.get<KitchenData>('/kitchen/tickets');
const free = (await api.get<TableRow[]>('/tables')).find((t) => tableState(t) === 'free')!;
const before = await tickets();
ok(Array.isArray(before.stations) && before.stations.length >= 2, `stations: ${before.stations.map((s) => `${s.name}${s.making ? ` (${s.making})` : ''}`).join(', ')}`);

say(`Order at ${free.name}`);
const { order_id } = await api.post<{ order_id: number }>('/orders', { order_type: 'DINE_IN', table_id: free.table_id }, { idempotencyKey: newKey() });
const add = async (productId: number, quantity: number, modifier_ids?: number[]) => (await api.post<{ order_item_id: number }[]>(`/orders/${order_id}/items`, { items: [{ product_id: productId, quantity, ...(modifier_ids ? { modifier_ids } : {}) }] }, { idempotencyKey: newKey() }))[0].order_item_id;
const latteItem = await add(latte.product_id, 2, options.ids);
const muffinItem = await add(muffin.product_id, 1);
const third = sandwich ? await add(sandwich.product_id, 1) : null;
const kot = await api.post<{ kot_number: string }>(`/orders/${order_id}/kot`, {});

say('To make');
let data = await tickets();
let mine = data.tickets.find((t) => t.order_id === order_id)!;
ok(mine && mine.items.length === (third ? 3 : 2), `the ticket (${ticketTitle(mine)}, ${kot.kot_number}) is on the screen with ${mine.items.length} dishes`);
ok(mine.items.every((i) => i.status === 'PREPARING' && i.sent_at), 'all being made');
const lat = mine.items.find((i) => /latte/i.test(i.description))!;
ok(lat.quantity === 2 && lat.modifiers.length > 0, `the latte shows its quantity and options (${lat.modifiers.map((m) => m.name).join(' · ')})`);
let sorted = sortTickets(data, 'all');
ok(sorted.making.some((t) => t.order_id === order_id), 'it sorts into To make');
const rows = cookNow(sorted.making, Date.now());
ok(rows.some((r) => /latte/i.test(r.name) && r.qty >= 2), `"cook now" has the latte (${rows.slice(0, 3).map((r) => `${r.qty}× ${r.name}`).join(', ')})`);
const stat = statsOf(sorted, Date.now());
ok(stat.tickets >= 1 && stat.dishes >= 3, `the strip: ${stat.tickets} tickets, ${stat.dishes} dishes, oldest ${stat.oldest}m`);
const stationId = lat.station_id;
if (stationId !== null) ok(sortTickets(data, String(stationId)).making.some((t) => t.order_id === order_id && t.items.some((i) => i.order_item_id === latteItem)), `the latte shows at its own station (${data.stations.find((s) => s.station_id === stationId)?.name})`);

say('Rush and ready');
await api.call(`/kitchen/orders/${order_id}/rush`, { method: 'POST', body: {} });
data = await tickets();
ok(data.tickets.find((t) => t.order_id === order_id)!.priority === 'RUSH' && data.tickets[0].priority === 'RUSH', 'rushed: it is first in the list');
await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: [muffinItem], status: 'READY' } });
data = await tickets(); sorted = sortTickets(data, 'all');
ok(sorted.ready.some((t) => t.order_id === order_id && itemsIn(t, 'ready').some((i) => i.order_item_id === muffinItem)), 'the muffin moved to Ready');
ok(sorted.making.some((t) => t.order_id === order_id), 'the rest of the ticket is still being made');
await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: [muffinItem], status: 'PREPARING' } });
data = await tickets();
ok(data.tickets.find((t) => t.order_id === order_id)!.items.find((i) => i.order_item_id === muffinItem)!.status === 'PREPARING', 'undo put the muffin back in the kitchen');

say('Cancel a dish');
if (third) {
  await api.call(`/orders/${order_id}/items/${third}`, { method: 'PATCH', body: { status: 'CANCELLED' } });
  data = await tickets(); mine = data.tickets.find((t) => t.order_id === order_id)!;
  const cancelled = mine.items.find((i) => i.order_item_id === third)!;
  ok(cancelled.cancelled && itemsIn(sortTickets(data, 'all').making.find((t) => t.order_id === order_id)!, 'making').some((i) => i.order_item_id === third), 'the cancelled dish shows on its ticket as "do not make"');
  ok(!sortTickets(data, 'all', new Set([third])).making.find((t) => t.order_id === order_id)!.items.some((i) => i.order_item_id === third), '"Got it" hides it');
}

say('Serve');
await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: [latteItem, muffinItem], status: 'READY' } });
await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: [latteItem, muffinItem], status: 'SERVED' } });
data = await tickets(); sorted = sortTickets(data, 'all');
ok(sorted.served.some((t) => t.order_id === order_id) && !sorted.making.some((t) => t.order_id === order_id && t.items.some((i) => i.status === 'PREPARING')), 'served: it is in Served and nothing is left to make');
let none = ''; try { await api.call('/kitchen/advance', { method: 'POST', body: { item_ids: [999999999], status: 'READY' } }); } catch (e) { none = (e as Error).message; }
ok(/nothing to update/i.test(none), `an item that does not exist is refused: "${none}"`);

say('Cleaning up');
await api.call(`/orders/${order_id}/cancel`, { method: 'POST', body: {} });
ok(tableState((await api.get<TableRow[]>('/tables')).find((t) => t.table_id === free.table_id)!) === 'free', `${free.name} is free again`);
say('\nALL GOOD');
