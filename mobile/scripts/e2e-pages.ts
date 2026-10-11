/*
 * Every page's server calls, with the app's own client and types, against a running FlowXP server and the demo café:
 * Home (dashboard), Sales (bills, summary, search), Customers (list, add, detail, bills), Products (add twice with one key, price, stock),
 * Stock (low), Reports (sales for each range). It creates one test customer and one test product and removes them again.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:pages
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { ranges } from '../src/lib/ranges.ts';
import type { Customer, Dashboard, InvoiceRow, InvoiceSummary, ProductFull, SalesReport, StockRow } from '../src/lib/types.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;

say('Home');
const dash = await api.get<Dashboard>('/dashboard');
ok(dash.metrics_available && dash.metrics && typeof dash.metrics.today_sales === 'number' && typeof dash.metrics.low_stock_count === 'number', `today ${dash.metrics?.today_sales}, ${dash.metrics?.today_invoice_count} bills, owed ${dash.metrics?.outstanding}, low stock ${dash.metrics?.low_stock_count}`);
ok(dash.sales && dash.sales.trend.length === 14 && dash.sales.top_products.length > 0 && dash.sales.recent_invoices.length > 0, 'a 14-day trend, best sellers and the latest bills');

say('Sales');
for (const r of ranges()) {
  const bills = await api.get<InvoiceRow[]>(`/invoices?from=${r.from}&to=${r.to}`);
  const sum = await api.get<InvoiceSummary>(`/invoices/summary?from=${r.from}&to=${r.to}`);
  ok(bills.every((b) => b.invoice_date >= r.from && b.invoice_date <= r.to) && sum.bills >= 0, `${r.label}: ${bills.length} listed, summary says ${sum.bills} bills / ${sum.billed}`);
}
const some = (await api.get<InvoiceRow[]>(`/invoices?from=${ranges()[3].from}&to=${ranges()[3].to}`))[0];
const found = await api.get<InvoiceRow[]>(`/invoices?from=${ranges()[3].from}&to=${ranges()[3].to}&search=${encodeURIComponent(some.invoice_number)}`);
ok(found.length === 1 && found[0].invoice_id === some.invoice_id, `search by bill number finds ${some.invoice_number}`);

say('Customers');
const stamp = String(Date.now()).slice(-6);
const ckey = newKey();
const made = await api.post<Customer>('/customers', { name: `Phone Test ${stamp}`, phone: `98765${stamp}`.slice(0, 10) }, { idempotencyKey: ckey });
const again = await api.post<Customer>('/customers', { name: `Phone Test ${stamp}`, phone: `98765${stamp}`.slice(0, 10) }, { idempotencyKey: ckey });
ok(made.customer_id === again.customer_id, `added ${made.name}; the same form sent twice is one customer`);
ok((await api.get<Customer[]>(`/customers?search=${stamp}`)).some((c) => c.customer_id === made.customer_id), 'found by search');
const detail = await api.get<Customer>(`/customers/${made.customer_id}`);
ok(detail.bills === 0 && detail.outstanding_balance === 0, 'detail: no bills yet');
ok(Array.isArray(await api.get(`/customers/${made.customer_id}/invoices`)), 'their bill list loads');

say('Products and stock');
const pkey = newKey();
const body = { name: `Phone Test Item ${stamp}`, selling_price: 49.5, tax_rate: 5, unit: 'pc', track_inventory: true, opening_stock: 8 };
const p1 = await api.post<{ product_id: number }>('/products', body, { idempotencyKey: pkey });
const p2 = await api.post<{ product_id: number }>('/products', body, { idempotencyKey: pkey });
ok(p1.product_id === p2.product_id, `added a product; the same form sent twice is one product (id ${p1.product_id})`);
let prod = await api.get<ProductFull>(`/products/${p1.product_id}`);
ok(prod.selling_price === 49.5 && prod.current_stock === 8 && prod.track_inventory, 'detail: price 49.50, 8 in stock');
await api.call(`/products/${p1.product_id}`, { method: 'PATCH', body: { selling_price: 55 } });
prod = await api.get<ProductFull>(`/products/${p1.product_id}`);
ok(prod.selling_price === 55, 'price changed to 55');
const akey = newKey();
const adj = { product_id: p1.product_id, quantity: -3, reason: 'counted' };
await api.call('/inventory/adjust', { method: 'POST', body: adj, idempotencyKey: akey });
await api.call('/inventory/adjust', { method: 'POST', body: adj, idempotencyKey: akey });
prod = await api.get<ProductFull>(`/products/${p1.product_id}`);
ok(prod.current_stock === 5, 'stock corrected by -3 once, even though it was sent twice (8 -> 5)');
await api.call(`/products/${p1.product_id}`, { method: 'PATCH', body: { min_stock: 6 } });
const low = await api.get<StockRow[]>('/inventory?low_stock=true');
ok(low.some((r) => r.product_id === p1.product_id && r.low_stock), 'it now shows under "running low" (5 left, reorder at 6)');
let refused = ''; try { await api.call('/inventory/adjust', { method: 'POST', body: { product_id: p1.product_id, quantity: 5 } }); } catch (e) { refused = (e as Error).message; }
ok(/why/i.test(refused), `a stock change without a reason is refused: "${refused}"`);

say('Reports');
for (const r of ranges()) {
  const rep = await api.get<SalesReport>(`/reports/sales?from=${r.from}&to=${r.to}`);
  const sumDays = rep.by_day.reduce((a, d) => a + d.total, 0);
  ok(Math.abs(sumDays - rep.total_sales) < 0.01, `${r.label}: ${rep.invoice_count} bills, sales ${rep.total_sales}; the days add up to it`);
}

say('Cleaning up');
await api.call(`/products/${p1.product_id}/archive`, { method: 'POST', body: {} });
await api.call(`/customers/${made.customer_id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } });
ok(!(await api.get<Customer[]>(`/customers?search=${stamp}`)).some((c) => c.customer_id === made.customer_id), 'test customer and product removed');
say('\nALL GOOD');
