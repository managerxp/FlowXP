/*
 * Part payment and pay later at the counter, with the app's own code against a running FlowXP server and the demo café:
 *   online: part paid by UPI (the bill is Partly paid, with the right balance) -> pay later (Unpaid, nothing taken) -> the rest collected later (Paid)
 *   no signal: a part-paid sale kept on the phone, its pending receipt shows what is owed, then sent: the server has the same part payment
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:partpay
 *
 * It makes real bills in that business and cancels them at the end, so point it at a demo or test business only.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { addProduct, emptyCart } from '../src/lib/cart.ts';
import { payPlan } from '../src/lib/billing.ts';
import { sendEntry, takeSale } from '../src/lib/till.ts';
import { pendingReceiptText, type Invoice } from '../src/lib/receipt.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cafe@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; name: string; outlets: { branch_id: number }[] }[] };
const business = me.businesses[0];
session.businessId = business.business_id; session.branchId = business.outlets[0].branch_id;

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
const catalog = createCatalog(db); const outbox = createOutbox(db);
await catalog.sync(api);
const item = (await catalog.search('', 200)).find((p) => p.is_available && !p.modifier_group_ids.length && !p.track_inventory && p.selling_price >= 100)!;
ok(Boolean(item), `a product to sell: ${item?.name}`);
const customer = (await api.get<{ customer_id: number; name: string }[]>('/customers?limit=5'))[0];
ok(Boolean(customer), `a customer to owe it: ${customer?.name}`);
const made: number[] = [];
const cart = () => addProduct(emptyCart(), item, 2);
const get = (id: number) => api.get<Invoice & { payment_status: string }>(`/invoices/${id}`);

say('The screen refuses what makes no sense');
ok(!payPlan({ how: 'PART', totalPaise: 30000, now: '100', hasCustomer: false }).ok, 'a part payment with no customer is refused: nobody would owe the rest');
ok(!payPlan({ how: 'PART', totalPaise: 30000, now: '300', hasCustomer: true }).ok, 'paying the whole bill as a "part" is refused');

say('Online: part paid');
const k1 = newKey();
const part = await takeSale({ api, outbox, cart: cart(), method: 'UPI', reference: 'UTR-PART', key: k1, customerId: customer.customer_id, payNowPaise: 10000 });
ok(part.kind === 'billed', 'billed straight away');
if (part.kind !== 'billed') throw new Error('not billed');
made.push(part.invoiceId);
const a = await get(part.invoiceId);
ok(a.payment_status === 'PARTIAL' && a.amount_paid === 100 && Math.abs(a.balance_due - (a.total - 100)) < 0.01, `Partly paid: ₹100 taken, ₹${a.balance_due} owed of ₹${a.total}`);
ok(a.payments.length === 1 && a.payments[0].method === 'UPI', 'one UPI payment is on the bill');
const again = await takeSale({ api, outbox, cart: cart(), method: 'UPI', reference: 'UTR-PART', key: k1, customerId: customer.customer_id, payNowPaise: 10000 });
ok(again.kind === 'billed' && again.invoiceId === part.invoiceId, 'sending it again with the same key is the same bill, not a second part payment');

say('Online: pay later');
const later = await takeSale({ api, outbox, cart: cart(), method: 'CASH', key: newKey(), customerId: customer.customer_id, payNowPaise: 0 });
if (later.kind !== 'billed') throw new Error('not billed');
made.push(later.invoiceId);
const b = await get(later.invoiceId);
ok(b.payment_status === 'UNPAID' && b.amount_paid === 0 && b.payments.length === 0 && b.balance_due === b.total, `Unpaid: nothing taken, ₹${b.balance_due} owed`);

say('The rest collected later');
const rest = await api.post<{ balance_due: number }>(`/invoices/${part.invoiceId}/payments`, { amount: a.balance_due, method: 'CASH' }, { idempotencyKey: newKey() });
const c = await get(part.invoiceId);
ok(rest.balance_due === 0 && c.payment_status === 'PAID', 'paying the balance makes the bill Paid');
ok(c.payments.length === 2, 'both payments are on the bill');

say('NETWORK OFF: a part-paid sale');
offline = true;
const k3 = newKey();
const queued = await takeSale({ api, outbox, cart: cart(), method: 'CASH', key: k3, customerId: customer.customer_id, payNowPaise: 15000 });
ok(queued.kind === 'queued', 'kept on the phone');
if (queued.kind !== 'queued') throw new Error('not queued');
const text = pendingReceiptText(queued.entry, business.name);
say(text.split('\n').map((l) => `    | ${l}`).join('\n'));
ok(/CASH\s+₹150\.00/.test(text) && /BALANCE DUE/.test(text), 'the pending receipt shows ₹150 paid and a balance due');
offline = false;
const flushed = await outbox.flush(sendEntry(api));
ok(flushed.sent === 1 && flushed.failed === 0, 'sent when the signal is back');
const sent = (await outbox.list())[0];
made.push(sent.invoice_id!);
const d = await get(sent.invoice_id!);
ok(d.payment_status === 'PARTIAL' && d.amount_paid === 150, `the server has the same part payment: ₹${d.amount_paid} paid, ₹${d.balance_due} owed`);

say('A takeaway order billed in part, and on credit');
const billOrder = async (payment: Record<string, unknown> | undefined) => {
  const o = await api.post<{ order_id: number }>('/orders', { order_type: 'TAKEAWAY' }, { idempotencyKey: newKey() });
  await api.post(`/orders/${o.order_id}/items`, { items: [{ product_id: item.product_id, quantity: 1 }] }, { idempotencyKey: newKey() });
  await api.call(`/orders/${o.order_id}/customer`, { method: 'PATCH', body: { customer_id: customer.customer_id } });
  const inv = await api.post<{ invoice_id: number }>(`/orders/${o.order_id}/bill`, { ...(payment ? { payment } : {}), apply_promotions: true }, { idempotencyKey: newKey() });
  made.push(inv.invoice_id);
  return get(inv.invoice_id);
};
const e = await billOrder({ method: 'UPI', amount: 100 });
ok(e.payment_status === 'PARTIAL' && e.amount_paid === 100, `the order's bill takes ₹100 and leaves ₹${e.balance_due} owed`);
const f = await billOrder(undefined);
ok(f.payment_status === 'UNPAID' && f.amount_paid === 0, 'an order billed with no payment is left unpaid');

for (const id of made) await api.post(`/invoices/${id}/cancel`, { reason: 'drill' }).catch(() => {});
say('\nALL GOOD (the bills made are cancelled)');
