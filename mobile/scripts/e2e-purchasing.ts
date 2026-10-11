/*
 * Buying against a running FlowXP server and the demo wholesaler (npm run seed:wholesale in backend), with the app's own code: a purchase order to a supplier
 * (twice with one key = one order) -> approved -> due in -> a PART delivery with damaged goods and a batch (twice with one key = one receipt, stock up by
 * what was accepted only) -> the rest, closing the order -> the supplier's bill is owed -> paid (twice with one key = one payment) -> a delivery with no order.
 * The purchase manager does the buying; the owner approves.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale-purchase@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:purchasing
 *
 * It makes a real order, deliveries and a payment (stock goes up, money is owed then paid): use a demo business.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { acceptedOf, addBLine, directLine, editR, grnBody, grnProblem, isOpenPO, linesFromPO, payBody, payProblem, poActions, poBody, poProblem, setBQty, stillDue, type BuyProduct, type DueIn, type PO, type Supplier } from '../src/lib/purchasing.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const make = async (email: string) => {
  const session: Session = { token: null, businessId: null, branchId: null };
  const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
  session.token = (await api.post<{ token: string }>('/auth/login', { email, password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
  const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
  session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
  return api;
};
const buyer = await make(process.env.FLOWXP_EMAIL || 'wholesale-purchase@flowxp.test');
const owner = await make('wholesale@flowxp.test');
const stockOf = async (id: number, name: string) => ((await owner.get<{ product_id: number; on_hand?: number }[]>(`/wholesale/products/lookup?q=${encodeURIComponent(name)}`)).find((p) => p.product_id === id)?.on_hand ?? 0);

say('Supplier and products');
const suppliers = await buyer.get<Supplier[]>('/wholesale/suppliers?limit=20');
ok(suppliers.length > 0, `${suppliers.length} suppliers, ordering from ${suppliers[0].name}`);
const found = await buyer.get<BuyProduct[]>('/wholesale/products/lookup?q=a');
const plain = found.find((p) => !p.batch_tracking && !p.expiry_tracking && !p.serial_tracking)!;
ok(plain, `ordering ${plain.name} (last price ${plain.purchase_price}${(plain.units ?? []).length ? `, units ${plain.units!.map((u) => u.unit_name).join('/')}` : ''})`);

say('A purchase order');
let lines = addBLine([], plain); lines = setBQty(lines, lines[0].key, '10');
ok(poProblem(null, lines) !== '' && poProblem(suppliers[0].supplier_id, lines) === '', 'the order passes the app\'s own checks, and needs a supplier');
const key = newKey();
const body = poBody(suppliers[0].supplier_id, lines, { notes: 'e2e purchasing drill' });
const a = await buyer.post<PO>('/wholesale/purchase-orders', body, { idempotencyKey: key });
const b = await buyer.post<PO>('/wholesale/purchase-orders', body, { idempotencyKey: key });
ok(a.po_id === b.po_id && a.status === 'DRAFT', `${a.po_number} saved as a draft; the same key twice is one order`);
ok(poActions(a.status).map((x) => x.id).join() === 'approve,cancel', 'a draft can be approved or cancelled');
await owner.post(`/wholesale/purchase-orders/${a.po_id}/approve`, {}, { idempotencyKey: newKey() });
let po = await buyer.get<PO>(`/wholesale/purchase-orders/${a.po_id}`);
ok(po.status === 'ORDERED' && isOpenPO(po.status) && poActions(po.status).some((x) => x.id === 'receive'), `approved: ${po.status}`);
const due = await buyer.get<DueIn[]>('/wholesale/purchase-orders/due-in');
ok(due.some((d) => d.po_id === a.po_id && d.units === 10), 'it shows under "Due in": 10 units still due');
const message = await buyer.post<{ message: string }>(`/wholesale/purchase-orders/${a.po_id}/send`, { email: false }, { idempotencyKey: newKey() });
ok(message.message.includes(po.po_number) && message.message.includes(plain.name), 'the message for the supplier names the order and the product');

say('A part delivery (2 damaged)');
const before = await stockOf(plain.product_id, plain.name);
let r = linesFromPO(po);
ok(r.length === 1 && r[0].received === '10', 'the delivery starts as everything still due');
r = editR(r, r[0].key, { received: '6', damaged: '2' });
ok(acceptedOf(r[0]) === 4 && stillDue(r[0]) === 6 && grnProblem(r, day, false, null, true) === '', '6 arrive, 2 damaged: 4 go into stock, 6 would still be due');
const gkey = newKey();
const gbody = grnBody({ poId: a.po_id, supplierId: null, lines: r, invoiceNo: `E2E-${Date.now().toString().slice(-6)}`, invoiceDate: '', allowExcess: false, closePO: false, paid: '', method: 'CASH', reference: '' });
const g1 = await buyer.post<{ grn_id: number; grn_number: string; order_status: string }>('/wholesale/grns', gbody, { idempotencyKey: gkey });
const g2 = await buyer.post<{ grn_id: number }>('/wholesale/grns', gbody, { idempotencyKey: gkey });
ok(g1.grn_id === g2.grn_id && g1.order_status === 'PARTIAL', `${g1.grn_number}: the same key twice is one receipt; the order is part delivered`);
ok((await stockOf(plain.product_id, plain.name)) - before === 4, 'stock went up by 4 once (the 2 damaged ones are not stock)');
po = await buyer.get<PO>(`/wholesale/purchase-orders/${a.po_id}`);
ok(po.status === 'PARTIAL' && po.items![0].received === 4 && po.items![0].outstanding === 6 && poActions(po.status).map((x) => x.id).join() === 'receive,close,send', 'the order shows 4 arrived, 6 still due, and can be received again or closed');
ok(po.balance > 0 && po.grns!.length === 1, `you owe ${po.balance} for what was accepted`);

say('The rest, closing the order');
r = linesFromPO(po);
ok(r[0].received === '6', 'the next delivery starts at the 6 still due');
const over = editR(r, r[0].key, { received: '9' });
ok(/only 6 .* is still due/.test(grnProblem(over, day, false, null, true)), 'more than is due is caught before it is sent');
await buyer.post('/wholesale/grns', grnBody({ poId: a.po_id, supplierId: null, lines: r, invoiceNo: '', invoiceDate: '', allowExcess: false, closePO: false, paid: '', method: 'CASH', reference: '' }), { idempotencyKey: newKey() });
po = await buyer.get<PO>(`/wholesale/purchase-orders/${a.po_id}`);
ok(po.status === 'RECEIVED' && po.items![0].received === 10 && poActions(po.status).length === 0, 'all 10 arrived: the order is received, nothing left to do');

say('Paying the supplier');
const owe = po.balance;
ok(payProblem('', owe) !== '' && payProblem(String(owe + 5), owe) !== '' && payProblem(String(owe), owe) === '', 'the payment is checked against what is owed');
const pkey = newKey();
const half = Math.floor(owe / 2);
await buyer.post(`/wholesale/purchase-orders/${a.po_id}/payments`, payBody(String(half), 'UPI', 'UTR-E2E'), { idempotencyKey: pkey });
await buyer.post(`/wholesale/purchase-orders/${a.po_id}/payments`, payBody(String(half), 'UPI', 'UTR-E2E'), { idempotencyKey: pkey });
po = await buyer.get<PO>(`/wholesale/purchase-orders/${a.po_id}`);
ok(po.payments!.length === 1 && Math.abs(po.balance - (owe - half)) < 0.01, `paid ${half} once even though sent twice; ${po.balance} is still owed`);

say('A delivery with no order');
const d = [{ ...directLine(plain, null), received: '5', unit_cost: String(plain.purchase_price || 10) }];
ok(grnProblem(d, day, false, null, false) !== '' && grnProblem(d, day, false, suppliers[0].supplier_id, false) === '', 'a delivery with no order needs a supplier');
const b2 = await stockOf(plain.product_id, plain.name);
const direct = await buyer.post<{ grn_number: string }>('/wholesale/grns', grnBody({ poId: null, supplierId: suppliers[0].supplier_id, lines: d, invoiceNo: '', invoiceDate: '', allowExcess: false, closePO: false, paid: '', method: 'CASH', reference: '' }), { idempotencyKey: newKey() });
ok((await stockOf(plain.product_id, plain.name)) - b2 === 5, `${direct.grn_number}: stock up by 5`);
say('A batch-tracked product: batch and use-by date');
const tracked = (await buyer.get<BuyProduct[]>('/wholesale/products/lookup?q=e')).find((p) => p.batch_tracking && p.expiry_tracking && !p.serial_tracking);
if (tracked) {
  let tl = addBLine([], tracked); tl = setBQty(tl, tl[0].key, '3');
  const t = await buyer.post<PO>('/wholesale/purchase-orders', poBody(suppliers[0].supplier_id, tl, { notes: 'e2e purchasing drill' }), { idempotencyKey: newKey() });
  await owner.post(`/wholesale/purchase-orders/${t.po_id}/approve`, {}, { idempotencyKey: newKey() });
  const tpo = await buyer.get<PO>(`/wholesale/purchase-orders/${t.po_id}`);
  let tr = linesFromPO(tpo);
  ok(/batch number/.test(grnProblem(tr, day, false, null, true)), `${tracked.name} is tracked: the app asks for a batch number first`);
  tr = editR(tr, tr[0].key, { batch_no: `E2E${Date.now().toString().slice(-5)}` });
  ok(/use-by/.test(grnProblem(tr, day, false, null, true)), 'then a use-by date');
  tr = editR(tr, tr[0].key, { expiry: '12/2030' });
  ok(grnProblem(tr, day, false, null, true) === '', 'then it passes');
  await buyer.post('/wholesale/grns', grnBody({ poId: t.po_id, supplierId: null, lines: tr, invoiceNo: '', invoiceDate: '', allowExcess: false, closePO: false, paid: '', method: 'CASH', reference: '' }), { idempotencyKey: newKey() });
  const batches = await buyer.get<{ batch_no: string; expiry_date: string; qty_on_hand: number }[]>(`/wholesale/inventory/batches?product_id=${tracked.product_id}`);
  const mine = batches.find((x) => x.batch_no === tr[0].batch_no);
  ok(mine && String(mine.expiry_date).startsWith('2030-12-31'), `the batch ${mine?.batch_no} is on the shelf, use by ${String(mine?.expiry_date).slice(0, 10)}`);
} else say('  (no batch-tracked product in this demo: skipped)');
say('All good.');
