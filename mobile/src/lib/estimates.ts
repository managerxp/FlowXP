/* Estimates / quotations on the phone: the checks before saving, the words shared with the customer and the printed page. No React here, so it can be tested. */
import { rupees, toPaise } from './money.ts';

export type EstimateLine = { product_id?: number | null; description: string; quantity: number; unit_price: number; tax_rate?: number };
export type Estimate = {
  estimate_id: number; estimate_number: string; customer_name: string | null; items: EstimateLine[]; discount: number; total: number;
  /** before GST, and the GST the invoice will add (0 when the business does not charge it) */
  subtotal?: number; tax?: number;
  notes: string | null; valid_until: string | null; status: 'OPEN' | 'CONVERTED' | 'CANCELLED'; invoice_id: number | null;
};
/** product_id set = a catalogue item (its name and price filled in, the price can still be changed); unset = a line typed by hand */
export type DraftLine = { description: string; quantity: string; price: string; product_id?: number; tax_rate?: number };
export type EstimateBusiness = { name: string; address?: string | null; phone?: string | null; gstin?: string | null };

export const blankLine = (): DraftLine => ({ description: '', quantity: '1', price: '' });
export const productLine = (p: { product_id: number; name: string; selling_price: number; tax_rate: number }): DraftLine =>
  ({ description: p.name, quantity: '1', price: String(p.selling_price), product_id: p.product_id, tax_rate: p.tax_rate });

/** Add a catalogue item: one more of it when it is already there; otherwise it takes the place of an empty line, or goes at the end. */
export const addProduct = (lines: DraftLine[], line: DraftLine): DraftLine[] => {
  const same = lines.findIndex((l) => l.product_id === line.product_id);
  if (same >= 0) return lines.map((l, i) => (i === same ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
  const empty = lines.findIndex((l) => !l.product_id && !l.description.trim() && !l.price.trim());
  return empty >= 0 ? lines.map((l, i) => (i === empty ? line : l)) : [...lines, line];
};

/** The lines that have anything in them, as the server wants them. */
export const filledLines = (lines: DraftLine[]): DraftLine[] => lines.filter((l) => l.product_id || l.description.trim() || l.price.trim());

export const estimateProblem = (lines: DraftLine[]): string | null => {
  const used = filledLines(lines);
  if (!used.length) return 'Add at least one item';
  for (const l of used) {
    if (!l.description.trim()) return 'Every line needs a name';
    if (!(Number(l.quantity) > 0)) return 'Enter a quantity above zero';
    if (l.price.trim() === '' || !(Number(l.price) >= 0)) return 'Enter a price';
  }
  return null;
};

export const estimateBody = (name: string, discount: string, lines: DraftLine[]) => ({
  ...(name.trim() ? { customer_name: name.trim() } : {}),
  ...(Number(discount) > 0 ? { discount: Number(discount) } : {}),
  items: filledLines(lines).map((l) => ({ ...(l.product_id ? { product_id: l.product_id } : {}), description: l.description.trim(), quantity: Number(l.quantity), unit_price: Number(l.price) }))
});

/** What the draft adds up to, in paise, before GST and before the server's own total. */
export const draftTotalPaise = (lines: DraftLine[], discount: string): number =>
  Math.max(0, filledLines(lines).reduce((a, l) => a + Math.round((Number(l.quantity) || 0) * toPaise(l.price || '0')), 0) - toPaise(discount || '0'));

const lineAmount = (i: EstimateLine) => Math.round(i.quantity * toPaise(i.unit_price));

/** The estimate as a WhatsApp / share-sheet message. */
export const estimateText = (e: Estimate, business: string): string => [
  `${business} - Estimate ${e.estimate_number}`,
  ...(e.customer_name ? [`For: ${e.customer_name}`] : []),
  '',
  ...e.items.map((i, n) => `${n + 1}. ${i.description}  ${i.quantity} x ${rupees(toPaise(i.unit_price))} = ${rupees(lineAmount(i))}`),
  ...((e.tax ?? 0) > 0 ? ['', `GST: ${rupees(toPaise(e.tax ?? 0))}`] : []),
  ...(e.discount > 0 ? ['', `Discount: ${rupees(toPaise(e.discount))}`] : []),
  '',
  `Total: ${rupees(toPaise(e.total))}`,
  ...(e.valid_until ? [`Valid until: ${e.valid_until}`] : []),
  ...(e.notes ? [e.notes] : [])
].join('\n');

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A one-page A4 estimate, or the same lines as a proforma invoice, for the phone's print screen or a PDF. Mirrors the website's printEstimate. */
export const estimateHtml = (e: Estimate, biz: EstimateBusiness, proforma = false): string => {
  const gst = (e.tax ?? 0) > 0;
  const span = gst ? 5 : 4;
  const sum = (label: string, v: string) => `<tr><td colspan="${span}" class="r">${label}</td><td class="r">${v}</td></tr>`;
  const rows = e.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${rupees(toPaise(i.unit_price))}</td>${gst ? `<td class="r">${Number(i.tax_rate) || 0}%</td>` : ''}<td class="r">${rupees(lineAmount(i))}</td></tr>`).join('');
  const from = [biz.address, biz.phone, biz.gstin ? `GSTIN ${biz.gstin}` : ''].filter(Boolean).map(esc).join(' &middot; ');
  const forWho = [e.customer_name ? `For ${esc(e.customer_name)}` : '', e.valid_until ? `Valid until ${esc(e.valid_until)}` : ''].filter(Boolean).join(' &middot; ');
  return `<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
body{font:14px sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0}h2{font-size:16px;margin:20px 0 4px}p{margin:4px 0}
table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left}.r{text-align:right}.t td{font-weight:700}.m{color:#555;font-size:12px}
</style></head><body><h1>${esc(biz.name)}</h1>${from ? `<p class="m">${from}</p>` : ''}
<h2>${proforma ? 'Proforma invoice' : 'Estimate'} ${esc(e.estimate_number)}</h2>${forWho ? `<p>${forWho}</p>` : ''}
<table><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th>${gst ? '<th class="r">GST</th>' : ''}<th class="r">Amount</th></tr>${rows}
${gst ? sum('Subtotal', rupees(toPaise(e.subtotal ?? 0))) + sum('GST', rupees(toPaise(e.tax ?? 0))) : ''}${e.discount > 0 ? sum('Discount', `- ${rupees(toPaise(e.discount))}`) : ''}<tr class="t"><td colspan="${span}" class="r">Total</td><td class="r">${rupees(toPaise(e.total))}</td></tr></table>
${e.notes ? `<p>${esc(e.notes)}</p>` : ''}<p class="m">${proforma ? 'This is a proforma invoice, not a tax invoice. The tax invoice is issued on payment or delivery.' : 'This is an estimate, not a bill.'}</p></body></html>`;
};
