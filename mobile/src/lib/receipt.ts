/* A receipt as plain text from the server's own invoice (GET /invoices/:id), for the screen and for sharing. Printing comes later. */
import { rupeesExact as rupees, toPaise, qty } from './money.ts';
import type { Preview } from './outbox.ts';
import { wholeInWords } from './taxInvoice.ts';

/** 2120.34 becomes "Two Thousand One Hundred Twenty Rupees and Thirty Four Paise Only", the same wording as the thermal printer's receipt. */
export const rupeesInWords = (amount: number): string => { const paise = Math.round(Math.abs(amount) * 100); const p = paise % 100; return `${wholeInWords(Math.floor(paise / 100))} Rupees${p ? ` and ${wholeInWords(p)} Paise` : ''} Only`; };

export type InvoiceLine = { description: string; quantity: number; unit_price: number; discount: number; tax_rate: number; line_total: number; tax_amount?: number; cess?: number; unit?: string | null; hsn?: string | null };
export type Invoice = {
  invoice_id: number; invoice_number: string; invoice_date: string; customer_name?: string | null; customer_phone?: string | null; customer_gstin?: string | null; eway_bill_no?: string | null; cashier?: string | null;
  /** the website's receipt: tax split by name (UTGST in a union territory) and the Show-the-tax-lines switch */ cgst?: number; sgst?: number; igst?: number; tax_name?: string; receipt?: { show_tax_lines?: boolean; show_hsn?: boolean; header_text?: string; show_phone?: boolean; show_total_qty?: boolean; show_amount_words?: boolean; show_terms?: boolean; terms?: string };
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

/** Column widths of the item table: Qty, Rate, Amount on the right, the name column gets the rest (the same as the website's receipt). */
const tableWidths = (width: number) => { const w = width >= 48 ? [7, 9, 10] : [7, 8, 9]; return { w, leftW: width - w[0] - w[1] - w[2] }; };
const plain = (r: number) => (Math.round(r * 100) / 100).toFixed(2);
/** One row of the item table: name column, then Qty, Rate and Amount right-aligned. */
const tableRow = (width: number) => { const { w, leftW } = tableWidths(width); return (left: string, q: string, rate: string, amount: string) => left.slice(0, leftW).padEnd(leftW) + q.slice(0, w[0]).padStart(w[0]) + rate.slice(0, w[1]).padStart(w[1]) + amount.slice(0, w[2]).padStart(w[2]); };
/** Break text into rows of at most `width` characters; a longer word is split. */
const wordWrap = (text: string, width: number): string[] => {
  const rows: string[] = []; let row = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > width) { if (row) { rows.push(row); row = ''; } for (let i = 0; i < word.length; i += width) rows.push(word.slice(i, i + width)); continue; }
    if ((row + ' ' + word).trim().length > width) { rows.push(row); row = word; } else row = (row + ' ' + word).trim();
  }
  if (row) rows.push(row);
  return rows;
};

