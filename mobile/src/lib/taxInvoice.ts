/*
 * The Tally-style GST tax invoice on the phone: the same document the website shows (frontend billing/TallyInvoice.jsx), as one HTML page that
 * is turned into a PDF to share, or sent to the phone's print screen (A4 / A5). The seller, consignee and buyer boxes, the invoice / delivery /
 * dispatch grid, the item table with HSN, the tax lines, the total in words and a tax summary per HSN. It reads the server's invoice
 * (GET /invoices/:id gives the print settings, the per-invoice details and the business details already), so it prints what the website prints.
 * The words are the statutory ones and stay in English on purpose.
 */
export type TaxItem = { item_id?: number; /** compensation cess on the line: inside line_total, not part of the taxable value */ cess?: number; description: string; quantity: number; unit_price: number; discount: number; tax_rate: number; tax_amount: number; line_total: number; hsn?: string | null; unit?: string | null };
export type PrintSettings = {
  layout: string; paper: 'A4' | 'A5'; text_size: 'small' | 'medium' | 'large'; accent: string; copies: string[]; declaration: string; signature_text: string; footer_note: string;
  show: Record<string, boolean>;
};
export type TaxInvoice = {
  invoice_id: number; invoice_number: string; invoice_date: string; customer_name?: string | null; customer_phone?: string | null; customer_gstin?: string | null; customer_address?: string | null; customer_state?: string | null; customer_email?: string | null;
  customer_state_code?: string | null; consignee_state_code?: string | null;
  subtotal: number; discount: number; tax: number; cgst: number; sgst: number; igst: number; cess?: number; tcs?: number; tds?: number; reverse_charge?: boolean; bill_of_supply?: boolean;
  round_off: number; total: number; balance_due: number; notes?: string | null; irn?: string | null; eway_bill_no?: string | null;
  outlet?: { name?: string; address?: string | null; phone?: string | null; gstin?: string | null; city?: string | null } | null;
  seller?: { state?: string | null; state_code?: string | null; gstin?: string | null; address?: string | null; city?: string | null; phone?: string | null };
  print_extra?: Record<string, string>; print_details?: Record<string, string>; invoice_print?: Partial<PrintSettings>;
  items: TaxItem[]; payments: { method: string }[];
};
export type TaxBusiness = { name: string; email?: string | null; receipt_settings?: { logo_url?: string | null } | null };

/** Business types whose bills default to the tax-invoice layout (the website's TALLY_TYPES); the owner can force either layout in invoice print settings. */
export const TALLY_TYPES = ['WHOLESALE', 'DISTRIBUTOR', 'AUTO_PARTS', 'ELECTRONICS'];
export const usesTaxInvoice = (invoice: Pick<TaxInvoice, 'invoice_print'> | null, businessType: string | undefined): boolean => {
  const layout = invoice?.invoice_print?.layout ?? 'auto';
  return layout === 'tally' || (layout === 'auto' && TALLY_TYPES.includes(businessType ?? ''));
};

/** The free-text details a tax invoice prints that change from sale to sale (backend PRINT_EXTRA_FIELDS): [key, label, big]. */
export const DETAIL_FIELDS: [string, string, boolean][] = [
  ['consignee_name', 'Consignee (ship to) name', false], ['consignee_address', 'Consignee address', true], ['consignee_state', 'Consignee state', false],
  ['buyer_address', 'Buyer address', true], ['buyer_state', 'Buyer state', false], ['buyer_email', 'Buyer e-mail', false],
  ['delivery_note', 'Delivery note', false], ['reference_no', 'Reference no. & date', false], ['other_references', 'Other references', false],
  ["buyer_order_no", "Buyer's order no.", false], ['dispatch_doc_no', 'Dispatch doc no.', false], ['dispatched_through', 'Dispatched through', false],
  ['destination', 'Destination', false], ['payment_terms', 'Mode/terms of payment', false], ['terms_of_delivery', 'Terms of delivery', false]
];

