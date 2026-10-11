/*
 * A cloud kitchen with the app's own code, against a running FlowXP server and the demo cloud kitchen (npm run seed:cloudkitchen in backend/):
 *   no dining room (the server has tables off, so the app does not ask for them) -> open a takeaway order (twice with one key = one order)
 *   -> add dishes (twice with one key = one line; a quantity of 0 is refused) -> it shows in the open orders -> send to the kitchen
 *   -> the kitchen marks it ready -> bill by UPI twice with one key (one invoice) -> it leaves the open orders -> cancel a second order.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cloudkitchen@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:cloudkitchen
 *
 * It makes one real sale in that business, so point it at a demo or test business only.
 */
import { ApiError, createApi, newKey, type Session } from '../src/lib/api.ts';
import type { Order } from '../src/lib/orders.ts';
import type { KitchenData } from '../src/lib/kitchen.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const refused = async (work: Promise<unknown>) => { try { await work; return null; } catch (e) { return e instanceof ApiError ? e.status : -1; } };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cloudkitchen@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; name: string; outlets: { branch_id: number }[] }[] };
const business = me.businesses[0];
session.businessId = business.business_id; session.branchId = business.outlets[0].branch_id;
ok(business.business_type === 'CLOUD_KITCHEN', `${business.name} is a cloud kitchen`);

say('No dining room');
const tables = await refused(api.get('/tables'));
ok(tables === 402 || tables === 403 || tables === 404, `the server has no tables for it (${tables}), so the app never asks`);

say('A takeaway order');
const dishes = (await api.get<{ product_id: number; name: string; kind: string; selling_price: number }[]>('/products?limit=60')).filter((p) => p.kind === 'DISH');
ok(dishes.length >= 3, `${dishes.length} dishes on the menu`);
const k1 = newKey();
const o1 = await api.post<{ order_id: number }>('/orders', { order_type: 'TAKEAWAY' }, { idempotencyKey: k1 });
const o1b = await api.post<{ order_id: number }>('/orders', { order_type: 'TAKEAWAY' }, { idempotencyKey: k1 });
ok(o1.order_id === o1b.order_id, 'opening twice with one key is one order');
const kl = newKey();
await api.post(`/orders/${o1.order_id}/items`, { items: [{ product_id: dishes[0].product_id, quantity: 2 }] }, { idempotencyKey: kl });
await api.post(`/orders/${o1.order_id}/items`, { items: [{ product_id: dishes[0].product_id, quantity: 2 }] }, { idempotencyKey: kl });
await api.post(`/orders/${o1.order_id}/items`, { items: [{ product_id: dishes[1].product_id, quantity: 1 }] }, { idempotencyKey: newKey() });
const detail = await api.get<{ items: { quantity: number; status: string }[] }>(`/orders/${o1.order_id}`);
const lines = detail.items.filter((i) => i.status !== 'CANCELLED');
ok(lines.length === 2 && lines.reduce((n, i) => n + Number(i.quantity), 0) === 3, 'two dishes and three portions: the repeated add did not double');
ok((await refused(api.post(`/orders/${o1.order_id}/items`, { items: [{ product_id: dishes[2].product_id, quantity: 0 }] }, { idempotencyKey: newKey() }))) === 400, 'a quantity of 0 is refused');
const open = await api.get<Order[]>('/orders?open_only=true');
ok(open.some((o) => o.order_id === o1.order_id && !o.table_id), 'it shows in the open orders, with no table');

say('The kitchen');
await api.post(`/orders/${o1.order_id}/kot`, {});
const board = await api.get<KitchenData>('/kitchen/tickets');
const mine = board.tickets.find((x) => x.order_id === o1.order_id);
ok(Boolean(mine) && mine!.order_type === 'TAKEAWAY' && mine!.table_name === null && mine!.items.length === 2, 'the kitchen screen shows its ticket, takeaway, with no table');
const sent = mine!.items.map((x) => x.order_item_id);
ok(sent.length === 2, 'both dishes went to the kitchen');
const adv = await api.post<{ updated: number }>('/kitchen/advance', { item_ids: sent, status: 'READY' });
ok(adv.updated === 2, 'the kitchen marks them ready');

say('Billing');
const bk = newKey();
const pay = { payment: { method: 'UPI', amount: 'FULL' } };
const inv1 = await api.post<{ invoice_id: number; total: number }>(`/orders/${o1.order_id}/bill`, pay, { idempotencyKey: bk });
const inv2 = await api.post<{ invoice_id: number }>(`/orders/${o1.order_id}/bill`, pay, { idempotencyKey: bk });
ok(inv1.invoice_id === inv2.invoice_id && inv1.total > 0, `billing twice with one key is one bill (${inv1.invoice_id}, ₹${inv1.total})`);
ok((await refused(api.post(`/orders/${o1.order_id}/bill`, pay, { idempotencyKey: newKey() }))) !== null, 'billing it again with a new key is refused');
ok(!(await api.get<Order[]>('/orders?open_only=true')).some((o) => o.order_id === o1.order_id), 'it has left the open orders');

say('A second order, cancelled');
const o2 = await api.post<{ order_id: number }>('/orders', { order_type: 'TAKEAWAY' }, { idempotencyKey: newKey() });
await api.post(`/orders/${o2.order_id}/items`, { items: [{ product_id: dishes[2].product_id, quantity: 1 }] }, { idempotencyKey: newKey() });
await api.post(`/orders/${o2.order_id}/cancel`, { reason: 'Customer changed their mind' });
ok(!(await api.get<Order[]>('/orders?open_only=true')).some((o) => o.order_id === o2.order_id), 'a cancelled order leaves the open orders');

// put the demo back: the bill made above is cancelled
await api.post(`/invoices/${inv1.invoice_id}/cancel`, { reason: 'drill' }).catch(() => {});
say('\nALL GOOD (the bill made is cancelled)');
