/*
 * Table orders and held bills, with the app's own code, against a running FlowXP server and the demo café:
 *   open a table (twice with one key = one order) -> add a latte with options and a muffin (twice with one key = one line) -> change a quantity
 *   -> send to the kitchen -> the floor shows it cooking -> the kitchen marks one ready -> the floor shows ready -> serve -> attach a customer
 *   -> bill by cash twice with one key (one invoice) -> the table is free again.  Then: open and cancel an order; hold a bill, list it, resume it.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:orders
 *
 * It makes one real sale in that business, so point it at a demo or test business only.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA } from '../src/lib/outbox.ts';
import { SCHEMA as HELD_SCHEMA, createHeld, fromSnapshot, holdBill, toSnapshot, type HeldRow } from '../src/lib/held.ts';
import { addProduct, emptyCart, lineName } from '../src/lib/cart.ts';
import { initialChoice, picked, toggle } from '../src/lib/options.ts';
import { orderTotals, tableState, type Order, type TableRow } from '../src/lib/orders.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); await db.exec(HELD_SCHEMA);
const catalog = createCatalog(db); const held = createHeld(db);
await catalog.sync(api);
const latte = (await catalog.search('latte')).find((p) => p.modifier_group_ids.length)!;
const muffin = (await catalog.search('muffin'))[0];
const groups = await catalog.groupsFor(latte);
const floor = async () => api.get<TableRow[]>('/tables');
const stateOf = async (id: number) => tableState((await floor()).find((t) => t.table_id === id)!);

say('The floor');
const tables = await floor();
const free = tables.filter((t) => tableState(t) === 'free');
ok(tables.length > 0 && free.length >= 2, `${tables.length} tables, ${free.length} free (${tables.slice(0, 4).map((t) => `${t.name}:${tableState(t)}`).join(', ')}…)`);
const [tA, tB] = free;

say(`Open ${tA.name}`);
const key = newKey();
const o1 = await api.post<{ order_id: number }>('/orders', { order_type: 'DINE_IN', table_id: tA.table_id }, { idempotencyKey: key });
const o2 = await api.post<{ order_id: number }>('/orders', { order_type: 'DINE_IN', table_id: tA.table_id }, { idempotencyKey: key });
ok(o1.order_id === o2.order_id, 'a double tap on the table opens one order');
ok((await stateOf(tA.table_id)) === 'new', 'the table now shows "order open"');
const id = o1.order_id;

say('Add items');
let chosen = initialChoice(groups);
const size = groups.find((g) => /size/i.test(g.name))!; const milk = groups.find((g) => /milk/i.test(g.name))!;
chosen = toggle(size, chosen, size.modifiers.find((m) => /large/i.test(m.name))!.modifier_id);
chosen = toggle(milk, chosen, milk.modifiers.find((m) => /oat/i.test(m.name))!.modifier_id);
const opts = picked(groups, chosen);
const addKey = newKey();
const add1 = await api.post<{ order_item_id: number }[]>(`/orders/${id}/items`, { items: [{ product_id: latte.product_id, quantity: 1, modifier_ids: opts.ids }] }, { idempotencyKey: addKey });
const add2 = await api.post<{ order_item_id: number }[]>(`/orders/${id}/items`, { items: [{ product_id: latte.product_id, quantity: 1, modifier_ids: opts.ids }] }, { idempotencyKey: addKey });
ok(add1[0].order_item_id === add2[0].order_item_id, 'a double tap on an item adds one line');
await api.call(`/orders/${id}/items/${add1[0].order_item_id}`, { method: 'PATCH', body: { quantity: 2 } });
const muf = await api.post<{ order_item_id: number }[]>(`/orders/${id}/items`, { items: [{ product_id: muffin.product_id, quantity: 1 }] }, { idempotencyKey: newKey() });
let order = await api.get<Order>(`/orders/${id}`);
const t1 = orderTotals(order);
ok(order.items.length === 2 && t1.items === 3 && t1.notSent === 2, `2 lines, 3 items, both not sent; about ${t1.totalPaise / 100}`);
ok(order.items.find((i) => i.order_item_id === add1[0].order_item_id)!.modifiers.some((m) => /Oat/.test(m.name)), 'the latte carries its options');

say('Kitchen');
const kot = await api.post<{ kot_number: string }>(`/orders/${id}/kot`, {});
ok(/KOT/i.test(kot.kot_number), `sent to the kitchen as ${kot.kot_number}`);
ok((await stateOf(tA.table_id)) === 'cooking', 'the floor shows the table cooking');
let again = ''; try { await api.post(`/orders/${id}/kot`, {}); } catch (e) { again = (e as Error).message; }
ok(/nothing new/i.test(again), `sending again says so: "${again}"`);
await api.call(`/orders/${id}/items/${muf[0].order_item_id}`, { method: 'PATCH', body: { status: 'READY' } });
ok((await stateOf(tA.table_id)) === 'ready', 'the muffin is ready: the floor shows "ready to serve"');
await api.call(`/orders/${id}/items/${muf[0].order_item_id}`, { method: 'PATCH', body: { status: 'SERVED' } });
await api.call(`/orders/${id}/items/${add1[0].order_item_id}`, { method: 'PATCH', body: { status: 'SERVED' } });
ok((await stateOf(tA.table_id)) === 'served', 'everything served');

say('Customer and bill');
const customers = await api.get<{ customer_id: number; name: string }[]>('/customers?search=a');
await api.call(`/orders/${id}/customer`, { method: 'PATCH', body: { customer_id: customers[0].customer_id } });
order = await api.get<Order>(`/orders/${id}`);
ok(order.customer_id === customers[0].customer_id, `${customers[0].name} is on the order`);
const preview = orderTotals(order);
const billKey = newKey();
const body = { payment: { method: 'CASH', amount: 'FULL' }, apply_promotions: true };
const inv1 = await api.post<{ invoice_id: number; total: number }>(`/orders/${id}/bill`, body, { idempotencyKey: billKey });
const inv2 = await api.post<{ invoice_id: number; total: number }>(`/orders/${id}/bill`, body, { idempotencyKey: billKey });
ok(inv1.invoice_id === inv2.invoice_id, 'a double tap on Pay makes one invoice');
ok(Math.abs(Math.round(inv1.total * 100) - preview.totalPaise) <= 100, `the preview (${preview.totalPaise / 100}) is within a rupee of the server's total (${inv1.total})`);
ok((await stateOf(tA.table_id)) === 'free', `${tA.name} is free again`);
const invoice = await api.get<{ table_name: string | null; customer_name: string | null; items: { description: string }[] }>(`/invoices/${inv1.invoice_id}`);
ok(invoice.table_name === tA.name && invoice.customer_name === customers[0].name && invoice.items.length === 2, `the invoice knows the table (${invoice.table_name}) and the customer (${invoice.customer_name})`);

say('Cancel an order');
const c = await api.post<{ order_id: number }>('/orders', { order_type: 'DINE_IN', table_id: tB.table_id }, { idempotencyKey: newKey() });
await api.post(`/orders/${c.order_id}/items`, { items: [{ product_id: muffin.product_id, quantity: 2 }] }, { idempotencyKey: newKey() });
await api.call(`/orders/${c.order_id}/cancel`, { method: 'POST', body: {} });
ok((await stateOf(tB.table_id)) === 'free', `${tB.name} is free after the order was cancelled`);
const tk = await api.post<{ order_id: number; order_number: string }>('/orders', { order_type: 'TAKEAWAY' }, { idempotencyKey: newKey() });
ok(((await api.get<Order[]>('/orders?open_only=true')).some((o) => o.order_id === tk.order_id && !o.table_id)), `a takeaway order (${tk.order_number}) shows in the open list`);
await api.call(`/orders/${tk.order_id}/cancel`, { method: 'POST', body: {} });

say('Held bills');
const cart = addProduct(addProduct(emptyCart(), latte, 1, opts), muffin, 2);
const snap = toSnapshot(cart, { id: customers[0].customer_id, name: customers[0].name });
ok((await holdBill({ api, held, bill: snap, label: 'Phone test', estimate: 500 })) === 'server', 'held on the server');
const list = (await api.get<HeldRow[]>('/held-bills')).filter((h) => h.label === 'Phone test');
ok(list.length === 1 && list[0].item_count === 3, `listed: "${list[0].label}", ${list[0].item_count} items`);
const taken = (await api.call<HeldRow>(`/held-bills/${list[0].hold_id}`, { method: 'DELETE' })).data;
const resumed = await fromSnapshot(taken.bill, (pid) => catalog.byId(pid), (p) => catalog.groupsFor(p));
ok(resumed.skipped.length === 0 && resumed.cart.lines.map((l) => `${lineName(l)} x${l.quantity}`).join('|') === cart.lines.map((l) => `${lineName(l)} x${l.quantity}`).join('|'), 'resumed with its options and quantities');
ok(resumed.customer?.id === customers[0].customer_id, 'and its customer');
ok(!(await api.get<HeldRow[]>('/held-bills')).some((h) => h.label === 'Phone test'), 'it is off the list once resumed');
let gone = ''; try { await api.call(`/held-bills/${list[0].hold_id}`, { method: 'DELETE' }); } catch (e) { gone = (e as Error).message; }
ok(/resumed it/i.test(gone), 'a second till resuming the same bill is told it is gone');
offline = true;
ok((await holdBill({ api, held, bill: snap, label: 'No signal', estimate: 1 })) === 'phone' && (await held.count()) === 1, 'with no signal the bill is held on the phone');
offline = false;
say('\nALL GOOD');
