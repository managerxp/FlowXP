/*
 * Customers and dues against a running FlowXP server and the demo café, with the app's own code: a new customer, a part-paid bill, the customer shows as owing,
 * the app takes the rest against that bill (the same key twice takes it once), the customer is clear again. It makes a real demo customer and bill.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:customers
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { arrange, headline, owes, paymentBody, paymentProblem, sub, totalDuePaise } from '../src/lib/customers.ts';
import type { Customer } from '../src/lib/types.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cafe@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const money = (n: number) => `₹${n}`;

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const c = await api.post<Customer>('/customers', { name: `Drill Customer ${stamp}`, phone: `90${Date.now().toString().slice(-8)}` }, { idempotencyKey: newKey() });
ok(c.customer_id && !owes(c) && headline(c, money) === null && sub(c) === `${c.phone} · New`, `${c.name} is added and shows as new`);

const product = (await api.get<{ product_id: number; selling_price: number; modifier_group_ids?: number[]; kind?: string }[]>('/products?limit=100')).find((p) => p.selling_price >= 50 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT')!;
const bill = await api.post<{ invoice_id: number; invoice_number: string; total: number }>('/invoices', {
  customer_id: c.customer_id, items: [{ product_id: product.product_id, quantity: 1 }], payments: [{ method: 'CASH', amount: 10 }]
}, { idempotencyKey: newKey() });
const after = await api.get<Customer>(`/customers/${c.customer_id}`);
const due = Math.round((bill.total - 10) * 100) / 100;
ok(owes(after) && Math.abs(after.outstanding_balance - due) < 0.01, `${bill.invoice_number}: part paid, the customer shows ${headline(after, money)!.text}`);
ok(arrange([after, c], 'owing')[0].customer_id === c.customer_id && totalDuePaise([after]) > 0, 'they appear under Customer dues');

const unpaid = (await api.get<{ invoice_id: number; balance_due: number; status: string }[]>(`/customers/${c.customer_id}/invoices`)).find((b) => b.invoice_id === bill.invoice_id)!;
ok(unpaid.balance_due > 0, `the bill shows ${money(unpaid.balance_due)} still due`);
ok(paymentProblem('', unpaid.balance_due) !== '' && paymentProblem(String(unpaid.balance_due + 1), unpaid.balance_due) !== '', 'the app stops an empty amount, and more than is owed');
const key = newKey();
const body = paymentBody(String(unpaid.balance_due), 'UPI', 'drill-ref');
await api.post(`/invoices/${bill.invoice_id}/payments`, body, { idempotencyKey: key });
await api.post(`/invoices/${bill.invoice_id}/payments`, body, { idempotencyKey: key });
const clear = await api.get<Customer>(`/customers/${c.customer_id}`);
ok(!owes(clear) && headline(clear, money)?.due === false, `the same key twice took it once: ${c.name} owes nothing and shows ${headline(clear, money)!.text}`);
console.log('All good.');