/** What a bill may send as `print_details` when it is made: only the filled fields, trimmed; null when there is nothing to send. */
export const detailsBody = (v: Record<string, string>): Record<string, string> | null => {
  const out: Record<string, string> = {};
  for (const [k] of DETAIL_FIELDS) if ((v[k] ?? '').trim()) out[k] = v[k].trim();
  return Object.keys(out).length ? out : null;
};

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n: number): string => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && below100(n % 100)].filter(Boolean).join(' ');
/** Indian grouping: crore, lakh, thousand. */
export const wholeInWords = (n: number): string => {
  if (n === 0) return 'Zero';
  const parts = ([[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as const).map(([v, name]) => { const q = Math.floor(n / v); n %= v; return q ? `${below1000(q)} ${name}` : ''; });
  return [...parts, below1000(n)].filter(Boolean).join(' ');
};
/** 13900 becomes "Thirteen Thousand Nine Hundred INR Only"; 2120.34 becomes "Two Thousand One Hundred Twenty INR and Thirty Four paise Only". */
export const inWords = (amount: number): string => {
  const paise = Math.round(Math.abs(amount) * 100); const r = Math.floor(paise / 100); const p = paise % 100;
  return `${wholeInWords(r)} INR${p ? ` and ${below100(p)} paise` : ''} Only`;
};

const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl2br = (s: unknown): string => esc(s).replace(/\n/g, '<br/>');
const money = (n: number): string => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n: number): string => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dated = (iso: string): string => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}-${MONTHS[Number(m) - 1] ?? m}-${String(y).slice(2)}`; };

export const PAPER_WIDTH = { A4: 760, A5: 540 } as const;
const TEXT_PX = { small: 11, medium: 12, large: 13.5 } as const;
const COPY_LABELS = ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'];
const DEFAULT_SHOW = { logo: true, email: true, pan: true, hsn: true, unit: true, rate_incl_tax: true, disc_pct: true, total_qty: true, amount_in_words: true, tax_summary: true, bank: true, terms: true, signature: true, received_by: true, eoe: true };
export const printSettings = (stored: Partial<PrintSettings> | undefined): PrintSettings => ({
  layout: 'auto', paper: 'A4', text_size: 'medium', accent: '#111827', declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  signature_text: 'Authorised Signatory', footer_note: 'This is a Computer Generated Invoice', ...stored, copies: Array.isArray(stored?.copies) ? stored!.copies : [], show: { ...DEFAULT_SHOW, ...(stored?.show ?? {}) }
});

const place = (o?: { address?: string | null; city?: string | null } | null): string => [o?.address, o?.city].filter(Boolean).join(', ');

/** The invoice as an HTML page, one sheet per copy chosen in the settings, and the width in pixels to print it at. */
export const taxInvoiceHtml = (invoice: TaxInvoice, business: TaxBusiness): { html: string; width: number } => {
  const cfg = printSettings(invoice.invoice_print);
  const sh = cfg.show;
  const acc = /^#[0-9a-f]{6}$/i.test(cfg.accent) ? cfg.accent : '#111827';
  const width = PAPER_WIDTH[cfg.paper] ?? 760;
  const x = invoice.print_extra ?? {}; const d = invoice.print_details ?? {};
  const igst = invoice.igst > 0;
  const lines = invoice.items.map((i) => ({ ...i, taxable: i.line_total - i.tax_amount - (i.cess ?? 0), gross: i.unit_price * (1 + i.tax_rate / 100), discPct: i.unit_price * i.quantity > 0 ? (i.discount / (i.unit_price * i.quantity)) * 100 : 0 }));
  const groups = new Map<string, { hsn: string; rate: number; taxable: number; tax: number }>();
  for (const l of lines) {
    const k = `${l.hsn || ''}|${l.tax_rate}`;
    const g = groups.get(k) ?? { hsn: l.hsn || '', rate: l.tax_rate, taxable: 0, tax: 0 };
    g.taxable += l.taxable; g.tax += l.tax_amount; groups.set(k, g);
  }
  const rows = [...groups.values()];
  const totalQty = lines.reduce((s, l) => s + Number(l.quantity), 0);
  const taxableTotal = rows.reduce((s, g) => s + g.taxable, 0);
  const outlet = invoice.outlet; const seller = invoice.seller;
  const gstin = outlet?.gstin || seller?.gstin;
  const home = outlet?.address ? outlet : seller;
  const methods = [...new Set((invoice.payments ?? []).map((p) => p.method))].join(', ');
  const buyerAddress = x.buyer_address ?? invoice.customer_address; const buyerState = x.buyer_state ?? invoice.customer_state; const buyerEmail = x.buyer_email ?? invoice.customer_email;
  const hasConsignee = Boolean(x.consignee_name || x.consignee_address || x.consignee_state);
  const stateLine = (name?: string | null, code?: string | null) => (name ? `<p>State Name : ${esc(name)}${code ? `, Code : ${esc(code)}` : ''}</p>` : '');
  const cols = 5 + (sh.hsn ? 1 : 0) + (sh.rate_incl_tax ? 1 : 0) + (sh.disc_pct ? 1 : 0);
  const labelSpan = sh.hsn ? 3 : 2;
  const unitOf = (l: { unit?: string | null }) => (sh.unit ? ` ${esc(l.unit || 'nos')}` : '');
  const cell = 'border:1px solid var(--acc);padding:3px 5px';
  const open = 'border:1px solid var(--acc);border-top:0;border-bottom:0;padding:3px 5px';   // item rows: only the vertical lines
  const grid = (label: string, value: string, span = false) => `<div style="border-bottom:1px solid var(--acc);border-right:1px solid var(--acc);padding:5px${span ? ';grid-column:span 2' : ''}"><p style="font-size:10px">${label}</p><p style="font-weight:bold;word-break:break-all">${esc(value)}</p></div>`;
  const isTax = invoice.tax > 0 && !invoice.bill_of_supply;
  const taxRows: [string, number][] = ([igst ? ['IGST', invoice.igst] : null, !igst && invoice.cgst > 0 ? ['CGST', invoice.cgst] : null, !igst && invoice.sgst > 0 ? ['SGST/UTGST', invoice.sgst] : null,
    (invoice.cess ?? 0) > 0 ? ['Cess', invoice.cess!] : null, (invoice.tcs ?? 0) > 0 ? ['TCS', invoice.tcs!] : null, invoice.round_off ? ['Round Off', invoice.round_off] : null] as ([string, number] | null)[]).filter((r): r is [string, number] => r !== null);

  const sheet = (label: string | null, last: boolean) => `
