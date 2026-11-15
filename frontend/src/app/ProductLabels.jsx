/*
 * Barcode labels for any product: tick the products, say how many of each, print. A product with no barcode gets one of the shop's own
 * (an in-store EAN-13) with one tap, so it can be scanned at the till and when stock is received. A4 sheet or a label roll.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency } from '../lib/api.js';
import { barcodeSvg } from '../lib/barcode.js';
import { Alert, Button, Field, Input, PageLoader, Select, useToast } from '../components/ui.jsx';
import { GST_RATES } from '../lib/customItems.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useT } from '../i18n/useT.js';

/* A4 sheet, or a roll / pocket label printer: each label is its own page of exactly that size (width x height in mm). */
const SIZES = {
  sheet: { name: 'A4 sheet (3 across)' },
  r58x40: { name: 'Thermal label 58 mm wide × 40 mm', w: 58, h: 40 },
  r58x30: { name: 'Thermal label 58 mm wide × 30 mm', w: 58, h: 30 },
  r50x25: { name: 'Label roll 50 × 25 mm', w: 50, h: 25 },
  r40x30: { name: 'Label roll 40 × 30 mm', w: 40, h: 30 },
  r38x25: { name: 'Small label 38 × 25 mm', w: 38, h: 25 },
  r30x20: { name: 'Pocket label 30 × 20 mm', w: 30, h: 20 }
};

/* One label: brand, item name, barcode, its number and the price. Sized in millimetres so a roll label never spills onto a second page. */
const Label = ({ p, size, showPrice }) => {
  const small = size.h && size.h <= 20;
  const style = size.w ? { width: `${size.w}mm`, height: `${size.h}mm`, padding: '0.8mm 1.2mm', breakAfter: 'page', pageBreakAfter: 'always' } : { padding: '6px' };
  return (
    <div className="light-sheet flex flex-col items-center justify-between overflow-hidden break-inside-avoid rounded border border-line bg-white text-center text-ink-900 print:rounded-none print:border-0" style={style}>
      <div className="w-full leading-tight">
        {p.brand_name && <p className="truncate font-semibold uppercase tracking-wide" style={{ fontSize: small ? '5pt' : '6pt' }}>{p.brand_name}</p>}
        <p className="line-clamp-2 font-semibold" style={{ fontSize: small ? '6pt' : '8pt' }}>{p.name}</p>
      </div>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center py-0.5 [&_svg]:h-full [&_svg]:max-h-full [&_svg]:w-full" style={size.h ? { maxHeight: `${Math.round(size.h * 0.38)}mm` } : undefined} dangerouslySetInnerHTML={{ __html: barcodeSvg(p.barcode, { height: 60, quiet: 6 }) }} />
      <p className="tabular leading-none tracking-wider" style={{ fontSize: small ? '5pt' : '6pt' }}>{p.barcode}</p>
      {showPrice && <p className="tabular font-bold leading-tight" style={{ fontSize: small ? '7pt' : '9pt' }}>{formatCurrency(p.selling_price)}</p>}
    </div>
  );
};

