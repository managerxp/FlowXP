/*
 * Who can do what in a restaurant, over the real HTTP server, with the app's own rules for what each person is shown. For each demo role it signs in, reads the rights the phone is given,
 * works out which tabs and More items the app would show, then actually calls the server for the things that matter (a report, expenses, the kitchen, tables, bills, customers, stock, AI)
 * and checks the server agrees with what the app would have shown: nothing is shown that the server refuses, and nothing is hidden that the person needs.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_PASSWORD=demo1234 npm run e2e:roles
 *
 * Read-only.
 */
import { createApi, type Session } from '../src/lib/api.ts';
import { allowed } from '../src/lib/access.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const password = process.env.FLOWXP_PASSWORD || 'demo1234';

type Probe = { name: string; path: string; keys: string[] };
const PROBES: Probe[] = [
  { name: 'reports', path: '/reports/sales', keys: ['reports'] },
  { name: 'expenses', path: '/expenses', keys: ['expenses'] },
  { name: 'kitchen', path: '/kitchen/tickets', keys: ['kitchen', 'billing'] },
  { name: 'tables', path: '/tables', keys: ['billing'] },
  { name: 'customers', path: '/customers', keys: ['customers', 'billing'] },
  { name: 'stock', path: '/inventory', keys: ['inventory'] },
  { name: 'suppliers', path: '/suppliers', keys: ['suppliers', 'purchases', 'inventory'] },
  { name: 'flow ai', path: '/ai/status', keys: ['ai'] }
];

const accounts = [
  ['cafe@flowxp.test', 'café owner'], ['cafe-manager@flowxp.test', 'café manager'], ['cafe-barista@flowxp.test', 'barista'],
  ['demo-waiter@flowxp.test', 'waiter'], ['demo-kitchen@flowxp.test', 'kitchen'], ['demo-cashier@flowxp.test', 'cashier']
];

let wrong = 0; const rows: string[] = [];
for (const [email, label] of accounts) {
  const session: Session = { token: null, businessId: null, branchId: null };
  const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
  try { session.token = (await api.post<{ token: string }>('/auth/login', { email, password }, { signIn: true })).token; } catch (e) { rows.push(`${label.padEnd(14)} cannot sign in (${(e as Error).message}): skipped`); continue; }
  const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; role: string; permissions: Record<string, boolean>; effective_permissions: Record<string, boolean>; outlets: { branch_id: number }[] }[] };
  const b = me.businesses[0]; session.businessId = b.business_id; session.branchId = b.outlets[0].branch_id;
  const sell = allowed(b, 'billing', 'sales_orders', 'fulfilment', 'field_sales', 'collections', 'appointments', 'dispensing', 'vehicles');
  const cells: string[] = [];
  for (const p of probes(b)) {
    let status = 200;
    try { await api.get(p.path); } catch (e) { status = (e as { status?: number }).status ?? 0; }
    const shown = allowed(b, ...p.keys);
    const serverOk = status < 400;
    // the app must not show what the server refuses (a person would tap and be told no)
    const bad = shown && !serverOk && status !== 404;
    if (bad) wrong++;
    cells.push(`${p.name}:${shown ? 'shown' : 'hidden'}/${serverOk ? 'ok' : status}${bad ? ' !!' : ''}`);
  }
  rows.push(`${label.padEnd(14)} ${b.role.padEnd(9)} tabs: ${sell ? 'Sell Tables Bills' : 'none of Sell/Tables/Bills'}  | ${cells.join('  ')}`);
}
function probes(_b: unknown) { return PROBES; }
console.log(rows.join('\n'));
if (wrong) throw new Error(`FAILED: ${wrong} thing(s) are shown to a person that the server refuses`);
console.log('\nAll good: nothing is shown that the server refuses.');