export const receiptLines = (inv: Invoice, businessName: string, width = WIDTH): string[] => {
  const out: string[] = [];
  const row = (l: string, r: string) => two(l, r, width);
  out.push(businessName);
  if (inv.bill_of_supply) out.push('BILL OF SUPPLY');   // a composite dealer's bill: no tax on it
  if (inv.outlet?.name && inv.outlet.name !== businessName) out.push(inv.outlet.name);
  const place = [inv.outlet?.address || inv.seller?.address, inv.outlet?.city || inv.seller?.city].filter(Boolean).join(', ');
  if (place) out.push(place);
  if (inv.receipt?.header_text) out.push(...wordWrap(inv.receipt.header_text, width));
  const phone = inv.outlet?.phone || inv.seller?.phone;
  if (phone && inv.receipt?.show_phone !== false) out.push(`Ph: ${phone}`);
  const gstin = inv.outlet?.gstin || inv.seller?.gstin;
  if (gstin) out.push(`GSTIN ${gstin}`);
  out.push('-'.repeat(width));
  out.push(row(inv.invoice_number, String(inv.invoice_date).slice(0, 10)));
  if (inv.order_number) out.push(`TOKEN ${inv.order_number}`);
  if (inv.customer_name) out.push(inv.customer_name);
  out.push('-'.repeat(width));
  // Item / Qty / Rate / Amount, as on the website's receipt: the name wraps inside its own column and the numbers sit on its last row.
  // The amount is before tax while the tax lines are shown (rows add up to the Subtotal), and with tax when they are hidden (rows add up to the Total).
  const showTax = inv.receipt?.show_tax_lines !== false;
  const { leftW } = tableWidths(width);
  const cells = tableRow(width);
  out.push(cells('Item', 'Qty', 'Rate', 'Amount'));
  out.push('-'.repeat(width));
  let totalQty = 0; let lineSaved = 0;
  for (const l of inv.items) {
    const amount = showTax ? l.line_total - (l.tax_amount || 0) - (l.cess || 0) : l.line_total;
    totalQty += l.quantity; lineSaved += l.discount || 0;
    const names = wordWrap(l.description, leftW);
    const last = names.pop() ?? '';
    for (const n of names) out.push(n);
    const showHsn = inv.receipt?.show_hsn === true && l.hsn;
    if (showHsn) { if (last) out.push(last); out.push(`  HSN ${l.hsn}`); }
    out.push(cells(showHsn ? '' : last, `${qty(l.quantity)}${l.unit && l.unit.length <= 3 ? ` ${l.unit}` : ''}`, plain(l.unit_price), plain(amount)));
    if (l.discount > 0) out.push(row('  Discount', `-${plain(l.discount)}`));
  }
  out.push('-'.repeat(width));
  out.push(row(`Items: ${inv.items.length}`, inv.receipt?.show_total_qty === false ? '' : `Total Qty: ${qty(totalQty)}`));
  const split: [string, number | undefined][] = [['CGST', inv.cgst], [inv.tax_name || 'SGST', inv.sgst], ['IGST', inv.igst]];
  if (showTax) {
    out.push(row('Subtotal', money(inv.subtotal)));
    if (!inv.bill_of_supply) {
      if (split.some(([, v]) => (v ?? 0) > 0)) for (const [label, v] of split) { if ((v ?? 0) > 0) out.push(row(label, money(v as number))); }
      else out.push(row('GST', money(inv.tax)));   // a bill that came without the split
    }
  }
  if (inv.discount > 0) out.push(row('Discount', `-${money(inv.discount)}`));
  if (inv.cess) out.push(row('Cess', money(inv.cess)));
  if (inv.tcs) out.push(row('TCS', money(inv.tcs)));
  if (inv.round_off) out.push(row('Round off', money(inv.round_off)));
  out.push(row('TOTAL', money(inv.total)));
  if (inv.receipt?.show_amount_words === true) out.push(...wordWrap(rupeesInWords(inv.total), width));
  if (lineSaved + inv.discount > 0) out.push(`You saved Rs ${plain(lineSaved + inv.discount)}`);
  if (inv.tds) out.push(row('TDS held back', money(inv.tds)));
  if (inv.reverse_charge) out.push('Tax payable on reverse charge');
  for (const p of inv.payments) out.push(row(p.method, money(p.amount)));
  if (inv.balance_due > 0) out.push(row('Balance due', money(inv.balance_due)));
  out.push('-'.repeat(width));
  if (inv.receipt?.show_terms === true && inv.receipt.terms) { out.push(...wordWrap(`Terms: ${inv.receipt.terms}`, width)); out.push('-'.repeat(width)); }
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
  // the same Item / Qty / Rate / Amount table as the real bill (amounts before tax, as worked out on this phone)
  const cells = tableRow(width); const leftW = tableWidths(width).leftW;
  out.push(cells('Item', 'Qty', 'Rate', 'Amount'));
  out.push('-'.repeat(width));
  let totalQty = 0;
  for (const l of e.preview.lines) {
    totalQty += l.quantity;
    const names = wordWrap(l.name, leftW); const last = names.pop() ?? '';
    for (const n of names) out.push(n);
    out.push(cells(last, qty(l.quantity), plain(l.unitPricePaise / 100), plain(Math.round(l.unitPricePaise * l.quantity) / 100)));
  }
  out.push('-'.repeat(width));
  out.push(row(`Items: ${e.preview.lines.length}`, `Total Qty: ${qty(totalQty)}`));
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