/* Link a barcode that is already printed on the goods (the maker's) to an item, so scanning it finds that item. */
const LinkBarcode = ({ products, onLinked }) => {
  const tr = useT();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const found = q.trim().length < 2 || pick ? [] : products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6);
  const link = async () => {
    setBusy(true); setError('');
    try {
      await api(`/products/${pick.product_id}/barcodes`, { method: 'POST', body: { barcode: code.trim() } });
      toast.success(tr('{{code}} now belongs to {{name}}', { code: code.trim(), name: pick.name }));
      setCode(''); setQ(''); setPick(null); onLinked();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="lb-h" className="rounded-xl border border-line p-4">
      <h2 id="lb-h" className="text-small font-semibold text-ink-900">{tr('Link a barcode to an item')}</h2>
      <p className="mt-1 text-caption text-ink-500">{tr('For goods that already have a barcode printed on them. Scan or type it, pick the item, and scanning it later finds that item.')}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field id="lb-code" label={tr('Barcode')}><Input id="lb-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr('Scan or type')} /></Field>
        <div className="relative">
          <Field id="lb-item" label={tr('Item')}><Input id="lb-item" value={pick ? pick.name : q} onChange={(e) => { setPick(null); setQ(e.target.value); }} placeholder={tr('Start typing the item name')} /></Field>
          {found.length > 0 && <ul className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">{found.map((p) => <li key={p.product_id}><button type="button" className="block w-full px-3 py-2 text-left text-small hover:bg-surface-2" onClick={() => setPick(p)}>{p.name}{p.brand_name ? <span className="text-ink-500"> · {p.brand_name}</span> : null}</button></li>)}</ul>}
        </div>
        <div className="self-end"><Button variant="secondary" onClick={link} disabled={busy || !pick || !code.trim()}>{tr('Link')}</Button></div>
      </div>
      <Alert>{error}</Alert>
    </section>
  );
};

/* A new item on the spot: name, price and how many came in. It is saved as a product with that opening stock and given a barcode of its own, and its labels are ticked ready to print, so the sticker and the stock are the same item from the first minute. */
const NewItem = ({ onAdded }) => {
  const tr = useT();
  const toast = useToast();
  const gstOn = useAuth().business?.gst_enabled !== false;   // a shop not registered for GST asks for neither HSN nor GST
  const [f, setF] = useState({ name: '', hsn_sac: '', tax_rate: '0', selling_price: '', qty: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.name.trim() && Number(f.selling_price) > 0 && Number(f.qty) > 0;
  const add = async () => {
    setBusy(true); setError('');
    try {
      const p = await api('/products', { method: 'POST', body: { name: f.name.trim(), hsn_sac: gstOn ? f.hsn_sac.trim() || null : null, tax_rate: gstOn ? Number(f.tax_rate) : 0, selling_price: Number(f.selling_price), opening_stock: Number(f.qty), track_inventory: true } });
      await api('/products/barcodes/make', { method: 'POST', body: { product_ids: [p.product_id] } });
      toast.success(tr('{{name}} added with {{n}} in stock', { name: p.name, n: f.qty }));
      onAdded(p.product_id, Number(f.qty));
      setF({ name: '', hsn_sac: '', tax_rate: f.tax_rate, selling_price: '', qty: '' });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer text-small font-semibold text-ink-900">{tr('Add a new item and print its labels')}</summary>
      <p className="mt-2 text-caption text-ink-500">{tr('Type the item once. It goes into your stock with the quantity you enter and gets its own barcode, ready to print.')}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2"><Field id="ni-name" label={tr('Item name')}><Input id="ni-name" value={f.name} onChange={set('name')} /></Field></div>
        {gstOn && <Field id="ni-hsn" label={tr('HSN (optional)')}><Input id="ni-hsn" inputMode="numeric" value={f.hsn_sac} onChange={set('hsn_sac')} /></Field>}
        {gstOn && <Field id="ni-gst" label={tr('GST')}><Select id="ni-gst" value={f.tax_rate} onChange={set('tax_rate')}>{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</Select></Field>}
        <Field id="ni-price" label={tr('Selling price (₹)')}><Input id="ni-price" inputMode="decimal" value={f.selling_price} onChange={set('selling_price')} /></Field>
        <Field id="ni-qty" label={tr('How many')}><Input id="ni-qty" inputMode="numeric" value={f.qty} onChange={set('qty')} /></Field>
      </div>
      <Alert>{error}</Alert>
      <div className="mt-3"><Button onClick={add} disabled={busy || !ok}>{tr('Add to stock')}</Button></div>
    </details>
  );
};

const ProductLabels = () => {
  const tr = useT();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState({});     // product_id -> number of labels; absent = not chosen
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState('r50x25');
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
  const added = async (id, n) => { await load(); setCopies((c) => ({ ...c, [id]: Math.min(200, n) })); };
  const set = (id, n) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(200, Number(n) || 0)) }));
  const size = SIZES[layout];
  const page = size.w ? `${size.w}mm ${size.h}mm; margin: 0` : 'A4; margin: 10mm';

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
          <Link to="/app/add-items" className="self-center text-sm font-semibold text-brand-600">{tr('← Back')}</Link>
          <Field id="pl-size" label={tr('Label size')}>
            <Select id="pl-size" value={layout} onChange={(e) => setLayout(e.target.value)}>
              {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{tr(v.name)}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-small text-ink-700"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />{tr('Show the price')}</label>
          <div className="ml-auto flex flex-wrap gap-2">
            {lacking.length > 0 && <Button variant="secondary" onClick={make} disabled={busy}>{tr('Make barcodes for {{n}} without one', { n: lacking.length })}</Button>}
            <Button onClick={() => window.print()} disabled={!labels.length}>{tr('Print {{n}} labels', { n: labels.length })}</Button>
          </div>
        </div>
        <p className="text-caption text-ink-500">{tr('Tick the products and say how many labels each. A product without a barcode gets one of your own; stick it on and scan it at the till or when stock comes in.')}</p>
        <NewItem onAdded={added} />
        <LinkBarcode products={products} onLinked={load} />
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
      <div className={size.w ? 'flex flex-wrap gap-2 print:block print:gap-0' : 'grid grid-cols-3 gap-2'} style={size.w ? undefined : { gridAutoRows: '32mm' }}>
        {labels.map(({ p, key }) => <Label key={key} p={p} size={size} showPrice={showPrice} />)}
      </div>
    </div>
  );
};

export default ProductLabels;
