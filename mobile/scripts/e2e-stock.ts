/*
 * The Stock screen's calls against a running FlowXP server and a demo business, with the app's own code: the list with out / low / in stock,
 * add stock, take stock away with a reason, the same key twice changes the stock once. It puts the count back where it was.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:stock
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { adjustBody, adjustProblem, counts, statusOf, urgent } from '../src/lib/inventory.ts';
import type { StockRow } from '../src/lib/types.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cafe@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const list = () => api.get<StockRow[]>('/inventory');

const rows = await list();
const n = counts(rows);
ok(rows.length > 0 && n.all === n.out + n.low + n.in, `${rows.length} items: ${n.out} out, ${n.low} low, ${n.in} in stock`);
ok(statusOf(urgent(rows)[0]) !== 'in' || n.out + n.low === 0, 'what needs buying comes first');

const r = rows.find((x) => x.current_stock >= 5)!;
ok(adjustProblem('add', '', '') !== '' && adjustProblem('adjust', '-1', '') !== '', 'the app asks for a quantity, and a reason to take stock away');
const key = newKey();
await api.post('/inventory/adjust', adjustBody(r.product_id, 'add', '5', ''), { idempotencyKey: key });
await api.post('/inventory/adjust', adjustBody(r.product_id, 'add', '5', ''), { idempotencyKey: key });
const up = (await list()).find((x) => x.product_id === r.product_id)!;
ok(up.current_stock === r.current_stock + 5, `${r.name}: add 5 twice with one key changed it once (${r.current_stock} -> ${up.current_stock})`);
await api.post('/inventory/adjust', adjustBody(r.product_id, 'adjust', '-5', 'Counted'), { idempotencyKey: newKey() });
ok((await list()).find((x) => x.product_id === r.product_id)!.current_stock === r.current_stock, 'taking 5 away with a reason puts it back');
console.log('All good.');
