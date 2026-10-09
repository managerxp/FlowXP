/*
 * Moving stock between warehouses against a running FlowXP server and the demo wholesaler, with the app's own code, as the owner:
 * keep one for later then send it, receive it with one item damaged and one short, send one and cancel it (goods come back), the same key twice is one transfer.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:transfers
 *
 * It moves real stock between two demo warehouses.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { addTLine, receiveBody, receiveProblem, setDamaged, setGood, setTQty, shortBy, startReceive, transferBody, transferProblem, type Transfer, type TransferDetail, type Warehouse } from '../src/lib/transfers.ts';
import type { WProduct } from '../src/lib/wholesale.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'wholesale@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const post = <T>(path: string, body: unknown, key = newKey()) => api.post<T>(path, body, { idempotencyKey: key });
const info = async (productId: number) => api.get<{ product: { batch_tracking?: boolean; expiry_tracking?: boolean }; warehouses: { branch_id: number; quantity: number; available: number }[] }>(`/wholesale/inventory/product/${productId}`);
const stockAt = async (branch: number, productId: number) => Number((await info(productId)).warehouses.find((x) => x.branch_id === branch)?.quantity ?? 0);

say('Two warehouses');
const houses = await api.get<Warehouse[]>('/wholesale/warehouses');
ok(houses.length >= 2, `${houses.map((h) => h.name).join(' and ')}`);
const [a, b] = [houses.find((h) => h.branch_id === session.branchId) ?? houses[0], houses.find((h) => h.branch_id !== (houses.find((x) => x.branch_id === session.branchId) ?? houses[0]).branch_id)!];

const found = await api.get<WProduct[]>('/wholesale/products/lookup?q=a');
const stocked = [];
for (const p of found) { if (!p.track_inventory) continue; const i = await info(p.product_id); if (!i.product.batch_tracking && !i.product.expiry_tracking && (i.warehouses.find((w) => w.branch_id === a.branch_id)?.available ?? 0) >= 40) stocked.push(p); if (stocked.length === 2) break; }
const [p1, p2] = stocked;
ok(p1 && p2, `moving ${p1?.name} and ${p2?.name} from ${a.name} to ${b.name}`);
const a1 = await stockAt(a.branch_id, p1.product_id); const b1 = await stockAt(b.branch_id, p1.product_id);
const a2 = await stockAt(a.branch_id, p2.product_id); const b2 = await stockAt(b.branch_id, p2.product_id);

say('Keep one for later, then send it');
let lines = setTQty(addTLine(addTLine([], p1), p2), p1.product_id, '10');
lines = setTQty(lines, p2.product_id, '5');
ok(transferProblem(a.branch_id, a.branch_id, lines) !== '' && transferProblem(a.branch_id, b.branch_id, []) !== '', 'the app stops the same warehouse twice, and an empty transfer');
const key = newKey();
const body = transferBody(a.branch_id, b.branch_id, lines, { vehicle: 'mh12 ab 1234', notes: 'e2e transfers drill' });
const t1 = await post<Transfer>('/wholesale/transfers', body, key);
const t1b = await post<Transfer>('/wholesale/transfers', body, key);
ok(t1.status === 'DRAFT' && t1.transfer_id === t1b.transfer_id, `${t1.transfer_number} is kept, not sent; the same key twice is one transfer`);
ok((await stockAt(a.branch_id, p1.product_id)) === a1, 'nothing has left the first warehouse yet');
await post(`/wholesale/transfers/${t1.transfer_id}/dispatch`, {});
ok((await stockAt(a.branch_id, p1.product_id)) === a1 - 10 && (await stockAt(b.branch_id, p1.product_id)) === b1, `sent: ${a.name} has ${a1 - 10}, and ${b.name} still ${b1} (on the way)`);

say('Receive with one damaged and one short');
const detail = await api.get<TransferDetail>(`/wholesale/transfers/${t1.transfer_id}`);
ok(detail.status === 'IN_TRANSIT' && detail.items.length === 2, 'it is on the way, with two items');
let r = startReceive(detail.items);
ok(receiveProblem(r) === '', 'it starts as everything arrived in good condition');
const first = detail.items.find((i) => i.product_id === p1.product_id)!; const second = detail.items.find((i) => i.product_id === p2.product_id)!;
r = setDamaged(setGood(r, first.item_id, '7'), first.item_id, '2');   // 10 sent: 7 good, 2 damaged, 1 short
r = setGood(r, second.item_id, '4');                                  // 5 sent: 4 good, 1 short
ok(shortBy(r.find((l) => l.item.item_id === first.item_id)!) === 1 && receiveProblem(setGood(r, first.item_id, '9')) !== '', 'the app works out the short one and stops more than was sent');
const done = await post<TransferDetail>(`/wholesale/transfers/${t1.transfer_id}/receive`, receiveBody(r));
ok(done.status === 'RECEIVED', 'received');
ok((await stockAt(b.branch_id, p1.product_id)) === b1 + 7, `only the good ones were added: ${b.name} ${b1} -> ${b1 + 7}`);
ok((await stockAt(b.branch_id, p2.product_id)) === b2 + 4, `and 4 of the other: ${b2} -> ${b2 + 4}`);
const got = done.items.find((i) => i.product_id === p1.product_id)!;
ok(got.received_base === 7 && got.damaged_base === 2, 'the transfer records 7 good and 2 damaged');
let refused = false; try { await post(`/wholesale/transfers/${t1.transfer_id}/receive`, receiveBody(r)); } catch { refused = true; }
ok(refused, 'it cannot be received twice');

say('Send one and cancel it');
const t2 = await post<TransferDetail>('/wholesale/transfers', transferBody(a.branch_id, b.branch_id, setTQty(addTLine([], p2), p2.product_id, '3'), { sendNow: true }));
ok(t2.status === 'IN_TRANSIT', `${t2.transfer_number} sent straight away`);
const mid = await stockAt(a.branch_id, p2.product_id);
const c = await post<TransferDetail>(`/wholesale/transfers/${t2.transfer_id}/cancel`, {});
ok(c.status === 'CANCELLED' && (await stockAt(a.branch_id, p2.product_id)) === mid + 3, 'cancelled on the way: the 3 are back in the first warehouse');
const open = await api.get<Transfer[]>('/wholesale/transfers?status=DRAFT,IN_TRANSIT&limit=100');
ok(!open.some((t) => [t1.transfer_id, t2.transfer_id].includes(t.transfer_id)), 'neither is left among the unfinished');
ok(a2 - 5 === (await stockAt(a.branch_id, p2.product_id)), `${a.name} lost 5 of ${p2.name} for good (4 arrived, 1 short)`);
say('All good.');
