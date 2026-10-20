/*
 * The bill laid out as a Tally-style GST tax invoice (A4), for hardware, automobile and other trade businesses that bill other businesses:
 * seller, consignee (ship to) and buyer boxes, the invoice / delivery / dispatch grid, an item table with HSN/SAC, the tax lines, the total in
 * words and a tax summary per HSN. The details that change from sale to sale (consignee, delivery note, dispatch, payment terms, the buyer's
 * address as it should print) are edited with "Edit invoice details" and kept on the invoice (PATCH /invoices/:id/print-details), so a
 * reprint matches. PAN, bank and terms come from Business settings. The words are the statutory ones and stay in English on purpose.
 */
import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { Alert, Button, Field, Input, Modal, Textarea } from '../../components/ui.jsx';
import { PAPER_WIDTH, TEXT_PX, withDefaults } from '../../lib/invoicePrint.js';
import { useT } from '../../i18n/useT.js';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => [n >= 100 && `${ONES[Math.floor(n / 100)]} Hundred`, n % 100 && below100(n % 100)].filter(Boolean).join(' ');
/** Indian grouping: crore, lakh, thousand. */
export const wholeInWords = (n) => {
  if (n === 0) return 'Zero';
  const parts = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']].map(([v, name]) => { const q = Math.floor(n / v); n %= v; return q ? `${below1000(q)} ${name}` : ''; });
  return [...parts, below1000(n)].filter(Boolean).join(' ');
};
/** 13900 → "Thirteen Thousand Nine Hundred INR Only"; 2120.34 → "Two Thousand One Hundred Twenty INR and Thirty Four paise Only". */
export const inWords = (amount) => {
  const paise = Math.round(Math.abs(amount) * 100); const r = Math.floor(paise / 100); const p = paise % 100;
  return `${wholeInWords(r)} INR${p ? ` and ${below100(p)} paise` : ''} Only`;
};

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const cell = 'border border-(color:--acc) px-1.5 py-1';
const box = 'border-b border-r border-(color:--acc) p-1.5';

export const FIELDS = [
  ['consignee_name', 'Consignee (ship to) name'], ['consignee_address', 'Consignee address', 'area'], ['consignee_state', 'Consignee state'],
  ['buyer_address', 'Buyer address', 'area'], ['buyer_state', 'Buyer state'], ['buyer_email', 'Buyer e-mail'],
  ['delivery_note', 'Delivery note'], ['reference_no', 'Reference no. & date'], ['other_references', 'Other references'],
  ['buyer_order_no', "Buyer's order no."], ['dispatch_doc_no', 'Dispatch doc no.'], ['dispatched_through', 'Dispatched through'],
  ['destination', 'Destination'], ['payment_terms', 'Mode/terms of payment'], ['terms_of_delivery', 'Terms of delivery']
];

/* What the counter fills in for this sale. Blank buyer fields fall back to the customer's record; a blank consignee means "same as the buyer". */
const EditDetails = ({ invoice, onSaved, onClose }) => {
  const tr = useT();
  const x = invoice.print_extra || {};
  const start = { ...Object.fromEntries(FIELDS.map(([k]) => [k, x[k] ?? ''])), buyer_address: x.buyer_address ?? invoice.customer_address ?? '', buyer_state: x.buyer_state ?? invoice.customer_state ?? '', buyer_email: x.buyer_email ?? invoice.customer_email ?? '' };
  const [v, setV] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(`/invoices/${invoice.invoice_id}/print-details`, { method: 'PATCH', body: v }); onSaved(); }
    catch (caught) { setError(caught.message); setBusy(false); }
  };
  return (
    <Modal title={tr('Invoice details')} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <Alert>{error}</Alert>
        <p className="text-small text-ink-500">{tr('Printed on this tax invoice only. Leave the consignee blank when it is the same as the buyer.')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([k, label, kind]) => (
            <Field key={k} id={`pd_${k}`} label={label}>
              {kind === 'area' ? <Textarea id={`pd_${k}`} rows={2} maxLength={300} value={v[k]} onChange={(e) => setV((o) => ({ ...o, [k]: e.target.value }))} />
                : <Input id={`pd_${k}`} maxLength={200} value={v[k]} onChange={(e) => setV((o) => ({ ...o, [k]: e.target.value }))} />}
            </Field>
          ))}
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save details')}</Button></div>
      </form>
    </Modal>
  );
};

