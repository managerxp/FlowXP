/*
 * Print views on A4: the sales order (for the customer to confirm) and the delivery challan (travels with the goods,
 * signed by the receiver). Ordinary pages — the browser prints them or saves them as PDF. ?auto=1 prints on load.
 */
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, PageLoader } from '../../components/ui.jsx';
import { longDate, money, qty, useLoad } from '../../lib/wholesale.js';

const PrintStyles = () => (
  <style>{`
    @page { size: A4; margin: 12mm; }
    @media print {
      html, body { background: #fff !important; }
      main { padding: 0 !important; background: #fff !important; }
      .no-print { display: none !important; }
      .sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; max-width: none !important; padding: 0 !important; }
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

const Bar = ({ back, children }) => (
  <div className="no-print mb-5 flex flex-wrap items-center gap-2">
    <Link to={back} className="text-sm font-semibold text-brand-600">← Back</Link>
    <div className="ml-auto flex gap-2">{children}<Button onClick={() => window.print()}>Print</Button></div>
  </div>
);

const Party = ({ title, lines }) => (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</p>
    {lines.filter(Boolean).map((l, i) => <p key={i} className={`text-sm ${i === 0 ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>{l}</p>)}
  </div>
);

/* ── sales order ─────────────────────────────────────────────────────────── */
export const OrderPrint = () => {
  const { id } = useParams();
  const { data: o, error } = useLoad(`/wholesale/orders/${id}`);
  const biz = useLoad('/businesses/current');
  usePrintOnLoad(Boolean(o));
  if (error) return <Alert>{error}</Alert>;
  if (!o) return <PageLoader />;
  const b = biz.data || {};
  return (
    <div>
      <PrintStyles />
      <Bar back={`/app/wholesale/orders/${id}`} />
      <div className="sheet mx-auto max-w-3xl rounded-(--radius-card) border border-line bg-white p-8 text-ink-900 shadow-sm">
        <header className="flex items-start justify-between gap-6 border-b border-line pb-4">
          <div><h1 className="text-xl font-bold">{b.name || ''}</h1><p className="text-sm text-ink-700">{[b.address, b.state].filter(Boolean).join(', ')}</p>{b.gstin && <p className="text-sm text-ink-700">GSTIN {b.gstin}</p>}</div>
          <div className="text-right"><p className="text-lg font-bold">SALES ORDER</p><p className="text-sm">{o.order_number}</p><p className="text-sm text-ink-700">{longDate(o.order_date)}</p>{o.customer_po && <p className="text-sm text-ink-700">Your PO: {o.customer_po}</p>}</div>
        </header>
        <div className="grid grid-cols-2 gap-6 py-4">
          <Party title="Bill to" lines={[o.customer, o.customer_phone, o.customer_gstin && `GSTIN ${o.customer_gstin}`]} />
          <Party title="Ship to" lines={[o.shipping_address || o.customer]} />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-y border-line text-left text-[11px] uppercase tracking-wide text-ink-500"><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Rate</th><th className="py-2 pr-2 text-right">GST</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {o.items.map((i) => {
              const gross = i.quantity * i.price; const disc = gross * (i.discount_pct / 100);
              return <tr key={i.item_id} className="border-b border-line align-top"><td className="py-2 pr-2">{i.line_no}</td><td className="py-2 pr-2 font-medium">{i.product}{i.discount_pct ? <span className="block text-xs font-normal text-ink-500">{i.discount_pct}% discount</span> : null}</td><td className="py-2 pr-2 text-right tabular">{qty(i.quantity)} {i.unit_name}</td><td className="py-2 pr-2 text-right tabular">{money(i.price)}</td><td className="py-2 pr-2 text-right tabular">{i.tax_rate}%</td><td className="py-2 text-right tabular">{money(gross - disc)}</td></tr>;
            })}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Taxable value</dt><dd className="tabular">{money(o.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>GST</dt><dd className="tabular">{money(o.tax)}</dd></div>
          {o.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular">−{money(o.discount)}</dd></div>}
          <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><dt>Total</dt><dd className="tabular">{money(o.total)}</dd></div>
        </dl>
        <footer className="mt-8 grid grid-cols-2 gap-6 text-xs text-ink-700">
          <p>Payment terms: {o.payment_terms_days} days{o.expected_delivery ? ` · Expected delivery ${longDate(o.expected_delivery)}` : ''}.{o.notes ? ` ${o.notes}` : ''}</p>
          <p className="text-right">Salesperson: {o.salesperson || '—'}</p>
        </footer>
      </div>
    </div>
  );
};

/* ── delivery challan ────────────────────────────────────────────────────── */
export const ChallanPrint = () => {
  const { id } = useParams();
  const { data: c, error } = useLoad(`/wholesale/deliveries/${id}/challan`);
  usePrintOnLoad(Boolean(c));
  if (error) return <Alert>{error}</Alert>;
  if (!c) return <PageLoader />;
  const w = c.warehouse || {};
  return (
    <div>
      <PrintStyles />
      <Bar back="/app/wholesale/fulfilment?tab=deliveries" />
      <div className="sheet mx-auto max-w-3xl rounded-(--radius-card) border border-line bg-white p-8 text-ink-900 shadow-sm">
        <header className="flex items-start justify-between gap-6 border-b border-line pb-4">
          <div><h1 className="text-xl font-bold">{c.business?.name}</h1><p className="text-sm text-ink-700">{[w.name, w.address, w.city, w.state].filter(Boolean).join(', ')}</p>{(w.gstin || c.business?.gstin) && <p className="text-sm text-ink-700">GSTIN {w.gstin || c.business.gstin}</p>}</div>
          <div className="text-right"><p className="text-lg font-bold">DELIVERY CHALLAN</p><p className="text-sm">{c.challan_number}</p><p className="text-sm text-ink-700">{c.date ? longDate(c.date) : ''}</p></div>
        </header>
        <div className="grid grid-cols-2 gap-6 py-4">
          <Party title="Deliver to" lines={[c.customer?.name, c.delivery_address || c.customer?.address, c.customer?.phone, c.customer?.gstin && `GSTIN ${c.customer.gstin}`]} />
          <Party title="Reference" lines={[`Order ${c.order_number}`, c.invoice_number && `Invoice ${c.invoice_number}`, c.vehicle_no && `Vehicle ${c.vehicle_no}`, c.driver_name && `Driver ${c.driver_name}${c.driver_phone ? ` (${c.driver_phone})` : ''}`]} />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-y border-line text-left text-[11px] uppercase tracking-wide text-ink-500"><th className="py-2 pr-2">#</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">HSN</th><th className="py-2 pr-2">Batch / expiry</th><th className="py-2 text-right">Quantity</th></tr></thead>
          <tbody>{c.lines.map((l, i) => <tr key={i} className="border-b border-line align-top"><td className="py-2 pr-2">{i + 1}</td><td className="py-2 pr-2 font-medium">{l.description}</td><td className="py-2 pr-2">{l.hsn_sac || ''}</td><td className="py-2 pr-2 text-xs">{l.batches || ''}</td><td className="py-2 text-right tabular">{qty(l.quantity)} {l.unit || ''}</td></tr>)}</tbody>
        </table>
        <p className="mt-4 text-sm text-ink-700">{c.packages.length ? `${c.packages.length} package${c.packages.length === 1 ? '' : 's'}${c.total_weight_kg ? ` · ${c.total_weight_kg} kg` : ''}: ${c.packages.map((p) => p.package_no).join(', ')}` : ''}</p>
        <footer className="mt-14 grid grid-cols-3 gap-8 text-xs text-ink-700">
          <p className="border-t border-ink-400 pt-1">Prepared by</p><p className="border-t border-ink-400 pt-1">Driver’s signature</p><p className="border-t border-ink-400 pt-1">Received by (name, signature, stamp, date)</p>
        </footer>
        <p className="mt-6 text-center text-[11px] text-ink-500">Goods received in good condition unless noted. This challan is not a tax invoice.</p>
      </div>
    </div>
  );
};

/* ── pick list (for the picker) ──────────────────────────────────────────── */
export const PickPrint = () => {
  const { id } = useParams();
  const { data: p, error } = useLoad(`/wholesale/pick-lists/${id}`);
  usePrintOnLoad(Boolean(p));
  if (error) return <Alert>{error}</Alert>;
  if (!p) return <PageLoader />;
  return (
    <div>
      <PrintStyles />
      <Bar back={`/app/wholesale/fulfilment?tab=picks&open=${id}`} />
      <div className="sheet mx-auto max-w-3xl rounded-(--radius-card) border border-line bg-white p-8 text-ink-900 shadow-sm">
        <header className="flex items-start justify-between gap-6 border-b border-line pb-4">
          <div><h1 className="text-xl font-bold">PICK LIST {p.pick_number}</h1><p className="text-sm text-ink-700">{p.warehouse}</p></div>
          <div className="text-right text-sm"><p>Order {p.order_number}</p><p className="text-ink-700">{p.customer}</p>{p.picker_name && <p className="text-ink-700">Picker: {p.picker_name}</p>}</div>
        </header>
        <table className="mt-4 w-full text-sm">
          <thead><tr className="border-y border-line text-left text-[11px] uppercase tracking-wide text-ink-500"><th className="py-2 pr-2">Bin</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Batches (soonest expiry first)</th><th className="py-2 pr-2 text-right">Pick</th><th className="py-2 text-right">Picked</th></tr></thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.pick_item_id} className="border-b border-line align-top">
                <td className="py-2 pr-2 font-semibold">{i.location || '—'}</td><td className="py-2 pr-2 font-medium">{i.product}{i.sku && <span className="block text-xs font-normal text-ink-500">{i.sku}</span>}</td>
                <td className="py-2 pr-2 text-xs">{i.batches.map((b) => `${b.batch_no}${b.expiry_date ? ` (exp ${String(b.expiry_date).slice(0, 10)})` : ''} × ${qty(b.qty_base)}`).join(', ')}</td>
                <td className="py-2 pr-2 text-right tabular">{qty(i.qty_base)} {i.base_unit}{i.unit_factor !== 1 && <span className="block text-xs text-ink-500">{qty(i.qty_base / i.unit_factor)} {i.unit_name}</span>}</td>
                <td className="py-2 text-right"><span className="inline-block h-5 w-16 border-b border-ink-400" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="mt-12 grid grid-cols-2 gap-8 text-xs text-ink-700"><p className="border-t border-ink-400 pt-1">Picked by</p><p className="border-t border-ink-400 pt-1">Checked by</p></footer>
      </div>
    </div>
  );
};
