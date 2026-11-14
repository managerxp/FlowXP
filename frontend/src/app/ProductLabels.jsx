/*
 * Barcode labels for any product: tick the products, say how many of each, print. A product with no barcode gets one of the shop's own
 * (an in-store EAN-13) with one tap, so it can be scanned at the till and when stock is received. A4 sheet or a label roll.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency } from '../lib/api.js';
import { barcodeSvg } from '../lib/barcode.js';
import { Alert, Button, Field, Input, PageLoader, Select, useToast } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const SIZES = { sheet: { cols: 'grid-cols-3', page: 'A4; margin: 10mm' }, roll: { cols: 'grid-cols-1', page: '50mm 25mm; margin: 1mm' } };

const ProductLabels = () => {
  const tr = useT();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState({});     // product_id -> number of labels; absent = not chosen
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState('sheet');
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => api('/products').then((r) => setProducts(r.filter((p) => p.status === 'ACTIVE'))).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (products || []).filter((p) => !t || p.name.toLowerCase().includes(t) || String(p.sku || '').toLowerCase().includes(t) || String(p.barcode || '') === t);
  }, [products, q]);

  if (error) return <Alert>{error}</Alert>;
  if (!products) return <PageLoader />;

  const chosen = products.filter((p) => copies[p.product_id] > 0);
  const lacking = chosen.filter((p) => !p.barcode);
  const labels = chosen.filter((p) => p.barcode).flatMap((p) => Array.from({ length: copies[p.product_id] }, (_, i) => ({ p, key: `${p.product_id}-${i}` })));
  const set = (id, n) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(200, Number(n) || 0)) }));
  const { cols, page } = SIZES[layout];

  const make = async () => {
    setBusy(true);
    try {
      const r = await api('/products/barcodes/make', { method: 'POST', body: { product_ids: lacking.map((p) => p.product_id) } });
      toast.success(tr('{{n}} barcodes made', { n: r.made.length }));
      await load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <style>{`@page { size: ${page}; } @media print { html, body { background: #fff !important; } main { padding: 0 !important; background: #fff !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Link to="/app/products" className="self-center text-sm font-semibold text-brand-600">{tr('← Back')}</Link>
          <Field id="pl-size" label={tr('Label size')}>
            <Select id="pl-size" value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="sheet">{tr('A4 sheet (3 across)')}</option>
              <option value="roll">{tr('Label roll 50 × 25 mm')}</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-small text-ink-700"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />{tr('Show the price')}</label>
          <div className="ml-auto flex flex-wrap gap-2">
            {lacking.length > 0 && <Button variant="secondary" onClick={make} disabled={busy}>{tr('Make barcodes for {{n}} without one', { n: lacking.length })}</Button>}
            <Button onClick={() => window.print()} disabled={!labels.length}>{tr('Print {{n}} labels', { n: labels.length })}</Button>
          </div>
        </div>
        <p className="text-caption text-ink-500">{tr('Tick the products and say how many labels each. A product without a barcode gets one of your own; stick it on and scan it at the till or when stock comes in.')}</p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Name, SKU or barcode')} aria-label={tr('Search products')} />
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {shown.map((p) => (
            <li key={p.product_id} className="flex items-center justify-between gap-3 px-4 py-2 text-small">
              <span className="min-w-0 truncate"><span className="font-medium text-ink-900">{p.name}</span> <span className="tabular text-caption text-ink-500">{p.barcode || tr('no barcode yet')}</span></span>
              <span className="flex items-center gap-2">
                <button type="button" className="text-caption font-semibold text-brand-600" onClick={() => set(p.product_id, Math.max(1, Math.round(p.current_stock)))}>{tr('As in stock')}</button>
                <input type="number" min="0" max="200" aria-label={tr('Labels for {{name}}', { name: p.name })} value={copies[p.product_id] || 0} onChange={(e) => set(p.product_id, e.target.value)} className="tabular h-9 w-20 rounded-md border border-line-strong bg-surface px-2 text-right" />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={`grid ${cols} gap-2`}>
        {labels.map(({ p, key }) => (
          <div key={key} className="light-sheet break-inside-avoid rounded border border-line bg-white p-2 text-center text-ink-900">
            <p className="truncate text-[11px] font-semibold">{p.name}</p>
            <div className="flex justify-center py-0.5 [&_svg]:h-9 [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(p.barcode, { height: 36 }) }} />
            <p className="tabular text-[10px] tracking-wider">{p.barcode}</p>
            {showPrice && <p className="tabular text-sm font-bold">{formatCurrency(p.selling_price)}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductLabels;
