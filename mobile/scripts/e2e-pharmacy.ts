/*
 * The pharmacy till and stock against a running FlowXP server and the demo pharmacy (npm run seed:pharmacy in backend): medicine search, a quote,
 * a sale sent twice with one key (one bill, stock down once), batch choice, a prescription note, a delivery (GRN) with a batch and use-by date, and
 * holding back a batch (then it cannot be sold). It makes real demo sales and one delivery.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=pharmacy@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:pharmacy
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { addMedicine, grnBody, grnProblem, newGrnLine, pharmacyProblem, pickBatch, quoteBody, rxNote, saleBody, sellable, type Batch, type Medicine, type PharmacyQuote } from '../src/lib/pharmacy.ts';
import { receiptText, type Invoice } from '../src/lib/receipt.ts';
import type { Supplier } from '../src/lib/buying.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'pharmacy@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(me.businesses[0].business_type === 'PHARMACY', 'signed in to a pharmacy');

say('Find a medicine');
const all = await api.get<Medicine[]>('/pharmacy/products/lookup?q=a');
const tracked = all.find((m) => m.batch_tracking && m.expiry_tracking && (m.available ?? 0) >= 3 && !m.prescription_required);
const rx = all.find((m) => m.prescription_required && (m.available ?? 0) >= 1);
ok(all.length > 0 && tracked, `${all.length} matches; selling ${tracked?.name} (${tracked?.available} on the shelf)`);
say(`  prescription medicine to test: ${rx ? rx.name : 'none in the first results'}`);

say('Batches');
const batches = await api.get<Batch[]>(`/pharmacy/inventory/batches?product_id=${tracked!.product_id}&state=active`);
const usable = batches.filter((b) => sellable(b, day));
ok(usable.length > 0, `${usable.length} batches can be sold; earliest use-by ${usable[0].expiry_date?.slice(0, 10)} (batch ${usable[0].batch_no})`);

say('Quote and sale');
let lines = addMedicine([], tracked!, 2);
ok(pharmacyProblem(lines, false) === '', 'the bill passes the app\'s own checks');
const q = await api.post<PharmacyQuote>('/pharmacy/pos/quote', quoteBody(lines, null));
ok(q.invoice.total > 0 && q.lines[0].batches.length > 0, `quote: items ${q.invoice.subtotal}, GST ${q.invoice.tax}, total ${q.invoice.total}, from batch ${q.lines[0].batches[0].batch_id}`);
const before = (await api.get<Medicine[]>(`/pharmacy/products/lookup?q=${encodeURIComponent(tracked!.name)}`)).find((m) => m.product_id === tracked!.product_id)!.available!;
const key = newKey();
const body = saleBody(lines, null, 'CASH', '', '');
const a = await api.post<PharmacyQuote>('/pharmacy/pos/invoices', body, { idempotencyKey: key });
const b = await api.post<PharmacyQuote>('/pharmacy/pos/invoices', body, { idempotencyKey: key });
ok(a.invoice.invoice_id === b.invoice.invoice_id, `the same key twice is one bill (#${a.invoice.invoice_id})`);
const after = (await api.get<Medicine[]>(`/pharmacy/products/lookup?q=${encodeURIComponent(tracked!.name)}`)).find((m) => m.product_id === tracked!.product_id)!.available!;
ok(Math.abs(before - after - 2) < 1e-9, `stock went down by 2 once (${before} to ${after})`);
const inv = await api.get<Invoice>(`/invoices/${a.invoice.invoice_id}`);
ok(inv.balance_due === 0 && receiptText(inv, 'City Care').includes(tracked!.name), 'read back: paid in full, and the receipt names the medicine');

say('A chosen batch');
const second = usable[usable.length - 1];
lines = pickBatch(addMedicine([], tracked!, 1), addMedicine([], tracked!, 1)[0].key, second);
lines = addMedicine([], tracked!, 1).map((l) => ({ ...l, batch: second }));
const q2 = await api.post<PharmacyQuote>('/pharmacy/pos/quote', quoteBody(lines, null));
ok(q2.lines[0].batches[0].batch_id === second.batch_id, `sold from the batch chosen (${second.batch_no}), not the earliest`);

if (rx) {
  say('Prescription');
  const rl = addMedicine([], rx);
  ok(pharmacyProblem(rl, false) !== '' && pharmacyProblem(rl, true) === '', 'the app asks for the prescription check first');
  const sale = await api.post<PharmacyQuote>('/pharmacy/pos/invoices', saleBody(rl, null, 'CASH', '', rxNote(rl, 'Dr Rao', 'Meena'), { rxChecked: true }), { idempotencyKey: newKey() });
  ok(sale.invoice.invoice_id > 0, `sold ${rx.name} with the note "${rxNote(rl, 'Dr Rao', 'Meena')}"`);
}

say('Receive a delivery');
const suppliers = await api.get<Supplier[]>('/suppliers');
ok(suppliers.length > 0, `${suppliers.length} suppliers`);
const gl = [{ ...newGrnLine(tracked!), received: '12', damaged: '1', unit_cost: '20', batch_no: `E2E${String(Date.now()).slice(-6)}`, expiry: '12/2030' }];
ok(grnProblem(gl, suppliers[0].supplier_id, day) === '', 'the delivery passes the app\'s own checks');
const gkey = newKey();
const g1 = await api.post<{ grn_id: number; grn_number: string }>('/pharmacy/grn', grnBody(gl, suppliers[0].supplier_id, '', '', 'CASH'), { idempotencyKey: gkey });
const g2 = await api.post<{ grn_id: number }>('/pharmacy/grn', grnBody(gl, suppliers[0].supplier_id, '', '', 'CASH'), { idempotencyKey: gkey });
ok(g1.grn_id === g2.grn_id, `the same key twice is one delivery (${g1.grn_number})`);
const nb = await api.get<Batch[]>(`/pharmacy/inventory/batches?product_id=${tracked!.product_id}&state=active`);
const mine = nb.find((x) => x.batch_no === gl[0].batch_no);
ok(mine && mine.qty_on_hand === 11 && String(mine.expiry_date).startsWith('2030-12-31'), `the new batch ${mine?.batch_no} holds 11 (12 less 1 damaged), use by ${String(mine?.expiry_date).slice(0, 10)}`);

say('Hold a batch back');
await api.post(`/pharmacy/inventory/batches/${mine!.batch_id}/status`, { status: 'QUARANTINED' });
const held = await api.get<Batch[]>(`/pharmacy/inventory/batches?product_id=${tracked!.product_id}&state=quarantined`);
ok(held.some((x) => x.batch_id === mine!.batch_id), 'it shows under Held back');
let refused = '';
try { await api.post('/pharmacy/pos/quote', quoteBody(addMedicine([], tracked!, 1).map((l) => ({ ...l, batch: mine! })), null)); } catch (e) { refused = (e as Error).message; }
ok(refused !== '', `a held back batch cannot be sold: "${refused}"`);
await api.post(`/pharmacy/inventory/batches/${mine!.batch_id}/status`, { status: 'ACTIVE' });
ok(true, 'put back on sale again');

say('Expiry summary');
const ex = await api.get<{ expired: number; buckets: { days: number; batches: number }[] }>('/pharmacy/inventory/expiry');
ok(typeof ex.expired === 'number' && ex.buckets.length > 0, `${ex.expired} expired batches; ${ex.buckets.map((x) => `${x.batches} within ${x.days}d`).join(', ')}`);
say('All good.');
