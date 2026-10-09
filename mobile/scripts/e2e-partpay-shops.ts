/*
 * Part payment and pay later at the pharmacy and salon tills, with the app's own code against a running FlowXP server and the demo pharmacy or salon (the business is
 * found from the account you sign in with):
 *   pharmacy: part paid (Partly paid, right balance) -> pay later (Unpaid) -> a part-paid sale kept on the phone with no signal, its pending receipt, then sent
 *   salon:    part paid -> pay later -> a gift card sale cannot be part-paid (the server says so) -> the rest collected later
 *
 *   FLOWXP_EMAIL=pharmacy@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:partpay-shops
 *   FLOWXP_EMAIL=salon@flowxp.test    FLOWXP_PASSWORD=demo1234 npm run e2e:partpay-shops
 *
 * It makes real bills and cancels them at the end, so point it at a demo or test business only.
 */
import { ApiError, createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { payPlan } from '../src/lib/billing.ts';
import { addMedicine, previewOf, quoteBody as pQuoteBody, saleBody as pSaleBody, type Medicine, type PharmacyQuote } from '../src/lib/pharmacy.ts';
import { addGiftCard, addService, quoteBody as sQuoteBody, saleBody as sSaleBody, staffFor, type SalonCatalog } from '../src/lib/salon.ts';
import { sendEntry } from '../src/lib/till.ts';
import { pendingReceiptText, type Invoice } from '../src/lib/receipt.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const refused = async (work: Promise<unknown>) => { try { await work; return null; } catch (e) { return e instanceof ApiError ? e : new ApiError(String(e), -1); } };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; name: string; business_type: string; outlets: { branch_id: number }[] }[] };
const business = me.businesses[0];
session.businessId = business.business_id; session.branchId = business.outlets[0].branch_id;
const customer = (await api.get<{ customer_id: number; name: string }[]>('/customers?limit=5'))[0];
ok(Boolean(customer), `${business.name} (${business.business_type}); a customer to owe it: ${customer?.name}`);
const made: number[] = [];
const get = (id: number) => api.get<Invoice & { payment_status: string }>(`/invoices/${id}`);
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

if (business.business_type === 'PHARMACY') {
  const meds = (await api.get<Medicine[]>('/pharmacy/products/lookup?q=a')).filter((m) => !m.prescription_required && (m.available ?? 0) >= 6 && m.selling_price >= 20);
  const med = meds[0];
  ok(Boolean(med), `a medicine to sell: ${med?.name}`);
  const lines = addMedicine([], med, 2);
  const q = await api.post<PharmacyQuote>('/pharmacy/pos/quote', pQuoteBody(lines, customer.customer_id));
  const total = q.invoice.total;
  ok(!payPlan({ how: 'PART', totalPaise: Math.round(total * 100), now: '5', hasCustomer: false }).ok, 'the screen refuses a part payment with no customer');

  say('Part paid');
  const part = await api.post<PharmacyQuote>('/pharmacy/pos/invoices', pSaleBody(lines, customer.customer_id, 'UPI', 'UTR-1', '', { payNowPaise: 1000 }), { idempotencyKey: newKey() });
  made.push(part.invoice.invoice_id);
  const a = await get(part.invoice.invoice_id);
  ok(a.payment_status === 'PARTIAL' && near(a.amount_paid, 10) && near(a.balance_due, total - 10), `Partly paid: 10 taken, ${a.balance_due} owed of ${total}`);

  say('Pay later');
  const later = await api.post<PharmacyQuote>('/pharmacy/pos/invoices', pSaleBody(lines, customer.customer_id, 'CASH', '', '', { payNowPaise: 0 }), { idempotencyKey: newKey() });
  made.push(later.invoice.invoice_id);
  const b = await get(later.invoice.invoice_id);
  ok(b.payment_status === 'UNPAID' && b.amount_paid === 0 && b.payments.length === 0, `Unpaid: nothing taken, ${b.balance_due} owed`);

  say('Kept on the phone, then sent');
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); const outbox = createOutbox(db);
  const key = newKey();
  const body = pSaleBody(lines, customer.customer_id, 'CASH', '', '', { payNowPaise: 2000 });
  const entry = await outbox.add({ id: key, body, preview: previewOf(lines, 'CASH', 2000), path: '/pharmacy/pos/invoices' });
  ok(Boolean(entry), 'the part-paid sale is kept on the phone');
  const text = pendingReceiptText(entry!, business.name);
  ok(/CASH\s+.20\.00/.test(text) && /BALANCE DUE/.test(text), 'the pending receipt shows 20 paid and a balance due');
  const flushed = await outbox.flush(sendEntry(api));
  ok(flushed.sent === 1 && flushed.failed === 0, 'sent when the signal is back');
  const sent = (await outbox.list())[0]; made.push(sent.invoice_id!);
  const c = await get(sent.invoice_id!);
  ok(c.payment_status === 'PARTIAL' && near(c.amount_paid, 20), `the server has the same part payment: ${c.amount_paid} paid, ${c.balance_due} owed`);
} else if (business.business_type === 'SALON') {
  const cat = await api.get<SalonCatalog>('/salon/pos/catalog');
  const svc = cat.services.find((s) => s.price >= 200) ?? cat.services[0];
  const { qualified, others } = staffFor(cat, svc.service_id);
  const who = qualified[0] ?? others[0];
  const lines = addService([], svc, who);
  const q = await api.post<{ total: number }>('/salon/pos/quote', sQuoteBody(lines, customer.customer_id, null));
  ok(q.total > 0, `${svc.name} by ${who.name}: ${q.total}`);
  ok(!payPlan({ how: 'LATER', totalPaise: Math.round(q.total * 100), now: '', hasCustomer: false }).ok, 'the screen refuses pay-later with no client');

  say('Part paid');
  const part = await api.post<{ invoice: { invoice_id: number } }>('/salon/pos/invoices', sSaleBody(lines, customer.customer_id, null, q.total, 'UPI', 'UTR-2', {}, 10000), { idempotencyKey: newKey() });
  made.push(part.invoice.invoice_id);
  const a = await get(part.invoice.invoice_id);
  ok(a.payment_status === 'PARTIAL' && near(a.amount_paid, 100) && near(a.balance_due, q.total - 100), `Partly paid: 100 taken, ${a.balance_due} owed of ${q.total}`);

  say('Pay later');
  const later = await api.post<{ invoice: { invoice_id: number } }>('/salon/pos/invoices', sSaleBody(lines, customer.customer_id, null, q.total, 'CASH', '', {}, 0), { idempotencyKey: newKey() });
  made.push(later.invoice.invoice_id);
  const b = await get(later.invoice.invoice_id);
  ok(b.payment_status === 'UNPAID' && b.amount_paid === 0 && b.payments.length === 0, `Unpaid: nothing taken, ${b.balance_due} owed`);

  say('A gift card sale cannot be part-paid');
  const gl = addGiftCard([], 500);
  const gq = await api.post<{ total: number }>('/salon/pos/quote', sQuoteBody(gl, customer.customer_id, null));
  const e = await refused(api.post('/salon/pos/invoices', sSaleBody(gl, customer.customer_id, null, gq.total, 'CASH', '', {}, 10000), { idempotencyKey: newKey() }));
  ok(e !== null && /paid in full/i.test(e.message), `the server refuses: "${e?.message}" (the app does not offer part payment with a gift card)`);

  say('The rest collected later');
  const rest = await api.post<{ balance_due: number }>(`/invoices/${part.invoice.invoice_id}/payments`, { amount: a.balance_due, method: 'CASH' }, { idempotencyKey: newKey() });
  ok(rest.balance_due === 0 && (await get(part.invoice.invoice_id)).payment_status === 'PAID', 'paying the balance makes the bill Paid');
} else {
  throw new Error('Sign in as the demo pharmacy or the demo salon.');
}

for (const id of made) await api.post(`/invoices/${id}/cancel`, { reason: 'drill' }).catch(() => {});
say('\nALL GOOD (the bills made are cancelled)');