/* `print` overrides the business's invoice print settings (the settings page previews unsaved choices this way). */
export default function TallyInvoice({ invoice, business, outlet, seller, onSaved, plain = false, print = null }) {
  const tr = useT();
  const cfg = withDefaults(print || invoice.invoice_print);
  const sh = cfg.show;
  const pageW = PAPER_WIDTH[cfg.paper] || 760;
  const copies = cfg.copies.length ? cfg.copies : [null];
  const [editing, setEditing] = useState(false);
  // the document is laid out at the paper's width (A4 760px, A5 540px); on a narrower column it is scaled down to fit (printing is always full size)
  const holder = useRef(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = holder.current; if (!el) return undefined;
    const fit = () => setZoom(Math.min(1, el.clientWidth / pageW));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [pageW]);
  const x = invoice.print_extra || {};
  const d = invoice.print_details || {};
  const igst = invoice.igst > 0;
  const lines = invoice.items.map((i) => ({ ...i, taxable: i.line_total - i.tax_amount - (i.cess || 0), gross: i.unit_price * (1 + i.tax_rate / 100), discPct: i.unit_price * i.quantity > 0 ? (i.discount / (i.unit_price * i.quantity)) * 100 : 0 }));
  // tax summary: one row per HSN (and rate), the tax split into CGST + SGST or all IGST the way the bill itself was
  const groups = new Map();
  for (const l of lines) {
    const k = `${l.hsn || ''}|${l.tax_rate}`;
    const g = groups.get(k) || { hsn: l.hsn || '', rate: l.tax_rate, taxable: 0, tax: 0 };
    g.taxable += l.taxable; g.tax += l.tax_amount; groups.set(k, g);
  }
  const rows = [...groups.values()];
  const totalQty = lines.reduce((s, l) => s + Number(l.quantity), 0);
  const taxable = rows.reduce((s, g) => s + g.taxable, 0);
  const place = (o) => [o?.address, o?.city].filter(Boolean).join(', ');
  const gstin = outlet?.gstin || seller?.gstin;
  const sellerHome = outlet?.address ? outlet : seller;
  const methods = [...new Set((invoice.payments || []).map((p) => p.method))].join(', ');
  const buyerAddress = x.buyer_address ?? invoice.customer_address;
  const buyerState = x.buyer_state ?? invoice.customer_state;
  const buyerEmail = x.buyer_email ?? invoice.customer_email;
  const hasConsignee = Boolean(x.consignee_name || x.consignee_address || x.consignee_state);
  const stateLine = (name, code) => (name ? <p>State Name : {name}{code ? `, Code : ${code}` : ''}</p> : null);
  const date = new Date(`${String(invoice.invoice_date).slice(0, 10)}T00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-');
  const cols = 5 + (sh.hsn ? 1 : 0) + (sh.rate_incl_tax ? 1 : 0) + (sh.disc_pct ? 1 : 0);   // Sl, description, quantity, rate (per), amount, and the optional three
  const labelSpan = sh.hsn ? 3 : 2;
  const unitOf = (l) => (sh.unit ? ` ${l.unit || 'nos'}` : '');
  const gridCell = (label, value, extra = '') => <div className={`${box} ${extra}`}><p className="text-[10px]">{label}</p><p className="font-bold">{value}</p></div>;

  return (
    <div className="min-w-0">
      <div className={`mb-2 flex justify-end print:hidden${plain ? ' hidden' : ''}`}><Button variant="secondary" onClick={() => setEditing(true)}><Pencil aria-hidden="true" className="h-4 w-4" />{tr('Edit invoice details')}</Button></div>
      {editing && <EditDetails invoice={invoice} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved?.(); }} />}
      <div ref={holder} className="min-w-0 print:overflow-visible">
        <style>{`@media print { @page { size: ${cfg.paper} portrait; margin: 8mm } }`}</style>
        {copies.map((label, ci) => (
        <article key={label || 'single'} style={{ '--z': zoom, '--acc': cfg.accent, width: pageW, fontSize: TEXT_PX[cfg.text_size] || 12 }}
                 className={`light-sheet mx-auto bg-white p-4 leading-snug text-ink-900 [zoom:var(--z)] print:!w-full print:p-0 print:[zoom:1] ${ci < copies.length - 1 ? 'mb-6 print:mb-0 print:break-after-page' : ''} ${ci > 0 ? 'hidden print:block' : ''}`}>
          {label && <p className="text-right text-[10px] font-semibold uppercase tracking-wide">{label}</p>}
          <p className="mb-1 text-center text-[1.25em] font-bold text-(--acc)">{invoice.tax > 0 && !invoice.bill_of_supply ? 'Tax Invoice' : 'Bill of Supply'}</p>
          {invoice.reverse_charge && <p className="mb-1 text-center text-[0.85em] font-semibold">Tax is payable on reverse charge</p>}
          <div className="grid grid-cols-2 border border-b-0 border-r-0 border-(color:--acc)">
            <div className="border-b border-r border-(color:--acc) p-1.5">
              {sh.logo && business?.receipt_settings?.logo_url ? <img src={business.receipt_settings.logo_url} alt="" className="mb-1 max-h-12 max-w-[8rem] object-contain" /> : null}
              <p className="font-bold">{business?.name}</p>
              {place(sellerHome) && <p>{place(sellerHome)}</p>}
              {(outlet?.phone || seller?.phone) && <p>Phone: {outlet?.phone || seller.phone}</p>}
              {gstin && <p>GSTIN/UIN: {gstin}</p>}
              {stateLine(seller?.state, seller?.state_code)}
              {sh.email && business?.email && <p>E-Mail : {business.email}</p>}
              <div className="mt-1.5 border-t border-(color:--acc) pt-1">
                <p className="text-[10px]">Consignee (Ship to)</p>
                <p className="font-bold">{hasConsignee ? x.consignee_name : (invoice.customer_name || 'Walk-in customer')}</p>
                {hasConsignee ? <>{x.consignee_address && <p className="whitespace-pre-line">{x.consignee_address}</p>}{stateLine(x.consignee_state, invoice.consignee_state_code)}</> : <p>Same as buyer</p>}
              </div>
              <div className="mt-1.5 border-t border-(color:--acc) pt-1">
                <p className="text-[10px]">Buyer (Bill to)</p>
                <p className="font-bold">{invoice.customer_name || 'Walk-in customer'}</p>
                {buyerAddress && <p className="whitespace-pre-line">{buyerAddress}</p>}
                {invoice.customer_phone && <p>Phone: {invoice.customer_phone}</p>}
                {invoice.customer_gstin && <p>GSTIN/UIN: {invoice.customer_gstin}</p>}
                {stateLine(buyerState, invoice.customer_state_code)}
                {buyerEmail && <p>E-Mail : {buyerEmail}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 content-start">
              {gridCell('Invoice No.', invoice.invoice_number)}
              {gridCell('Dated', date)}
              {gridCell('Delivery Note', x.delivery_note || '')}
              {gridCell('Mode/Terms of Payment', x.payment_terms || methods || (invoice.balance_due > 0 ? 'Credit' : ''))}
              {gridCell('Reference No. & Date', x.reference_no || '')}
              {gridCell('Other References', x.other_references || '')}
              {gridCell("Buyer's Order No.", x.buyer_order_no || '')}
              {gridCell('Dispatch Doc No.', x.dispatch_doc_no || '')}
              {gridCell('Dispatched through', x.dispatched_through || '')}
              {gridCell('Destination', x.destination || '')}
              {gridCell('Terms of Delivery', x.terms_of_delivery || '', 'col-span-2')}
              {invoice.irn && gridCell('IRN', invoice.irn, 'col-span-2 break-all')}
              {invoice.eway_bill_no && gridCell('E-way bill no.', invoice.eway_bill_no, 'col-span-2')}
            </div>
          </div>

          <table className="w-full border-collapse border border-(color:--acc)">
            <thead>
              <tr className="text-center">
                <th className={`${cell} font-semibold`}>Sl</th><th className={`${cell} font-semibold`}>Description of Goods</th>{sh.hsn && <th className={`${cell} font-semibold`}>HSN/SAC</th>}
                <th className={`${cell} font-semibold`}>Quantity</th>
                {sh.rate_incl_tax && <th className={`${cell} font-semibold`}>Rate<br /><span className="text-[9px] font-normal">(Incl. of Tax)</span></th>}
                <th className={`${cell} font-semibold`}>Rate<br /><span className="text-[9px] font-normal">(per)</span></th>
                {sh.disc_pct && <th className={`${cell} font-semibold`}>Disc. %</th>}<th className={`${cell} font-semibold`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, n) => (
                <tr key={l.item_id} className="align-top">
                  <td className={`${cell} border-y-0 text-center`}>{n + 1}</td>
                  <td className={`${cell} border-y-0 font-semibold`}>{l.description}</td>
                  {sh.hsn && <td className={`${cell} border-y-0 text-center`}>{l.hsn}</td>}
                  <td className={`${cell} border-y-0 text-right font-semibold`}>{qtyText(l.quantity)}{unitOf(l)}</td>
                  {sh.rate_incl_tax && <td className={`${cell} border-y-0 text-right`}>{money(l.gross)}</td>}
                  <td className={`${cell} border-y-0 text-right`}>{money(l.unit_price)}{unitOf(l)}</td>
                  {sh.disc_pct && <td className={`${cell} border-y-0 text-right`}>{l.discPct > 0 ? money(l.discPct) : ''}</td>}
                  <td className={`${cell} border-y-0 text-right font-semibold`}>{money(l.taxable)}</td>
                </tr>
              ))}
              <tr><td className={`${cell} h-10 border-y-0`} colSpan={cols} /></tr>
              {[igst ? ['IGST', invoice.igst] : null, !igst && invoice.cgst > 0 ? ['CGST', invoice.cgst] : null, !igst && invoice.sgst > 0 ? ['SGST/UTGST', invoice.sgst] : null, invoice.cess > 0 ? ['Cess', invoice.cess] : null, invoice.tcs > 0 ? ['TCS', invoice.tcs] : null, invoice.round_off ? ['Round Off', invoice.round_off] : null]
                .filter(Boolean).map(([name, v]) => (
                  <tr key={name}><td className={`${cell} border-y-0`} colSpan={cols - 1}><span className="float-right font-bold italic">{name}</span></td><td className={`${cell} border-y-0 text-right font-semibold`}>{money(v)}</td></tr>
                ))}
              <tr className="font-bold">
                <td className={cell} colSpan={labelSpan}>Total</td>
                <td className={`${cell} text-right`}>{sh.total_qty ? qtyText(totalQty) : ''}</td>
                <td className={cell} colSpan={cols - labelSpan - 2} />
                <td className={`${cell} text-right`}>{formatCurrency(invoice.total)}</td>
              </tr>
            </tbody>
          </table>
          {(sh.amount_in_words || sh.eoe) && (
            <div className="flex justify-between border border-t-0 border-(color:--acc) p-1.5">
              <div>{sh.amount_in_words && <><p className="text-[10px]">Amount Chargeable (in words)</p><p className="font-bold">{inWords(invoice.total)}</p></>}</div>
              {sh.eoe && <p className="italic">E. &amp; O.E</p>}
            </div>
          )}

          {sh.tax_summary && <>
          <table className="w-full border-collapse border border-t-0 border-(color:--acc)">
            <thead>
              <tr className="text-center">
                <th className={cell} rowSpan={2}>HSN/SAC</th><th className={cell} rowSpan={2}>Taxable Value</th>
                {igst ? <th className={cell} colSpan={2}>IGST</th> : <><th className={cell} colSpan={2}>CGST</th><th className={cell} colSpan={2}>SGST/UTGST</th></>}
                <th className={cell} rowSpan={2}>Total Tax Amount</th>
              </tr>
              <tr className="text-center">{(igst ? [0] : [0, 1]).flatMap((k) => [<th key={`r${k}`} className={cell}>Rate</th>, <th key={`a${k}`} className={cell}>Amount</th>])}</tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={`${g.hsn}|${g.rate}`} className="text-right">
                  <td className={`${cell} text-left`}>{g.hsn}</td><td className={cell}>{money(g.taxable)}</td>
                  {igst ? <><td className={cell}>{g.rate}%</td><td className={cell}>{money(g.tax)}</td></> : <><td className={cell}>{g.rate / 2}%</td><td className={cell}>{money(g.tax / 2)}</td><td className={cell}>{g.rate / 2}%</td><td className={cell}>{money(g.tax / 2)}</td></>}
                  <td className={cell}>{money(g.tax)}</td>
                </tr>
              ))}
              <tr className="text-right font-bold">
                <td className={`${cell} text-left`}>Total</td><td className={cell}>{money(taxable)}</td>
                {igst ? <><td className={cell} /><td className={cell}>{money(invoice.igst)}</td></> : <><td className={cell} /><td className={cell}>{money(invoice.cgst)}</td><td className={cell} /><td className={cell}>{money(invoice.sgst)}</td></>}
                <td className={cell}>{money(invoice.tax)}</td>
              </tr>
            </tbody>
          </table>
          <p className="border border-t-0 border-(color:--acc) p-1.5">Tax Amount (in words): <span className="font-bold">{inWords(invoice.tax)}</span></p>
          </>}

          <div className="grid grid-cols-2 border border-t-0 border-(color:--acc)">
            <div className="border-r border-(color:--acc) p-1.5">
              {sh.pan && d.pan && <p className="mb-1">Company's PAN : <span className="font-bold">{d.pan}</span></p>}
              <p className="font-semibold underline">Declaration</p>
              {cfg.declaration && <p>{cfg.declaration}</p>}
              {sh.terms && d.terms && <><p className="mt-1 font-semibold underline">Terms &amp; Conditions</p><p className="whitespace-pre-line">{d.terms}</p></>}
              {invoice.notes && <p className="mt-1 whitespace-pre-line">{invoice.notes}</p>}
            </div>
            <div className="flex min-h-24 flex-col justify-between p-1.5">
              {sh.bank && (d.bank_name || d.bank_account) ? <div><p className="font-semibold underline">Company's Bank Details</p>{d.bank_name && <p>Bank Name : <span className="font-bold">{d.bank_name}</span></p>}{d.bank_account && <p>A/c No. : <span className="font-bold">{d.bank_account}</span></p>}{(d.bank_ifsc || d.bank_branch) && <p>Branch &amp; IFS Code : <span className="font-bold">{[d.bank_branch, d.bank_ifsc].filter(Boolean).join(' & ')}</span></p>}</div> : <div />}
              {sh.signature ? <div className="mt-3 text-right"><p>for <span className="font-bold">{business?.name}</span></p><p className="mt-6">{cfg.signature_text}</p></div> : <div />}
            </div>
          </div>
          {sh.received_by && <div className="grid grid-cols-2 border border-t-0 border-(color:--acc) pt-8"><p className="px-1.5 pb-1.5">Received by:</p><p className="px-1.5 pb-1.5">Delivered by:</p></div>}
          {cfg.footer_note && <p className="mt-1 text-center text-[10px]">{cfg.footer_note}</p>}
        </article>
        ))}
      </div>
    </div>
  );
}
