/*
 * Print views for a customer receipt and for kitchen order tickets (KOTs).
 *
 * These are ordinary pages: the browser prints them. Everything outside the
 * paper (the app's own menu and header) is already hidden when printing, and
 * @page sets the roll width, so a thermal printer, a receipt printer set up as
 * an ordinary printer, or "Save as PDF" all work with no hardware driver in
 * FlowXP. Opened with ?auto=1 the page prints itself once its data has loaded.
 */
import { useEffect, useState } from 'react';
import { stateTaxName } from '../lib/gstNames.js';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Button, humanize } from '../components/ui.jsx';
import { wholeInWords } from './billing/TallyInvoice.jsx';

/* 2120.34 becomes "Two Thousand One Hundred Twenty Rupees and Thirty Four Paise Only" (the thermal printer's wording) */
const rupeesInWords = (amount) => { const paise = Math.round(Math.abs(Number(amount) || 0) * 100); const p = paise % 100; return `${wholeInWords(Math.floor(paise / 100))} Rupees${p ? ` and ${wholeInWords(p)} Paise` : ''} Only`; };

const PAPER = { 58: 'w-[58mm]', 80: 'w-[80mm]' };

/* The one stylesheet both views share. */
const PrintStyles = ({ width }) => (
  <style>{`
    @page { size: ${width}mm auto; margin: 3mm; }
    @media print {
      html, body { background: #fff !important; }
      main { padding: 0 !important; background: #fff !important; }
      .no-print { display: none !important; }
      .paper { box-shadow: none !important; border: 0 !important; margin: 0 !important; width: 100% !important; padding: 0 !important; }
      .slip { break-after: page; page-break-after: always; }
      .slip:last-child { break-after: auto; page-break-after: auto; }
    }
  `}</style>
);

const usePrintOnLoad = (ready) => {
  const [params] = useSearchParams();
  useEffect(() => {
    if (ready && params.get('auto') === '1') { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t); }
    return undefined;
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
};

const Toolbar = ({ back, width, setWidth, children }) => (
  <div className="no-print mb-5 flex flex-wrap items-center gap-2">
    <Link to={back} className="text-sm font-semibold text-brand-600">← Back</Link>
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {children}
      <label className="flex items-center gap-1.5 text-sm text-ink-700">Paper
        <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm">
          <option value={80}>80 mm</option><option value={58}>58 mm</option>
        </select>
      </label>
      <Button onClick={() => window.print()}>Print</Button>
    </div>
  </div>
);

/* name takes the rest; Qty, Rate and Amount are fixed-width columns */
const ROWS = 'grid-cols-[1fr_auto_auto_auto] gap-x-2';
const Rule = () => <div className="my-2 border-t border-dashed border-ink-400" />;
const Row = ({ left, right, bold }) => <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}><span>{left}</span><span className="shrink-0">{right}</span></div>;
const stamp = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ── receipt ─────────────────────────────────────────────────────────────── */

