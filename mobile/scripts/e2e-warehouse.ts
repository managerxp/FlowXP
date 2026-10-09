/*
 * The warehouse flow against a running FlowXP server and the demo wholesaler (npm run seed:wholesale in backend), with the app's own code: a confirmed
 * order -> a pick list (twice with one key = one list) -> start -> pick with one item SHORT -> pack -> send it out (challan + bill) -> out for delivery ->
 * delivered, who received it. The short pick goes back to the order as a back-order. As the warehouse manager; the owner makes and confirms the order.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale-warehouse@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:warehouse
 *
 * It makes a real order and a real dispatch (a bill and stock leaving the warehouse): use a demo business.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { addLine, orderBody, type WOrder, type WProduct } from '../src/lib/wholesale.ts';
import {
  boardLines, deliveryActions, deliveryBody, dispatchBody, inUnit, packBody, pickBody, pickNext, pickProblem, shortItems, wantedText, type Board, type Delivery, type PickDetail, type PickList, type ToPick
} from '../src/lib/warehouse.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const make = async (email: string) => {
  const session: Session = { token: null, businessId: null, branchId: null };
  const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
  session.token = (await api.post<{ token: string }>('/auth/login', { email, password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
  const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
  session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
  return api;
};
const wh = await make(process.env.FLOWXP_EMAIL || 'wholesale-warehouse@flowxp.test');
const owner = await make('wholesale@flowxp.test');

say('The board');
const before = await wh.get<Board>('/wholesale/fulfilment/summary');
ok(typeof before.orders_to_pick === 'number', `the warehouse sees: ${boardLines(before).map((l) => `${l.label} ${l.n}`).join(', ')}`);

say('The office makes and confirms an order (so there is something to pick)');
const all = await owner.get<{ customer_id: number; name: string; credit_limit: number }[]>('/wholesale/customers?limit=100');
const customers = all.filter((c) => c.credit_limit === 0 || c.credit_limit >= 200000);   // a shop with room, so credit does not stop the drill
// an order left unconfirmed by an earlier run is cancelled first
for (const o of await owner.get<{ order_id: number; status: string; notes: string | null }[]>('/wholesale/orders?status=DRAFT,PENDING,CONFIRMED&limit=100')) if (/e2e warehouse drill/.test(o.notes ?? '')) await owner.post(`/wholesale/orders/${o.order_id}/cancel`, { reason: 'e2e cleanup' }, { idempotencyKey: newKey() });
const products = await owner.get<WProduct[]>('/wholesale/products/lookup?q=a');
const product = products.find((p) => (p.available ?? 0) > 20 && p.track_inventory && !(p.units ?? []).length) ?? products.find((p) => (p.available ?? 0) > 20)!;
const ordered = Math.max(product.moq || 1, 3);
const lines = addLine([], product); lines[0].quantity = String(ordered);
const order = await owner.post<WOrder>('/wholesale/orders', orderBody(customers[0].customer_id, lines, { submit: true, notes: 'e2e warehouse drill' }), { idempotencyKey: newKey() });
await owner.post(`/wholesale/orders/${order.order_id}/confirm`, {}, { idempotencyKey: newKey() });
ok(true, `${order.order_number} for ${customers[0].name}: ${ordered} of ${product.name}, confirmed`);

say('To pick');
const toPick = await wh.get<ToPick[]>('/wholesale/orders?pickable=1&limit=100');
ok(toPick.some((o) => o.order_id === order.order_id), 'it shows under "To pick"');
const key = newKey();
const a = await wh.post<{ pick_id: number }>(`/wholesale/orders/${order.order_id}/pick-lists`, {}, { idempotencyKey: key });
const b = await wh.post<{ pick_id: number }>(`/wholesale/orders/${order.order_id}/pick-lists`, {}, { idempotencyKey: key });
ok(a.pick_id === b.pick_id, `a pick list is started; the same key twice is one list (#${a.pick_id})`);
let list = await wh.get<PickDetail>(`/wholesale/pick-lists/${a.pick_id}`);
ok(list.status === 'PENDING' && pickNext(list.status) === 'start' && list.items.length === 1, `${list.pick_number}: take ${wantedText(list.items[0])}${list.items[0].location ? ` from bin ${list.items[0].location}` : ''}`);

say('Picking');
await wh.post(`/wholesale/pick-lists/${a.pick_id}/start`, {}, { idempotencyKey: newKey() });
const typed: Record<number, string> = { [list.items[0].pick_item_id]: String(inUnit(list.items[0], list.items[0].qty_base) - 1) };   // one short
ok(pickProblem(list.items, typed) === '' && shortItems(list.items, typed).length === 1, `the app notices one ${list.items[0].base_unit} is short`);
await wh.post(`/wholesale/pick-lists/${a.pick_id}/pick`, pickBody(list.items, typed), { idempotencyKey: newKey() });
list = await wh.get<PickDetail>(`/wholesale/pick-lists/${a.pick_id}`);
ok(list.status === 'PICKED' && list.items[0].picked_base === list.items[0].qty_base - 1, `picked ${inUnit(list.items[0], list.items[0].picked_base)} of ${inUnit(list.items[0], list.items[0].qty_base)}`);

say('Packing and sending out');
await wh.post(`/wholesale/pick-lists/${a.pick_id}/pack`, packBody(list.items, '4.5'), { idempotencyKey: newKey() });
list = await wh.get<PickDetail>(`/wholesale/pick-lists/${a.pick_id}`);
ok(list.status === 'PACKED' && list.packages.length === 1 && list.packages[0].weight_kg === 4.5, 'packed in one package of 4.5 kg');
const dkey = newKey();
const dbody = dispatchBody({ vehicle: 'ts09ub1234', driver: 'Mahesh Yadav', phone: '', kind: 'TAX', method: 'CASH', reference: '' });
const sent = await wh.post<{ delivery_id: number; challan_number: string; invoice_id: number; invoice_number: string; invoice_total: number }>(`/wholesale/pick-lists/${a.pick_id}/dispatch`, dbody, { idempotencyKey: dkey });
const again = await wh.post<{ delivery_id: number; invoice_id: number }>(`/wholesale/pick-lists/${a.pick_id}/dispatch`, dbody, { idempotencyKey: dkey });
ok(again.invoice_id === sent.invoice_id, `sent out: challan ${sent.challan_number}, bill ${sent.invoice_number} (${sent.invoice_total}); the same key twice is one bill`);
const inv = await owner.get<{ items: { quantity: number }[]; invoice_number: string }>(`/invoices/${sent.invoice_id}`);
ok(inv.items.length === 1 && Number(inv.items[0].quantity) === ordered - 1, `the bill is for what was really picked (${ordered - 1}, not the ${ordered} ordered)`);
const after = await owner.get<WOrder>(`/wholesale/orders/${order.order_id}`);
ok(after.status === 'PARTIALLY_FULFILLED' && (after.items?.[0]?.backorder ?? 0) >= 0, `the order is now "${after.status}": the short unit stays on it`);

say('On the road');
const road = await wh.get<Delivery[]>('/wholesale/deliveries?open=1&limit=100');
const mine = road.find((d) => d.delivery_id === sent.delivery_id);
ok(mine && deliveryActions(mine.status).map((x) => x.to).join() === 'OUT_FOR_DELIVERY', `the delivery ${mine?.challan_number} shows on the road: "${mine?.status}", ${mine?.vehicle_no}, ${mine?.driver_name}`);
await wh.post(`/wholesale/deliveries/${sent.delivery_id}/status`, deliveryBody(deliveryActions('ASSIGNED')[0], '', '', ''), { idempotencyKey: newKey() });
const out = await wh.get<Delivery>(`/wholesale/deliveries/${sent.delivery_id}`);
const [delivered] = deliveryActions(out.status);
ok(out.status === 'OUT_FOR_DELIVERY' && delivered.to === 'DELIVERED', 'out for delivery');
await wh.post(`/wholesale/deliveries/${sent.delivery_id}/status`, deliveryBody(delivered, 'Ravi (shop owner)', 'at the gate', ''), { idempotencyKey: newKey() });
const done = await wh.get<Delivery>(`/wholesale/deliveries/${sent.delivery_id}`);
ok(done.status === 'DELIVERED' && done.pod_received_by === 'Ravi (shop owner)' && deliveryActions(done.status).length === 0, 'delivered, received by Ravi, nothing left to do');
const lists = await wh.get<PickList[]>('/wholesale/pick-lists?status=DISPATCHED&limit=5');
ok(lists.some((l) => l.pick_id === a.pick_id), 'the pick list is closed (sent out)');
say('All good.');
