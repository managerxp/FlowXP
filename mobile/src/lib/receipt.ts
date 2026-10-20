/* A receipt as plain text from the server's own invoice (GET /invoices/:id), for the screen and for sharing. Printing comes later. */
import { rupeesExact as rupees, toPaise, qty } from './money.ts';
import type { Preview } from './outbox.ts';

export type InvoiceLine = { description: string; quantity: number; unit_price: number; discount: number; tax_rate: number; line_total: number };
export type Invoice = {
  invoice_id: number; invoice_number: string; invoice_date: string; customer_name?: string | null; customer_phone?: string | null; customer_gstin?: string | null; eway_bill_no?: string | null; cashier?: string | null;
  subtotal: number; discount: number; tax: number; /** GST options (website: GST options): cess and TCS are inside the total, TDS is held back by the customer */ cess?: number; tcs?: number; tds?: number; reverse_charge?: boolean; bill_of_supply?: boolean; round_off: number; total: number; amount_paid: number; balance_due: number;
  order_number?: string | null; table_name?: string | null;
  outlet?: { name: string; address?: string | null; phone?: string | null; gstin?: string | null; city?: string | null } | null;
  seller?: { gstin?: string | null; address?: string | null; city?: string | null; phone?: string | null };
  items: InvoiceLine[]; payments: { method: string; amount: number }[];
};

/** Characters per line of a 58 mm receipt; an 80 mm one is 48 (COLUMNS in escpos.ts). Every layout function takes the width so the text fills the paper it is printed on. */
export const WIDTH = 32;
export const two = (left: string, right: string, width = WIDTH) => (left.length + right.length + 1 > width ? `${left}\n${' '.repeat(Math.max(1, width - right.length))}${right}` : `${left}${' '.repeat(width - left.length - right.length)}${right}`);
const money = (r: number) => rupees(toPaise(r));

export const receiptLines = (inv: Invoice, businessName: string, width = WIDTH): string[] => {
  const out: string[] = [];
  const row = (l: string, r: string) => two(l, r, width);
  out.push(businessName);
  if (inv.bill_of_supply) out.push('BILL OF SUPPLY');   // a composite dealer's bill: no tax on it
  if (inv.outlet?.name && inv.outlet.name !== businessName) out.push(inv.outlet.name);
  const place = [inv.outlet?.address || inv.seller?.address, inv.outlet?.city || inv.seller?.city].filter(Boolean).join(', ');
  if (place) out.push(place);
  const gstin = inv.outlet?.gstin || inv.seller?.gstin;
  if (gstin) out.push(`GSTIN ${gstin}`);
  out.push('-'.repeat(width));
  out.push(row(inv.invoice_number, String(inv.invoice_date).slice(0, 10)));
  if (inv.order_number) out.push(`TOKEN ${inv.order_number}`);
  if (inv.customer_name) out.push(inv.customer_name);
  out.push('-'.repeat(width));
  for (const l of inv.items) {
    out.push(l.description);
    out.push(row(`  ${qty(l.quantity)} x ${money(l.unit_price)}`, money(l.line_total)));
  }
  out.push('-'.repeat(width));
  out.push(row('Subtotal', money(inv.subtotal)));
  if (inv.discount > 0) out.push(row('Discount', `-${money(inv.discount)}`));
  if (!inv.bill_of_supply) out.push(row('GST', money(inv.tax)));
  if (inv.cess) out.push(row('Cess', money(inv.cess)));
  if (inv.tcs) out.push(row('TCS', money(inv.tcs)));
  if (inv.round_off) out.push(row('Round off', money(inv.round_off)));
  out.push(row('TOTAL', money(inv.total)));
  if (inv.tds) out.push(row('TDS held back', money(inv.tds)));
  if (inv.reverse_charge) out.push('Tax payable on reverse charge');
  for (const p of inv.payments) out.push(row(p.method, money(p.amount)));
  if (inv.balance_due > 0) out.push(row('Balance due', money(inv.balance_due)));
  out.push('-'.repeat(width));
  out.push('Thank you');
  return out;
};

export const receiptText = (inv: Invoice, businessName: string, width = WIDTH): string => receiptLines(inv, businessName, width).join('\n');

/** The receipt for a sale still waiting to reach FlowXP: what the till worked out, and plainly NOT the final bill. */
export const pendingReceiptLines = (e: { local_no: string; taken_at: number; preview: Preview }, businessName: string, width = WIDTH): string[] => {
  const row = (l: string, r: string) => two(l, r, width);
  const out: string[] = [businessName, '*** PENDING BILL ***', 'Not final. The real bill number and GST', 'come when it reaches FlowXP.', 'No kitchen ticket was made: tell them.', '-'.repeat(width)];
  out.push(row(e.local_no, new Date(e.taken_at).toISOString().slice(0, 10)));
  out.push('-'.repeat(width));
  for (const l of e.preview.lines) {
    out.push(l.name);
    out.push(row(`  ${qty(l.quantity)} x ${rupees(l.unitPricePaise)}`, rupees(Math.round(l.unitPricePaise * l.quantity))));
  }
  out.push('-'.repeat(width));
  out.push(row('Subtotal', rupees(e.preview.subtotalPaise)));
  out.push(row('GST (about)', rupees(e.preview.taxPaise)));
  if (e.preview.cessPaise) out.push(row('Cess (about)', rupees(e.preview.cessPaise)));
  if (e.preview.tcsPaise) out.push(row('TCS (about)', rupees(e.preview.tcsPaise)));
  out.push(row('TOTAL (about)', rupees(e.preview.totalPaise)));
  if (e.preview.tdsPaise) out.push(row('TDS held back (about)', rupees(e.preview.tdsPaise)));
  const paid = e.preview.paidPaise ?? e.preview.totalPaise - (e.preview.tdsPaise ?? 0);   // not recorded = the whole bill
  if (paid > 0) out.push(row(e.preview.method, rupees(Math.min(paid, e.preview.totalPaise))));
  if (paid < e.preview.totalPaise) out.push(row('BALANCE DUE', rupees(e.preview.totalPaise - paid)));
  out.push('-'.repeat(width));
  return out;
};
export const pendingReceiptText = (e: { local_no: string; taken_at: number; preview: Preview }, businessName: string, width = WIDTH): string => pendingReceiptLines(e, businessName, width).join('\n');
