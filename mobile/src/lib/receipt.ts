/* A receipt as plain text from the server's own invoice (GET /invoices/:id), for the screen and for sharing. Printing comes later. */
import { rupees, toPaise, qty } from './money.ts';
import type { Preview } from './outbox.ts';

export type InvoiceLine = { description: string; quantity: number; unit_price: number; discount: number; tax_rate: number; line_total: number };
export type Invoice = {
  invoice_id: number; invoice_number: string; invoice_date: string; customer_name?: string | null; cashier?: string | null;
  subtotal: number; discount: number; tax: number; round_off: number; total: number; amount_paid: number; balance_due: number;
  order_number?: string | null;
  outlet?: { name: string; address?: string | null; phone?: string | null; gstin?: string | null; city?: string | null } | null;
  seller?: { gstin?: string | null; address?: string | null; city?: string | null; phone?: string | null };
  items: InvoiceLine[]; payments: { method: string; amount: number }[];
};

const WIDTH = 32;
const two = (left: string, right: string) => (left.length + right.length + 1 > WIDTH ? `${left}\n${' '.repeat(Math.max(1, WIDTH - right.length))}${right}` : `${left}${' '.repeat(WIDTH - left.length - right.length)}${right}`);
const money = (r: number) => rupees(toPaise(r));

export const receiptLines = (inv: Invoice, businessName: string): string[] => {
  const out: string[] = [];
  out.push(businessName);
  if (inv.outlet?.name && inv.outlet.name !== businessName) out.push(inv.outlet.name);
  const place = [inv.outlet?.address || inv.seller?.address, inv.outlet?.city || inv.seller?.city].filter(Boolean).join(', ');
  if (place) out.push(place);
  const gstin = inv.outlet?.gstin || inv.seller?.gstin;
  if (gstin) out.push(`GSTIN ${gstin}`);
  out.push('-'.repeat(WIDTH));
  out.push(two(inv.invoice_number, String(inv.invoice_date).slice(0, 10)));
  if (inv.order_number) out.push(`TOKEN ${inv.order_number}`);
  if (inv.customer_name) out.push(inv.customer_name);
  out.push('-'.repeat(WIDTH));
  for (const l of inv.items) {
    out.push(l.description);
    out.push(two(`  ${qty(l.quantity)} x ${money(l.unit_price)}`, money(l.line_total)));
  }
  out.push('-'.repeat(WIDTH));
  out.push(two('Subtotal', money(inv.subtotal)));
  if (inv.discount > 0) out.push(two('Discount', `-${money(inv.discount)}`));
  out.push(two('GST', money(inv.tax)));
  if (inv.round_off) out.push(two('Round off', money(inv.round_off)));
  out.push(two('TOTAL', money(inv.total)));
  for (const p of inv.payments) out.push(two(p.method, money(p.amount)));
  if (inv.balance_due > 0) out.push(two('Balance due', money(inv.balance_due)));
  out.push('-'.repeat(WIDTH));
  out.push('Thank you');
  return out;
};

export const receiptText = (inv: Invoice, businessName: string): string => receiptLines(inv, businessName).join('\n');

/** The receipt for a sale still waiting to reach FlowXP: what the till worked out, and plainly NOT the final bill. */
export const pendingReceiptLines = (e: { local_no: string; taken_at: number; preview: Preview }, businessName: string): string[] => {
  const out: string[] = [businessName, '*** PENDING BILL ***', 'Not final. The real bill number and GST', 'come when it reaches FlowXP.', 'No kitchen ticket was made: tell them.', '-'.repeat(WIDTH)];
  out.push(two(e.local_no, new Date(e.taken_at).toISOString().slice(0, 10)));
  out.push('-'.repeat(WIDTH));
  for (const l of e.preview.lines) {
    out.push(l.name);
    out.push(two(`  ${qty(l.quantity)} x ${rupees(l.unitPricePaise)}`, rupees(Math.round(l.unitPricePaise * l.quantity))));
  }
  out.push('-'.repeat(WIDTH));
  out.push(two('Subtotal', rupees(e.preview.subtotalPaise)));
  out.push(two('GST (about)', rupees(e.preview.taxPaise)));
  out.push(two('TOTAL (about)', rupees(e.preview.totalPaise)));
  out.push(two(e.preview.method, rupees(e.preview.totalPaise)));
  out.push('-'.repeat(WIDTH));
  return out;
};
export const pendingReceiptText = (e: { local_no: string; taken_at: number; preview: Preview }, businessName: string): string => pendingReceiptLines(e, businessName).join('\n');
