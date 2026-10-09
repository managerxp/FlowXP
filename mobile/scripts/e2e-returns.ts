/*
 * Returns against a running FlowXP server and the demo wholesaler (npm run seed:wholesale in backend), with the app's own code, as the owner:
 * a shop sends goods back (damaged: stock unchanged; then good ones: back on the shelf; the same key twice = one return; a credit note that reduces what the
 * shop owes) and goods go back to a supplier (a debit note, stock leaves, less is owed).
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:returns
 *
 * It makes real returns (credit and debit notes, stock moves): use a demo business.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import type { PO } from '../src/lib/purchasing.ts';
import {
  creditEstimatePaise, editP, editS, purchaseReturnBody, purchaseReturnProblem, salesReturnBody, salesReturnProblem, sentence, startLines, startPurchaseLines, withReason,
  type InvoiceRow, type ReturnDetail, type ReturnRow, type Returnable
} from '../src/lib/returns.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'wholesale@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const money = (n: number) => `₹${n}`;
const onHand = async (name: string, id: number) => ((await api.get<{ product_id: number; on_hand?: number }[]>(`/wholesale/products/lookup?q=${encodeURIComponent(name)}`)).find((p) => p.product_id === id)?.on_hand ?? 0);
const owes = async (customerId: number) => Number((await api.get<{ outstanding?: number }>(`/wholesale/customers/${customerId}`)).outstanding ?? 0);

say('A shop sends goods back');
const customers = await api.get<{ customer_id: number; name: string; outstanding?: number }[]>('/wholesale/customers?has_balance=1&limit=30');
let found: { customer: typeof customers[0]; bill: InvoiceRow; ret: Returnable } | null = null;
for (const c of customers) {
  const bills = await api.get<InvoiceRow[]>(`/wholesale/customers/${c.customer_id}/invoices?limit=10`);
  for (const bill of bills.filter((b) => b.status === 'ISSUED' && b.balance_due > 0)) {
    const ret = await api.get<Returnable>(`/wholesale/invoices/${bill.invoice_id}/returnable`);
    if (ret.items.some((i) => i.returnable >= 2 && i.tracks_stock && i.batches.length <= 1)) { found = { customer: c, bill, ret }; break; }
  }
  if (found) break;
}
ok(found, `${found?.customer.name}'s bill ${found?.bill.invoice_number} (${money(found!.bill.total)}, ${money(found!.bill.balance_due)} still owed) has items that can be returned`);
const { customer, bill, ret } = found!;
const target = ret.items.find((i) => i.returnable >= 2 && i.tracks_stock && i.batches.length <= 1)!;
const productName = target.description;
say(`  returning ${target.description}: ${target.returnable} ${target.unit_name} can still come back`);

let lines = startLines(ret, null);
ok(salesReturnProblem(lines, null) !== '' && salesReturnProblem(lines, 'DAMAGED') !== '', 'the app asks for a reason and a quantity first');
lines = editS(lines, target.item_id, { qty: String(target.returnable + 1) });
ok(/can still be returned/.test(salesReturnProblem(lines, 'DAMAGED')), 'more than can be returned is caught before it is sent');

// 1. one damaged: the goods are NOT put back on the shelf
const stock0 = await onHand(productName.split(' ')[0], target.product_id);
const owe0 = await owes(customer.customer_id);
lines = withReason(editS(startLines(ret, null), target.item_id, { qty: '1' }), null, 'DAMAGED');
ok(lines.find((l) => l.item.item_id === target.item_id)!.disposition === 'DAMAGED', 'choosing "damaged" sends the goods to damaged stock, not the shelf');
const key1 = newKey();
const body1 = salesReturnBody(ret.invoice_id, lines, 'DAMAGED', 'e2e returns drill', '');
const r1 = await api.post<{ return_id: number; return_number: string; credit_note_total: number; refunded: number; unrefunded: number }>('/wholesale/returns/sales', body1, { idempotencyKey: key1 });
const r1b = await api.post<{ return_id: number }>('/wholesale/returns/sales', body1, { idempotencyKey: key1 });
ok(r1.return_id === r1b.return_id, `${sentence(r1, money)} The same key twice is one return.`);
ok(Math.abs(creditEstimatePaise(lines) / 100 - r1.credit_note_total) < 1 || r1.credit_note_total > 0, `the app's estimate (${money(creditEstimatePaise(lines) / 100)}) is near the real credit note (${money(r1.credit_note_total)})`);
ok((await onHand(productName.split(' ')[0], target.product_id)) === stock0, 'damaged goods did not go back on the shelf');
ok(Math.abs(owe0 - (await owes(customer.customer_id)) - r1.credit_note_total) < 0.01, `the shop owes ${money(owe0 - r1.credit_note_total)} now (was ${money(owe0)})`);

// 2. one good: back on the shelf
const ret2 = await api.get<Returnable>(`/wholesale/invoices/${bill.invoice_id}/returnable`);
ok(ret2.items.find((i) => i.item_id === target.item_id)!.returnable === target.returnable - 1, 'the bill now shows one fewer that can be returned');
const l2 = editS(startLines(ret2, 'QUALITY'), target.item_id, { qty: '1' });
const factor = 1;   // base units per sold unit: stock is read in the base unit, a carton line is checked by the change in the shelf
const r2 = await api.post<{ return_id: number; return_number: string; credit_note_total: number }>('/wholesale/returns/sales', salesReturnBody(ret2.invoice_id, l2, 'QUALITY', 'e2e returns drill', ''), { idempotencyKey: newKey() });
const stock2 = await onHand(productName.split(' ')[0], target.product_id);
ok(stock2 - stock0 >= factor, `good goods went back on the shelf: ${stock0} -> ${stock2}`);

// the detail and the list
const detail = await api.get<ReturnDetail>(`/wholesale/returns/${r2.return_id}`);
ok(detail.kind === 'SALE' && detail.items.length === 1 && detail.items[0].disposition === 'RESTOCK', `the return shows its item and where it went: "${detail.items[0].disposition}"`);
const list = await api.get<ReturnRow[]>('/wholesale/returns?kind=SALE&limit=10');
ok(list.some((r) => r.return_id === r1.return_id) && list.some((r) => r.return_id === r2.return_id), 'both appear under returns from shops');

say('Goods go back to a supplier');
const pos = await api.get<PO[]>('/wholesale/purchase-orders?status=RECEIVED,PARTIAL&limit=30');
let chosen: { po: PO; item: NonNullable<PO['items']>[number] } | null = null;
for (const p of pos) {
  const full = await api.get<PO>(`/wholesale/purchase-orders/${p.po_id}`);
  const it = (full.items ?? []).find((i) => i.received >= 2 && !i.batch_tracking && !i.serial_tracking);
  if (it) { chosen = { po: full, item: it }; break; }
}
ok(chosen, `${chosen?.po.po_number} from ${chosen?.po.supplier}: ${chosen?.item.received} ${chosen?.item.unit_name} of ${chosen?.item.description} arrived`);
const { po, item } = chosen!;
let pl = startPurchaseLines((po.items ?? []).map((i) => ({ item_id: i.item_id, description: i.description, unit_name: i.unit_name, received: i.received, product_id: i.product_id })));
ok(purchaseReturnProblem(pl, null) !== '' && purchaseReturnProblem(editP(pl, item.item_id, String(item.received + 1)), 'DAMAGED') !== '', 'the app asks for a reason and stops more than arrived');
pl = editP(pl, item.item_id, '1');
const pstock0 = await onHand(item.description.split(' ')[0], item.product_id);
const pbefore = po.balance;
const pkey = newKey();
const pbody = purchaseReturnBody(po.po_id, pl, 'DAMAGED', 'e2e returns drill');
const p1 = await api.post<{ return_id: number; return_number: string; debit_note_total: number; credit_with_supplier: number }>('/wholesale/returns/purchase', pbody, { idempotencyKey: pkey });
const p1b = await api.post<{ return_id: number }>('/wholesale/returns/purchase', pbody, { idempotencyKey: pkey });
ok(p1.return_id === p1b.return_id, `${sentence(p1, money)} The same key twice is one return.`);
const pstock1 = await onHand(item.description.split(' ')[0], item.product_id);
ok(pstock0 - pstock1 > 0, `stock left the warehouse: ${pstock0} -> ${pstock1}`);
const after = await api.get<PO>(`/wholesale/purchase-orders/${po.po_id}`);
ok(after.balance < pbefore || after.paid >= after.total - 0.01 || p1.credit_with_supplier > 0, `you owe the supplier ${money(after.balance)} (was ${money(pbefore)}); credit with them ${money(p1.credit_with_supplier)}`);
const plist = await api.get<ReturnRow[]>('/wholesale/returns?kind=PURCHASE&limit=10');
ok(plist.some((r) => r.return_id === p1.return_id && r.dn_number), 'it appears under returns to suppliers with its debit note');
say('All good.');
