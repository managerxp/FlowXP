/*
 * Barcode labels for shelves and cartons: choose products on the Products screen, then print. Each label carries the
 * name, the price (MRP if set) and a Code 128 barcode of the product’s barcode (or its SKU). Pack barcodes (carton)
 * can be printed too. Sized for a standard A4 sheet of small labels; "Save as PDF" works the same.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { barcodeSvg } from '../../lib/barcode.js';
import { money } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, PageLoader, Select } from '../../components/ui.jsx';

const LabelsPrint = () => {
  const [params] = useSearchParams();
  const ids = (params.get('ids') || '').split(',').map(Number).filter(Boolean).slice(0, 80);
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState('medium');

  useEffect(() => {
    let live = true;
    Promise.all(ids.map((id) => api(`/wholesale/products/${id}`))).then((p) => { if (live) setProducts(p); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [params.get('ids')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert>{error}</Alert>;
  if (!products) return <PageLoader />;
  const labels = products.flatMap((p) => {
    const rows = [];
    const code = p.barcode || p.sku;
    if (code) rows.push({ key: `${p.product_id}-base`, name: p.name, unit: p.unit, price: p.mrp ?? p.wholesale_price, code });
    for (const u of p.units || []) if (u.barcode) rows.push({ key: `${p.product_id}-${u.unit_name}`, name: p.name, unit: u.unit_name, price: null, code: u.barcode });
    return rows;
  }).flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.key}-${i}` })));
  const cols = { small: 'grid-cols-4', medium: 'grid-cols-3', large: 'grid-cols-2' }[size];
  const missing = products.filter((p) => !p.barcode && !p.sku && !(p.units || []).some((u) => u.barcode));

  return (
    <div>
      <style>{`@page { size: A4; margin: 10mm; } @media print { html, body { background: #fff !important; } main { padding: 0 !important; background: #fff !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <Link to="/app/wholesale/products" className="self-center text-sm font-semibold text-brand-600">← Back</Link>
        <Field id="lb-copies" label="Copies of each"><div className="w-24"><Input id="lb-copies" type="number" min="1" max="50" value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></div></Field>
        <Field id="lb-size" label="Label size"><Select id="lb-size" value={size} onChange={(e) => setSize(e.target.value)}><option value="small">Small (4 across)</option><option value="medium">Medium (3 across)</option><option value="large">Large (2 across)</option></Select></Field>
        <Button onClick={() => window.print()} className="ml-auto">Print {labels.length} label{labels.length === 1 ? '' : 's'}</Button>
      </div>
      {missing.length > 0 && <p className="no-print mb-4 rounded-lg bg-warning/10 px-4 py-2 text-small text-warning">No barcode or SKU on: {missing.map((p) => p.name).join(', ')}. Add one on the product to print its label.</p>}
      <div className={`grid ${cols} gap-2`}>
        {labels.map((l) => (
          <div key={l.key} className="break-inside-avoid rounded border border-line bg-white p-2 text-center text-ink-900">
            <p className="truncate text-xs font-semibold">{l.name}{l.unit ? ` (${l.unit})` : ''}</p>
            <div className="flex justify-center py-1 [&_svg]:h-12 [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(l.code, { height: 46 }) }} />
            <p className="tabular text-[11px] tracking-wider">{l.code}</p>
            {l.price != null && <p className="tabular text-xs font-bold">{money(l.price)}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LabelsPrint;
