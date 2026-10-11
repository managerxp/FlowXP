/*
 * Wholesale against a running FlowXP server and the demo wholesaler (npm run seed:wholesale in backend): the day's numbers, customers with what they
 * owe, a customer's account, an order priced for that customer (preview, create twice with one key, submit, confirm, cancel), and collecting a
 * payment (twice with one key = one receipt, oldest bills settled first, the customer's balance goes down).
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:wholesale
 *
 * It makes one real order (cancelled again) and one real receipt in the demo business.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { addLine, collectBody, collectProblem, creditText, isOpen, orderActions, orderBody, orderProblem, previewBody, shortLines, spread, type LedgerLine, type OpenInvoice, type WCustomer, type WOrder, type WPreview, type WProduct } from '../src/lib/wholesale.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'wholesale@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(['WHOLESALE', 'DISTRIBUTOR'].includes(me.businesses[0].business_type), `signed in to a ${me.businesses[0].business_type.toLowerCase()} business`);

say('The day');
const dash = await api.get<{ sales?: { today: { total: number } }; orders?: { pending: number }; money?: { receivable: number; overdue: number; top_debtors: { customer_id: number; name: string }[] } }>('/wholesale/dashboard');
ok(dash.money && typeof dash.money.receivable === 'number', `owed to us ${dash.money?.receivable}, overdue ${dash.money?.overdue}; ${dash.orders?.pending} orders waiting`);

say('Customers');
const owing = await api.get<WCustomer[]>('/wholesale/customers?has_balance=1&limit=20');
ok(owing.length > 0 && owing.every((c) => (c.outstanding ?? 0) > 0), `${owing.length} customers owe money, e.g. ${owing[0].name} owes ${owing[0].outstanding}`);
const cust = owing[0];
const detail = await api.get<WCustomer>(`/wholesale/customers/${cust.customer_id}`);
ok(detail.customer_id === cust.customer_id, `account of ${detail.name}: limit ${detail.credit_limit}, pays in ${detail.payment_terms_days} days`);
const open = await api.get<{ advance: number; invoices: OpenInvoice[] }>(`/wholesale/customers/${cust.customer_id}/open-invoices`);
ok(open.invoices.length > 0, `${open.invoices.length} unpaid bills, oldest ${open.invoices[0].invoice_number} due ${String(open.invoices[0].due_date).slice(0, 10)}`);
const ledger = await api.get<{ lines: LedgerLine[] }>(`/wholesale/customers/${cust.customer_id}/ledger`);
ok(ledger.lines.length > 0, `${ledger.lines.length} lines in the account statement`);

say('An order priced for the customer');
const found = await api.get<WProduct[]>('/wholesale/products/lookup?q=a');
const product = found.find((p) => (p.available ?? 0) > 5 && p.track_inventory) ?? found[0];
ok(found.length > 0 && product, `${found.length} products match; ordering ${product.name} (${product.available} free)`);
let lines = addLine([], product);
ok(orderProblem(cust.customer_id, lines) === '' && orderProblem(null, lines) !== '', 'the order passes the app\'s own checks, and needs a customer');
const prev = await api.post<WPreview>('/wholesale/orders/preview', previewBody(cust.customer_id, lines));
ok(prev.total > 0 && prev.lines.length >= 1, `preview: items ${prev.subtotal}, GST ${prev.tax}, total ${prev.total}; credit: "${creditText(prev.credit).text || 'fine'}"`);
const big = [{ ...lines[0], quantity: String((product.available ?? 0) + 500) }];
const bigPrev = await api.post<WPreview>('/wholesale/orders/preview', previewBody(cust.customer_id, big));
ok(shortLines(bigPrev).length === 1, `asking for more than is free shows it as short (${shortLines(bigPrev)[0]?.short})`);

const okey = newKey();
const body = orderBody(cust.customer_id, lines, { customerPo: 'E2E-PO-1', notes: 'e2e drill' });
const a = await api.post<WOrder>('/wholesale/orders', body, { idempotencyKey: okey });
const b = await api.post<WOrder>('/wholesale/orders', body, { idempotencyKey: okey });
ok(a.order_id === b.order_id && a.status === 'DRAFT', `created ${a.order_number}; the same key twice is one order`);
ok(orderActions(a).map((x) => x.id).join() === 'submit,confirm,cancel' && isOpen(a.status), 'a draft can be sent for approval, confirmed or cancelled');
const full = await api.get<WOrder>(`/wholesale/orders/${a.order_id}`);
ok(full.items!.length === 1 && full.customer_po === 'E2E-PO-1', 'read back with its product and the customer\'s PO');
await api.post(`/wholesale/orders/${a.order_id}/submit`, {}, { idempotencyKey: newKey() });
const submitted = await api.get<WOrder>(`/wholesale/orders/${a.order_id}`);
ok(['PENDING', 'CONFIRMED'].includes(submitted.status), `submitted: ${submitted.status}`);
await api.post(`/wholesale/orders/${a.order_id}/cancel`, { reason: 'e2e drill' }, { idempotencyKey: newKey() });
const cancelled = await api.get<WOrder>(`/wholesale/orders/${a.order_id}`);
ok(cancelled.status === 'CANCELLED' && orderActions(cancelled).length === 0, 'cancelled again: nothing left to do on it');

say('Collecting a payment');
const owed = Number(detail.outstanding ?? cust.outstanding ?? 0);
const pay = Math.min(1000, Math.floor(owed));
ok(collectProblem(cust.customer_id, String(pay), 'UPI', '') !== '' && collectProblem(cust.customer_id, String(pay), 'UPI', 'UTR123') === '', 'a UPI payment needs its reference');
const plan = spread(open.invoices, pay);
ok(plan.length >= 1 && plan[0].invoice.invoice_id === open.invoices[0].invoice_id, `it will settle ${plan.map((p) => `${p.invoice.invoice_number} (${p.pay})`).join(', ')}, oldest first`);
const rkey = newKey();
const rbody = collectBody(cust.customer_id, String(pay), 'UPI', 'UTR-E2E-1', { notes: 'e2e drill' });
const r1 = await api.post<{ receipt_id: number; receipt_number: string; allocated: number; advance: number }>('/wholesale/receipts', rbody, { idempotencyKey: rkey });
const r2 = await api.post<{ receipt_id: number }>('/wholesale/receipts', rbody, { idempotencyKey: rkey });
ok(r1.receipt_id === r2.receipt_id, `${r1.receipt_number}: the same key twice is one receipt`);
ok(Math.abs(r1.allocated - pay) < 0.01 && r1.advance === 0, `all ${pay} was put against bills`);
const after = await api.get<WCustomer>(`/wholesale/customers/${cust.customer_id}`);
ok(Math.abs(Number(detail.outstanding) - Number(after.outstanding) - pay) < 0.01, `the customer now owes ${after.outstanding} (was ${detail.outstanding})`);
const open2 = await api.get<{ invoices: OpenInvoice[] }>(`/wholesale/customers/${cust.customer_id}/open-invoices`);
const paid = open.invoices.reduce((s, i) => s + i.balance, 0) - open2.invoices.reduce((s, i) => s + i.balance, 0);
ok(Math.abs(paid - pay) < 0.01, 'the open bills went down by exactly that');
await api.post(`/wholesale/receipts/${r1.receipt_id}/reverse`, { reason: 'e2e drill' }, { idempotencyKey: newKey() });
const back = await api.get<WCustomer>(`/wholesale/customers/${cust.customer_id}`);
ok(Math.abs(Number(back.outstanding) - Number(detail.outstanding)) < 0.01, 'the receipt was reversed again: the balance is back as it was');
say('All good.');