export const ReceiptPage = () => {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(null);
  const [qr, setQr] = useState('');
  const [salon, setSalon] = useState(null);

  useEffect(() => {
    Promise.all([api(`/invoices/${id}`), api('/businesses/current')])
      .then(([i, b]) => {
        setInvoice(i); setBiz(b); setWidth((w) => w ?? b.receipt_settings.paper_width);
        // a salon's receipt also says who did each service and shows any gift card sold
        if (b.business_type === 'SALON') api(`/salon/invoices/${id}/lines`).then(setSalon).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const s = biz?.receipt_settings;
  const unpaid = invoice && invoice.status === 'ISSUED' && invoice.balance_due > 0;
  // ?upi=<rupees> is a UPI payment being taken now: the QR is for exactly that (never more than is owed), even if the receipt setting for the balance QR is off
  const asked = Number(new URLSearchParams(window.location.search).get('upi')) || null;
  const upiAmount = asked && unpaid ? Math.min(asked, invoice.balance_due) : null;
  const upi = biz?.upi_vpa && unpaid && (upiAmount || s?.show_upi_qr)
    ? `upi://pay?pa=${encodeURIComponent(biz.upi_vpa)}&pn=${encodeURIComponent(biz.name)}&am=${(upiAmount ?? invoice.balance_due).toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.invoice_number)}` : null;
  useEffect(() => { if (upi) QRCode.toDataURL(upi, { width: 160, margin: 1 }).then(setQr); else setQr(''); }, [upi]);
  usePrintOnLoad(Boolean(invoice && biz && (!upi || qr)));

  if (error) return <Alert>{error}</Alert>;
  if (!invoice || !biz) return <p className="text-sm text-ink-400">Preparing the receipt…</p>;

  const outlet = invoice.outlet;
  const gstin = (outlet?.gstin || biz.gstin);
  const address = [outlet?.address || biz.address, outlet?.city || biz.city].filter(Boolean).join(', ');
  const taxRows = [['CGST', invoice.cgst], [invoice.tax_name || stateTaxName(outlet?.state || biz.state), invoice.sgst], ['IGST', invoice.igst]].filter(([, v]) => v > 0);
  const handDiscount = invoice.discount - invoice.coupon_discount;
  const showTax = s.show_tax_lines !== false;
  const totalQty = invoice.items.reduce((n, i) => n + i.quantity, 0);
  const saved = invoice.items.reduce((n, i) => n + (i.discount || 0), 0) + invoice.discount;

  return (
    <div>
      <PrintStyles width={width} />
      <Toolbar back={`/app/billing/invoices/${id}`} width={width} setWidth={setWidth} />
      <div className={`paper mx-auto rounded-lg border border-line bg-white p-3 font-mono text-[11px] leading-snug text-black shadow-sm ${PAPER[width]}`}>
        <div className="text-center">
          {s.show_logo !== false && s.logo_url && <img src={s.logo_url} alt={biz.name} className="mx-auto mb-1 max-h-16 max-w-[70%] object-contain grayscale contrast-150" />}
          <p className="text-sm font-bold uppercase">{biz.name}</p>
          {outlet && <p className="font-semibold">{outlet.name}</p>}
          {address && <p>{address}</p>}
          {s.header_text && <p>{s.header_text}</p>}
          {s.show_phone !== false && (outlet?.phone || biz.phone) && <p>Ph: {outlet?.phone || biz.phone}</p>}
          {s.show_gstin && biz.gst_enabled && gstin && <p>GSTIN: {gstin}</p>}
        </div>
        <Rule />
        <Row left={`Bill ${invoice.invoice_number}`} right={invoice.invoice_date} />
        <Row left={invoice.created_at ? stamp(invoice.created_at) : ''} right={invoice.table_name ? `Table ${invoice.table_name}` : ''} />
        {invoice.platform_order_number && <Row left={`${humanize(invoice.platform)} order`} right={invoice.platform_order_number} />}
        {invoice.cashier && <p>Served by {invoice.cashier}</p>}
        {invoice.customer_name && <p>Guest: {invoice.customer_name}{invoice.customer_phone ? ` (${invoice.customer_phone})` : ''}</p>}
        {invoice.status === 'CANCELLED' && <p className="mt-1 text-center text-sm font-bold">*** CANCELLED ***</p>}
        <Rule />
        {/* Item / Qty / Rate / Amount, the same table as the thermal printer's receipt */}
        <div className={`grid ${ROWS} font-bold`}><span>Item</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
        <Rule />
        {invoice.items.map((i) => (
          <div key={i.item_id} className={`mt-1 grid ${ROWS}`}>
            <span className="break-words">{i.description}
              {salon?.lines.find((l) => l.item_id === i.item_id)?.staff_name && <span className="block text-[0.9em]">{`by ${salon.lines.find((l) => l.item_id === i.item_id).staff_name}`}</span>}
              {s.show_hsn === true && i.hsn && <span className="block text-[0.9em]">HSN {i.hsn}</span>}
              {i.discount > 0 && <span className="block text-[0.9em]">Discount -{i.discount.toFixed(2)}</span>}</span>
            <span className="text-right">{i.quantity}{i.unit && i.unit.length <= 3 ? ` ${i.unit}` : ''}</span>
            <span className="text-right">{i.unit_price.toFixed(2)}</span>
            <span className="text-right">{(showTax ? i.line_total - (i.tax_amount || 0) - (i.cess || 0) : i.line_total).toFixed(2)}</span>
          </div>
        ))}
        <Rule />
        <Row left={`Items: ${invoice.items.length}`} right={s.show_total_qty === false ? '' : `Total Qty: ${totalQty}`} />
        {salon?.gift_cards.map((g) => <p key={g.code} className="mt-1 font-bold">Gift card {g.code} · {g.amount.toFixed(2)}</p>)}
        <Rule />
        {s.show_tax_lines !== false && <><Row left="Subtotal" right={invoice.subtotal.toFixed(2)} />
          {taxRows.map(([label, v]) => <Row key={label} left={label} right={v.toFixed(2)} />)}</>}
        {handDiscount > 0 && <Row left="Discount" right={`-${handDiscount.toFixed(2)}`} />}
        {invoice.coupon_discount > 0 && <Row left={`Coupon ${invoice.coupon_code}`} right={`-${invoice.coupon_discount.toFixed(2)}`} />}
        {invoice.loyalty_discount > 0 && <Row left="Loyalty reward" right={`-${invoice.loyalty_discount.toFixed(2)}`} />}
        {invoice.points_discount > 0 && <Row left={`Points used (${invoice.points_redeemed})`} right={`-${invoice.points_discount.toFixed(2)}`} />}
        {invoice.round_off !== 0 && <Row left="Round off" right={`${invoice.round_off > 0 ? '+' : '-'}${Math.abs(invoice.round_off).toFixed(2)}`} />}
        <Rule />
        <div className="text-sm"><Row left="TOTAL" right={formatCurrency(invoice.total)} bold /></div>
        {s.show_amount_words === true && <p className="mt-1">{rupeesInWords(invoice.total)}</p>}
        {saved > 0 && <p className="mt-1">You saved Rs {saved.toFixed(2)}</p>}
        {invoice.payments.map((p) => <Row key={p.payment_id} left={`Paid (${humanize(p.method)})`} right={p.amount.toFixed(2)} />)}
        {invoice.refunded > 0 && <Row left="Refunded" right={`-${invoice.refunded.toFixed(2)}`} />}
        {unpaid && <Row left="BALANCE DUE" right={invoice.balance_due.toFixed(2)} bold />}
        {qr && (
          <div className="mt-2 text-center"><img src={qr} alt="UPI payment QR" className="mx-auto h-28 w-28" /><p>{upiAmount ? `Scan to pay ₹${upiAmount.toFixed(2)} by UPI` : 'Scan to pay the balance'}</p></div>
        )}
        {s.show_loyalty && invoice.loyalty_message && <><Rule /><p className="text-center">★ {invoice.loyalty_message}</p></>}
        {s.show_terms === true && s.terms && <><Rule /><p className="whitespace-pre-line">Terms: {s.terms}</p></>}
        {s.footer && <><Rule /><p className="whitespace-pre-line text-center">{s.footer}</p></>}
      </div>
    </div>
  );
};

/* ── kitchen order ticket ────────────────────────────────────────────────── */

export const KotPage = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [kot, setKot] = useState(null);
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(null);
  const [only, setOnly] = useState(params.get('station') ?? 'all');

  useEffect(() => {
    Promise.all([api(`/kitchen/kots/${id}`), api('/businesses/current')])
      .then(([k, b]) => { setKot(k); setBiz(b); setWidth((w) => w ?? b.receipt_settings.paper_width); })
      .catch((e) => setError(e.message));
  }, [id]);
  usePrintOnLoad(Boolean(kot));

  if (error) return <Alert>{error}</Alert>;
  if (!kot) return <p className="text-sm text-ink-400">Preparing the ticket…</p>;

  const slips = kot.stations.filter((s) => only === 'all' || String(s.station_id ?? 'none') === only);
  const where = kot.order_type === 'DINE_IN' ? (kot.table_name ? `TABLE ${kot.table_name}` : 'DINE-IN') : kot.platform ? `${kot.platform} DELIVERY` : kot.order_type;

  return (
    <div>
      <PrintStyles width={width} />
      <Toolbar back="/app/orders" width={width} setWidth={setWidth}>
        {kot.stations.length > 1 && (
          <label className="flex items-center gap-1.5 text-sm text-ink-700">Print
            <select value={only} onChange={(e) => setOnly(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm">
              <option value="all">All {kot.stations.length} slips</option>
              {kot.stations.map((s) => <option key={s.station_id ?? 'none'} value={String(s.station_id ?? 'none')}>{s.name} only</option>)}
            </select>
          </label>
        )}
      </Toolbar>
      <div className="space-y-4 print:space-y-0">
        {slips.map((slip) => (
          <div key={slip.station_id ?? 'none'} className={`paper slip mx-auto rounded-lg border border-line bg-white p-3 font-mono text-black shadow-sm ${PAPER[width]}`}>
            {kot.priority === 'RUSH' && <p className="mb-1 bg-black py-0.5 text-center text-sm font-bold tracking-widest text-white">*** RUSH ***</p>}
            <div className="flex items-baseline justify-between"><p className="text-base font-bold">{kot.kot_number}</p><p className="text-[11px]">{stamp(kot.created_at)}</p></div>
            <p className="text-xl font-extrabold leading-tight">{where}</p>
            <p className="text-[11px]">{kot.order_number}{kot.platform_order_number ? ` · ${kot.platform} ${kot.platform_order_number}` : ''}{kot.outlet ? ` · ${kot.outlet}` : ''}</p>
            {kot.customer && <p className="text-[11px]">{kot.customer}</p>}
            <p className="mt-1 border-y border-black py-0.5 text-center text-sm font-bold uppercase tracking-wide">{slip.name}</p>
            <ul className="mt-2 space-y-2">
              {slip.items.map((i, n) => (
                <li key={n}>
                  <p className="text-base font-bold leading-tight">{i.quantity} × {i.description}</p>
                  {i.combo?.length > 0 && <p className="pl-4 text-[12px]">{i.combo.join(', ')}</p>}
                  {i.modifiers.length > 0 && <p className="pl-4 text-[12px]">+ {i.modifiers.join(', ')}</p>}
                  {i.kitchen_notes && <p className="ml-4 mt-0.5 inline-block border border-black px-1 text-[12px] font-bold">NOTE: {i.kitchen_notes}</p>}
                </li>
              ))}
            </ul>
            {kot.order_notes && <p className="mt-2 border-t border-dashed border-black pt-1 text-[11px]">Order note: {kot.order_notes}</p>}
          </div>
        ))}
        {slips.length === 0 && <p className="text-sm text-ink-400">Nothing to print: every line on this ticket was cancelled.</p>}
      </div>
      <p className="no-print mt-4 text-center text-xs text-ink-400">{biz?.name}. One slip is printed per station, so each station gets only its own items.</p>
    </div>
  );
};

/* ── running bill of an open order (before it is paid) ───────────────────── */

export const RunningBillPage = () => {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(null);

  useEffect(() => {
    Promise.all([api(`/orders/${id}`), api('/businesses/current')])
      .then(([o, b]) => { setOrder(o); setBiz(b); setWidth((w) => w ?? b.receipt_settings.paper_width); })
      .catch((e) => setError(e.message));
  }, [id]);
  usePrintOnLoad(Boolean(order));
  // printing it (or its preview being printed) marks the table "bill printed" on the floor
  useEffect(() => {
    const done = () => { api(`/orders/${id}/bill-printed`, { method: 'POST' }).catch(() => {}); };
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!order) return <p className="text-sm text-ink-400">Preparing the bill…</p>;

  const items = order.items.filter((i) => i.status !== 'CANCELLED' && !i.billed);
  const gstOn = Boolean(biz?.gst_enabled);
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const gst = gstOn ? items.reduce((s, i) => s + i.quantity * i.unit_price * (Number(i.tax_rate || 0) / 100), 0) : 0;
  const where = order.order_type === 'DINE_IN' ? (order.table_name ? `Table ${order.table_name}` : 'Dine-in') : order.order_type === 'DELIVERY' ? 'Delivery' : 'Takeaway';

  return (
    <div>
      <PrintStyles width={width} />
      <Toolbar back="/app/tables" width={width} setWidth={setWidth} />
      <div className={`paper mx-auto rounded-lg border border-line bg-white p-3 font-mono text-[12px] text-black shadow-sm ${PAPER[width]}`}>
        <p className="text-center text-base font-extrabold">{biz?.name}</p>
        {biz?.address && <p className="text-center text-[11px]">{[biz.address, biz.city].filter(Boolean).join(', ')}</p>}
        {biz?.phone && <p className="text-center text-[11px]">Ph: {biz.phone}</p>}
        {gstOn && biz?.gstin && biz.receipt_settings?.show_gstin !== false && <p className="text-center text-[11px]">GSTIN: {biz.gstin}</p>}
        <p className="mt-1 border-y border-black py-0.5 text-center text-sm font-bold">BILL (NOT YET PAID)</p>
        <Row left={`Order ${order.order_number}`} right={where} />
        <p className="text-[11px]">{stamp(order.created_at)}</p>
        {order.customer_name && <p className="text-[11px]">Guest: {order.customer_name}</p>}
        <Rule />
        <div className={`grid ${ROWS} font-bold`}><span>Item</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
        <Rule />
        {items.map((i) => (
          <div key={i.order_item_id} className={`grid ${ROWS}`}>
            <span className="min-w-0 break-words">{i.description}</span>
            <span className="text-right tabular-nums">{i.quantity}</span>
            <span className="text-right tabular-nums">{i.unit_price.toFixed(2)}</span>
            <span className="text-right tabular-nums">{(i.quantity * i.unit_price).toFixed(2)}</span>
          </div>
        ))}
        <Rule />
        {gstOn && gst > 0 && (<><Row left="Subtotal" right={subtotal.toFixed(2)} /><Row left="GST" right={gst.toFixed(2)} /></>)}
        <Row left="TOTAL" right={formatCurrency(Math.round(subtotal + gst))} bold />
        <p className="mt-2 text-center text-[11px]">Pay at the counter. Thank you!</p>
      </div>
    </div>
  );
};

/* ── credit note ─────────────────────────────────────────────────────────── */

export const CreditNotePage = () => {
  const { id } = useParams();
  const [note, setNote] = useState(null);
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(null);

  useEffect(() => {
    Promise.all([api(`/credit-notes/${id}`), api('/businesses/current')])
      .then(([n, b]) => { setNote(n); setBiz(b); setWidth((w) => w ?? b.receipt_settings.paper_width); })
      .catch((e) => setError(e.message));
  }, [id]);
  usePrintOnLoad(Boolean(note && biz));

  if (error) return <Alert>{error}</Alert>;
  if (!note || !biz) return <p className="text-sm text-ink-400">Preparing the credit note…</p>;
  const gstin = note.outlet?.gstin || biz.gstin;

  return (
    <div>
      <PrintStyles width={width} />
      <Toolbar back="/app/billing/credit-notes" width={width} setWidth={setWidth} />
      <div className={`paper mx-auto rounded-lg border border-line bg-white p-3 font-mono text-[11px] leading-snug text-black shadow-sm ${PAPER[width]}`}>
        <div className="text-center">
          <p className="text-sm font-bold uppercase">{biz.name}</p>
          {note.outlet && <p className="font-semibold">{note.outlet.name}</p>}
          {note.outlet?.address && <p>{note.outlet.address}</p>}
          {biz.gst_enabled && gstin && <p>GSTIN: {gstin}</p>}
          <p className="mt-1 text-sm font-bold">CREDIT NOTE</p>
        </div>
        <Rule />
        <Row left={note.cn_number} right={String(note.date).slice(0, 10)} />
        <p>Against invoice {note.invoice_number}{note.invoice_date ? ` of ${String(note.invoice_date).slice(0, 10)}` : ''}</p>
        {note.customer_name && <p>Customer: {note.customer_name}{note.customer_gstin ? ` (GSTIN ${note.customer_gstin})` : ''}</p>}
        <p>Reason: {note.reason}</p>
        <Rule />
        <Row left="Item" right="Amount" bold />
        {note.items.map((i, n) => (
          <div key={n} className="mt-1"><p>{i.description}</p><Row left={`  ${i.quantity} returned${i.tax_rate ? ` (GST ${i.tax_rate}%)` : ''}`} right={i.total.toFixed(2)} /></div>
        ))}
        <Rule />
        <Row left="Taxable value" right={note.subtotal.toFixed(2)} />
        {note.cgst > 0 && <Row left="CGST reversed" right={note.cgst.toFixed(2)} />}
        {note.sgst > 0 && <Row left={`${stateTaxName(biz?.state)} reversed`} right={note.sgst.toFixed(2)} />}
        {note.igst > 0 && <Row left="IGST reversed" right={note.igst.toFixed(2)} />}
        {note.discount_share > 0 && <Row left="Less bill discount" right={`-${note.discount_share.toFixed(2)}`} />}
        <Rule />
        <div className="text-sm"><Row left="CREDIT TOTAL" right={formatCurrency(note.total)} bold /></div>
        {note.settled_against_balance > 0 && <Row left="Taken off balance due" right={note.settled_against_balance.toFixed(2)} />}
        {note.refunded > 0 && <Row left="Refunded" right={note.refunded.toFixed(2)} />}
        <Rule />
        <p className="text-center">Authorised signature</p>
      </div>
    </div>
  );
};
