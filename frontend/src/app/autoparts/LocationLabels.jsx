/* Rack and bin labels: the full code in large type, a QR that opens the place when scanned, and a Code 128 barcode of the code. Print on A4 sticker sheets or "Save as PDF". */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../../lib/api.js';
import { barcodeSvg } from '../../lib/barcode.js';
import { Alert, Button, Field, Input, PageLoader, Select } from '../../components/ui.jsx';

export default function LocationLabels() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') || '').split(',').map(Number).filter(Boolean).slice(0, 80);
  const [labels, setLabels] = useState(null);
  const [error, setError] = useState('');
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState('medium');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const places = await Promise.all(ids.map((id) => api(`/autoparts/locations/${id}`)));
        const out = await Promise.all(places.map(async (p) => ({ id: p.location_id, code: p.code, name: p.name, qr: await QRCode.toDataURL(p.qr_text, { width: 220, margin: 1, errorCorrectionLevel: 'M' }) })));
        if (live) setLabels(out);
      } catch (e) { if (live) setError(e.message); }
    })();
    return () => { live = false; };
  }, [params.get('ids')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert>{error}</Alert>;
  if (!labels) return <PageLoader />;
  const all = labels.flatMap((l) => Array.from({ length: copies }, (_, i) => ({ ...l, key: `${l.id}-${i}` })));
  const cols = { small: 'grid-cols-3', medium: 'grid-cols-2', large: 'grid-cols-1' }[size];
  return (
    <div>
      <style>{`@page { size: A4; margin: 10mm; } @media print { html, body { background: #fff !important; } main { padding: 0 !important; background: #fff !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <Link to="/app/parts/warehouse" className="self-center text-sm font-semibold text-brand-600">← Back</Link>
        <Field id="ll-copies" label="Copies of each"><div className="w-24"><Input id="ll-copies" type="number" min="1" max="20" value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></div></Field>
        <Field id="ll-size" label="Label size"><Select id="ll-size" value={size} onChange={(e) => setSize(e.target.value)}><option value="small">Small (3 across)</option><option value="medium">Medium (2 across)</option><option value="large">Large (1 across)</option></Select></Field>
        <Button onClick={() => window.print()} className="ml-auto">Print {all.length} label{all.length === 1 ? '' : 's'}</Button>
      </div>
      <div className={`grid ${cols} gap-2`}>
        {all.map((l) => (
          <div key={l.key} className="flex break-inside-avoid items-center gap-3 rounded border border-line bg-white p-3 text-ink-900">
            <img src={l.qr} alt="" className="h-24 w-24 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-xl font-bold leading-tight tracking-wide">{l.code}</p>
              {l.name && l.name !== l.code && <p className="truncate text-xs text-ink-500">{l.name}</p>}
              <div className="mt-1 [&_svg]:h-10 [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(l.code, { height: 40 }) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