<article style="width:${width}px;margin:0 auto;padding:12px;font-size:${TEXT_PX[cfg.text_size] ?? 12}px;line-height:1.35;color:#111;background:#fff;--acc:${acc};box-sizing:border-box;${last ? '' : 'page-break-after:always;'}">
  ${label ? `<p style="text-align:right;font-size:10px;font-weight:600;text-transform:uppercase">${esc(label)}</p>` : ''}
  <p style="text-align:center;font-size:1.25em;font-weight:bold;color:var(--acc);margin:0 0 4px">${isTax ? 'Tax Invoice' : 'Bill of Supply'}</p>
  ${invoice.reverse_charge ? '<p style="text-align:center;font-size:.85em;font-weight:600;margin:0 0 4px">Tax is payable on reverse charge</p>' : ''}
  <div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--acc);border-bottom:0;border-right:0">
    <div style="border-bottom:1px solid var(--acc);border-right:1px solid var(--acc);padding:5px">
      ${sh.logo && business.receipt_settings?.logo_url ? `<img src="${esc(business.receipt_settings.logo_url)}" style="max-height:48px;max-width:128px;object-fit:contain;margin-bottom:4px"/>` : ''}
      <p style="font-weight:bold">${esc(business.name)}</p>
      ${place(home) ? `<p>${esc(place(home))}</p>` : ''}
      ${outlet?.phone || seller?.phone ? `<p>Phone: ${esc(outlet?.phone || seller?.phone)}</p>` : ''}
      ${gstin ? `<p>GSTIN/UIN: ${esc(gstin)}</p>` : ''}
      ${stateLine(seller?.state, seller?.state_code)}
      ${sh.email && business.email ? `<p>E-Mail : ${esc(business.email)}</p>` : ''}
      <div style="margin-top:6px;border-top:1px solid var(--acc);padding-top:4px">
        <p style="font-size:10px">Consignee (Ship to)</p>
        <p style="font-weight:bold">${esc(hasConsignee ? x.consignee_name : (invoice.customer_name || 'Walk-in customer'))}</p>
        ${hasConsignee ? `${x.consignee_address ? `<p>${nl2br(x.consignee_address)}</p>` : ''}${stateLine(x.consignee_state, invoice.consignee_state_code)}` : '<p>Same as buyer</p>'}
      </div>
      <div style="margin-top:6px;border-top:1px solid var(--acc);padding-top:4px">
        <p style="font-size:10px">Buyer (Bill to)</p>
        <p style="font-weight:bold">${esc(invoice.customer_name || 'Walk-in customer')}</p>
        ${buyerAddress ? `<p>${nl2br(buyerAddress)}</p>` : ''}
        ${invoice.customer_phone ? `<p>Phone: ${esc(invoice.customer_phone)}</p>` : ''}
        ${invoice.customer_gstin ? `<p>GSTIN/UIN: ${esc(invoice.customer_gstin)}</p>` : ''}
        ${stateLine(buyerState, invoice.customer_state_code)}
        ${buyerEmail ? `<p>E-Mail : ${esc(buyerEmail)}</p>` : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;align-content:start">
      ${grid('Invoice No.', invoice.invoice_number)}${grid('Dated', dated(invoice.invoice_date))}
      ${grid('Delivery Note', x.delivery_note || '')}${grid('Mode/Terms of Payment', x.payment_terms || methods || (invoice.balance_due > 0 ? 'Credit' : ''))}
      ${grid('Reference No. &amp; Date', x.reference_no || '')}${grid('Other References', x.other_references || '')}
      ${grid("Buyer's Order No.", x.buyer_order_no || '')}${grid('Dispatch Doc No.', x.dispatch_doc_no || '')}
      ${grid('Dispatched through', x.dispatched_through || '')}${grid('Destination', x.destination || '')}
      ${grid('Terms of Delivery', x.terms_of_delivery || '', true)}
      ${invoice.irn ? grid('IRN', invoice.irn, true) : ''}${invoice.eway_bill_no ? grid('E-way bill no.', invoice.eway_bill_no, true) : ''}
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1px solid var(--acc)">
    <thead><tr style="text-align:center">
      <th style="${cell}">Sl</th><th style="${cell}">Description of Goods</th>${sh.hsn ? `<th style="${cell}">HSN/SAC</th>` : ''}<th style="${cell}">Quantity</th>
      ${sh.rate_incl_tax ? `<th style="${cell}">Rate<br/><span style="font-size:9px;font-weight:normal">(Incl. of Tax)</span></th>` : ''}<th style="${cell}">Rate<br/><span style="font-size:9px;font-weight:normal">(per)</span></th>
      ${sh.disc_pct ? `<th style="${cell}">Disc. %</th>` : ''}<th style="${cell}">Amount</th>
    </tr></thead>
    <tbody>
      ${lines.map((l, n) => `<tr style="vertical-align:top">
        <td style="${open};text-align:center">${n + 1}</td><td style="${open};font-weight:600">${esc(l.description)}</td>${sh.hsn ? `<td style="${open};text-align:center">${esc(l.hsn)}</td>` : ''}
        <td style="${open};text-align:right;font-weight:600">${qtyText(l.quantity)}${unitOf(l)}</td>${sh.rate_incl_tax ? `<td style="${open};text-align:right">${money(l.gross)}</td>` : ''}
        <td style="${open};text-align:right">${money(l.unit_price)}${unitOf(l)}</td>${sh.disc_pct ? `<td style="${open};text-align:right">${l.discPct > 0 ? money(l.discPct) : ''}</td>` : ''}
        <td style="${open};text-align:right;font-weight:600">${money(l.taxable)}</td></tr>`).join('')}
      <tr><td style="${open};height:36px" colspan="${cols}"></td></tr>
      ${taxRows.map(([name, v]) => `<tr><td style="${open}" colspan="${cols - 1}"><span style="float:right;font-weight:bold;font-style:italic">${name}</span></td><td style="${open};text-align:right;font-weight:600">${money(v)}</td></tr>`).join('')}
      <tr style="font-weight:bold"><td style="${cell}" colspan="${labelSpan}">Total</td><td style="${cell};text-align:right">${sh.total_qty ? qtyText(totalQty) : ''}</td><td style="${cell}" colspan="${cols - labelSpan - 2}"></td><td style="${cell};text-align:right">₹ ${money(invoice.total)}</td></tr>
    </tbody>
  </table>
  ${sh.amount_in_words || sh.eoe ? `<div style="display:flex;justify-content:space-between;border:1px solid var(--acc);border-top:0;padding:5px"><div>${sh.amount_in_words ? `<p style="font-size:10px">Amount Chargeable (in words)</p><p style="font-weight:bold">${esc(inWords(invoice.total))}</p>` : ''}</div>${sh.eoe ? '<p style="font-style:italic">E. &amp; O.E</p>' : ''}</div>` : ''}
  ${sh.tax_summary ? `<table style="width:100%;border-collapse:collapse;border:1px solid var(--acc);border-top:0">
    <thead><tr style="text-align:center"><th style="${cell}" rowspan="2">HSN/SAC</th><th style="${cell}" rowspan="2">Taxable Value</th>${igst ? `<th style="${cell}" colspan="2">IGST</th>` : `<th style="${cell}" colspan="2">CGST</th><th style="${cell}" colspan="2">SGST/UTGST</th>`}<th style="${cell}" rowspan="2">Total Tax Amount</th></tr>
    <tr style="text-align:center">${(igst ? [0] : [0, 1]).map(() => `<th style="${cell}">Rate</th><th style="${cell}">Amount</th>`).join('')}</tr></thead>
    <tbody>${rows.map((g) => `<tr style="text-align:right"><td style="${cell};text-align:left">${esc(g.hsn)}</td><td style="${cell}">${money(g.taxable)}</td>${igst ? `<td style="${cell}">${g.rate}%</td><td style="${cell}">${money(g.tax)}</td>` : `<td style="${cell}">${g.rate / 2}%</td><td style="${cell}">${money(g.tax / 2)}</td><td style="${cell}">${g.rate / 2}%</td><td style="${cell}">${money(g.tax / 2)}</td>`}<td style="${cell}">${money(g.tax)}</td></tr>`).join('')}
    <tr style="text-align:right;font-weight:bold"><td style="${cell};text-align:left">Total</td><td style="${cell}">${money(taxableTotal)}</td>${igst ? `<td style="${cell}"></td><td style="${cell}">${money(invoice.igst)}</td>` : `<td style="${cell}"></td><td style="${cell}">${money(invoice.cgst)}</td><td style="${cell}"></td><td style="${cell}">${money(invoice.sgst)}</td>`}<td style="${cell}">${money(invoice.tax)}</td></tr></tbody></table>
  <p style="border:1px solid var(--acc);border-top:0;padding:5px">Tax Amount (in words): <b>${esc(inWords(invoice.tax))}</b></p>` : ''}
  <div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--acc);border-top:0">
    <div style="border-right:1px solid var(--acc);padding:5px">
      ${sh.pan && d.pan ? `<p style="margin-bottom:4px">Company's PAN : <b>${esc(d.pan)}</b></p>` : ''}
      <p style="font-weight:600;text-decoration:underline">Declaration</p>${cfg.declaration ? `<p>${esc(cfg.declaration)}</p>` : ''}
      ${sh.terms && d.terms ? `<p style="margin-top:4px;font-weight:600;text-decoration:underline">Terms &amp; Conditions</p><p>${nl2br(d.terms)}</p>` : ''}
      ${invoice.notes ? `<p style="margin-top:4px">${nl2br(invoice.notes)}</p>` : ''}
    </div>
    <div style="padding:5px;min-height:90px;display:flex;flex-direction:column;justify-content:space-between">
      ${sh.bank && (d.bank_name || d.bank_account) ? `<div><p style="font-weight:600;text-decoration:underline">Company's Bank Details</p>${d.bank_name ? `<p>Bank Name : <b>${esc(d.bank_name)}</b></p>` : ''}${d.bank_account ? `<p>A/c No. : <b>${esc(d.bank_account)}</b></p>` : ''}${d.bank_ifsc || d.bank_branch ? `<p>Branch &amp; IFS Code : <b>${esc([d.bank_branch, d.bank_ifsc].filter(Boolean).join(' & '))}</b></p>` : ''}</div>` : '<div></div>'}
      ${sh.signature ? `<div style="margin-top:12px;text-align:right"><p>for <b>${esc(business.name)}</b></p><p style="margin-top:24px">${esc(cfg.signature_text)}</p></div>` : '<div></div>'}
    </div>
  </div>
  ${sh.received_by ? '<div style="display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--acc);border-top:0;padding-top:32px"><p style="padding:0 5px 5px">Received by:</p><p style="padding:0 5px 5px">Delivered by:</p></div>' : ''}
  ${cfg.footer_note ? `<p style="text-align:center;font-size:10px;margin-top:4px">${esc(cfg.footer_note)}</p>` : ''}
</article>`;

  const copies = cfg.copies.length ? COPY_LABELS.filter((c) => cfg.copies.includes(c)) : [null];
  const html = `<html><head><meta name="viewport" content="width=${width}, initial-scale=1"/><style>@page { margin: 8mm } body { margin: 0; font-family: Arial, Helvetica, sans-serif } p { margin: 0 }</style></head><body>${copies.map((label, i) => sheet(label, i === copies.length - 1)).join('')}</body></html>`;
  return { html, width };
};
