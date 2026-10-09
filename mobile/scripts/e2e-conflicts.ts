/*
 * Two devices change the same price, against a running FlowXP server and the demo café, with the app's own code. Device A makes its change with no signal; device B changes the
 * price on the server meanwhile. When A is back online its change is NOT sent over B's: it waits and asks. "Keep mine" sends it; "keep the server's" drops it.
 * The price is put back where it was at the end.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:conflicts
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA, createActions } from '../src/lib/actions.ts';
import { conflictText, guard, split, withCheck } from '../src/lib/conflicts.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cafe@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const money = (n: number) => `₹${n}`;
const priceOf = async (id: number) => (await api.get<{ selling_price: number }>(`/products/${id}`)).selling_price;
const setPrice = (id: number, v: number) => api.call(`/products/${id}`, { method: 'PATCH', body: { selling_price: v } });

const db = nodeDb(); await db.exec(SCHEMA); const actions = createActions(db);
const send = async (a: Parameters<Parameters<typeof actions.flush>[0]>[0]) => { if ((await guard(api, a)) === 'skip') return; await api.call(a.path, { method: a.method, body: split(a.body).clean, idempotencyKey: a.id }); };

const product = (await api.get<{ product_id: number; name: string; selling_price: number; modifier_group_ids?: number[]; kind?: string }[]>('/products?limit=50')).find((p) => p.selling_price >= 50 && (p.kind ?? 'DISH') !== 'INGREDIENT')!;
const original = product.selling_price;
console.log(`${product.name} is ${money(original)}`);

try {
  console.log('Device A, offline, sets it to +1; device B sets it to +2 on the server');
  await actions.add({ id: newKey(), label: `Price of ${product.name} to ${original + 1}`, method: 'PATCH', path: `/products/${product.product_id}`, body: withCheck({ selling_price: original + 1 }, { kind: 'price', product_id: product.product_id, seen: original, mine: original + 1 }) });
  await setPrice(product.product_id, original + 2);
  ok(JSON.stringify(await actions.flush(send)) === JSON.stringify({ sent: 0, failed: 1, stopped: null }), 'A comes back online: its change is held, not sent');
  ok((await priceOf(product.product_id)) === original + 2, `B's price ${money(original + 2)} is still on the server`);
  const [c] = await actions.list();
  const q = conflictText(c.label, original + 1, split(c.body).server!, money);
  ok(c.state === 'conflict' && q.keepMine === `Keep my change (${money(original + 1)})` && q.keepServer === `Keep FlowXP's (${money(original + 2)})`, `asks: "${q.title}". ${q.body} [${q.keepMine}] [${q.keepServer}]`);
  ok((await actions.counts()).failed === 1, 'it shows as needing a decision');

  console.log('Keep mine');
  await actions.resolve(c.id, 'mine');
  ok(JSON.stringify(await actions.flush(send)) === JSON.stringify({ sent: 1, failed: 0, stopped: null }), 'sent');
  ok((await priceOf(product.product_id)) === original + 1, `the price is now A's ${money(original + 1)}`);

  console.log('Again: A offline +3 (seen +1), B sets +4; this time keep the server\'s');
  await actions.add({ id: newKey(), label: `Price of ${product.name} to ${original + 3}`, method: 'PATCH', path: `/products/${product.product_id}`, body: withCheck({ selling_price: original + 3 }, { kind: 'price', product_id: product.product_id, seen: original + 1, mine: original + 3 }) });
  await setPrice(product.product_id, original + 4);
  await actions.flush(send);
  const [c2] = await actions.list(); const open = (await actions.list()).find((x) => x.state === 'conflict')!;
  ok(open && c2, 'held again');
  await actions.resolve(open.id, 'server');
  ok(!(await actions.list()).some((x) => x.state === 'conflict') && (await priceOf(product.product_id)) === original + 4, `A's change is dropped; the server keeps ${money(original + 4)}`);

  console.log('Nobody else changed it: it just goes');
  await actions.add({ id: newKey(), label: 'plain', method: 'PATCH', path: `/products/${product.product_id}`, body: withCheck({ selling_price: original + 5 }, { kind: 'price', product_id: product.product_id, seen: original + 4, mine: original + 5 }) });
  ok(JSON.stringify(await actions.flush(send)) === JSON.stringify({ sent: 1, failed: 0, stopped: null }) && (await priceOf(product.product_id)) === original + 5, 'sent as normal');
} finally {
  await setPrice(product.product_id, original);
  console.log(`price put back to ${money(await priceOf(product.product_id))}`);
}
console.log('All good.');
