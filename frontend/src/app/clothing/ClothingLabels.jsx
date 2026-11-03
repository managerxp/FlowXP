/*
 * Price tags for clothing: pick the sizes and colours, say how many of each, print. Every tag carries the variant's own stored barcode (the one the till scans), so a printed
 * sticker and the stock item are always the same thing. Open from a style (`?styles=12,13`). A4 sheet or a 50 x 25 mm roll; "Save as PDF" works the same.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatCurrency } from '../../lib/api.js';
import { barcodeSvg } from '../../lib/barcode.js';
import { Alert, Button, Field, PageLoader, Select } from '../../components/ui.jsx';
import { useT } from '../../i18n/useT.js';

const SIZES = { sheet: { cols: 'grid-cols-3', page: 'A4; margin: 10mm' }, roll: { cols: 'grid-cols-1', page: '50mm 25mm; margin: 1mm' } };
const rs = (paise) => formatCurrency((paise || 0) / 100);

const ClothingLabels = () => {
  const tr = useT();
  const [params] = useSearchParams();
  const ids = (params.get('styles') || '').split(',').map(Number).filter(Boolean).slice(0, 20);
  const [styles, setStyles] = useState(null);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState({});
  const [layout, setLayout] = useState('sheet');
  const [showMrp, setShowMrp] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all(ids.map((id) => api(`/clothing/styles/${id}`))).then((s) => { if (live) setStyles(s); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [params.get('styles')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert>{error}</Alert>;
  if (!styles) return <PageLoader />;
  const variants = styles.flatMap((s) => s.variants.filter((v) => v.status !== 'ARCHIVED').map((v) => ({ ...v, style: s })));
  const n = (v) => Math.max(0, Math.min(200, copies[v.product_id] ?? 1));
  const fill = (f) => setCopies(Object.fromEntries(variants.map((v) => [v.product_id, f(v)])));
  const labels = variants.flatMap((v) => Array.from({ length: n(v) }, (_, i) => ({ v, key: `${v.product_id}-${i}` })));
  const { cols, page } = SIZES[layout];

  return (
    <div>
      <style>{`@page { size: ${page}; } @media print { html, body { background: #fff !important; } main { padding: 0 !important; background: #fff !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Link to="/app/clothing" className="self-center text-sm font-semibold text-brand-600">{tr('← Back')}</Link>
          <Field id="cl-size" label={tr('Label size')}>
            <Select id="cl-size" value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="sheet">{tr('A4 sheet (3 across)')}</option>
              <option value="roll">{tr('Label roll 50 × 25 mm')}</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-small text-ink-700"><input type="checkbox" checked={showMrp} onChange={(e) => setShowMrp(e.target.checked)} />{tr('Show the MRP')}</label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => fill(() => 1)}>{tr('One of each')}</Button>
            <Button variant="secondary" onClick={() => fill((v) => v.stock)}>{tr('As many as in stock')}</Button>
            <Button onClick={() => window.print()} disabled={!labels.length}>{tr('Print {{n}} labels', { n: labels.length })}</Button>
          </div>
        </div>
        <p className="text-caption text-ink-500">{tr('Each tag shows the barcode saved on that size and colour, so the sticker and the stock are the same item. To use your own barcodes, set one on the SKUs and barcodes tab first.')}</p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {variants.map((v) => (
            <li key={v.product_id} className="flex items-center justify-between gap-3 px-4 py-2 text-small">
              <span className="min-w-0 truncate"><span className="font-medium text-ink-900">{v.style.name}</span> · {v.colour} · {v.size} <span className="tabular text-caption text-ink-500">{v.barcode} · {tr('{{n}} in stock', { n: v.stock })}</span></span>
              <input type="number" min="0" max="200" aria-label={tr('Copies of {{name}}', { name: `${v.style.name} ${v.colour} ${v.size}` })} value={n(v)} onChange={(e) => setCopies((c) => ({ ...c, [v.product_id]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) }))} className="tabular h-9 w-20 rounded-md border border-line-strong bg-surface px-2 text-right" />
            </li>
          ))}
        </ul>
      </div>
      <div className={`grid ${cols} gap-2`}>
        {labels.map(({ v, key }) => (
          <div key={key} className="light-sheet break-inside-avoid rounded border border-line bg-white p-2 text-center text-ink-900">
            <p className="truncate text-[11px] font-semibold">{v.style.name}</p>
            <p className="truncate text-[10px]">{v.colour} · {v.size}</p>
            <div className="flex justify-center py-0.5 [&_svg]:h-9 [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(v.barcode, { height: 36 }) }} />
            <p className="tabular text-[10px] tracking-wider">{v.barcode}</p>
            <p className="tabular text-sm font-bold">{rs(v.selling_price_paise)}{showMrp && v.mrp_paise > v.selling_price_paise && <span className="ml-2 text-[10px] font-normal text-ink-500 line-through">{rs(v.mrp_paise)}</span>}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClothingLabels;
