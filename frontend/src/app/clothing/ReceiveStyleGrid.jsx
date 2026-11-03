/*
 * Receiving a clothing delivery by style: pick the style, type how many of each size and colour arrived in one grid, add them all to the delivery at once.
 * Each filled cell becomes its own line on Receive stock (its own variant, so stock lands on exactly that size and colour). Plain English like the page it opens from.
 */
import { useState } from 'react';
import { Search } from 'lucide-react';
import { qs, useDebounced, useLoad } from '../../lib/salon.js';
import { Alert, Button, Field, Input, Modal } from '../../components/ui.jsx';

const Swatch = ({ hex, name }) => <span title={name} aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-line-strong align-middle" style={{ background: hex || '#e5e7eb' }} />;

const Grid = ({ styleId, onAdd, onBack }) => {
  const { data: s, error, loading } = useLoad(`/clothing/styles/${styleId}`);
  const [qty, setQty] = useState({});
  const [cost, setCost] = useState('');
  const filled = s ? Object.entries(qty).filter(([id, n]) => Number(n) > 0 && s.variants.some((v) => v.product_id === Number(id))) : [];
  const pieces = filled.reduce((t, [, n]) => t + Number(n), 0);
  const add = () => {
    const byId = new Map(s.variants.map((v) => [v.product_id, v]));
    onAdd(filled.map(([id, n]) => { const v = byId.get(Number(id)); return { product: { product_id: v.product_id, name: `${s.name} · ${v.colour} · ${v.size}`, sku: v.sku, unit: 'pc' }, qty: Number(n) }; }), cost);
  };
  return (
    <>
      {loading && !s && <p className="text-small text-ink-500">Loading…</p>}
      <Alert>{error}</Alert>
      {s && (
        <div className="space-y-3">
          <p className="text-small text-ink-500"><button type="button" onClick={onBack} className="font-semibold text-brand-600 hover:underline">← Other style</button> · {s.style_code} · Type how many arrived in each size and colour.</p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-small">
              <thead><tr className="bg-surface-2 text-left text-caption text-ink-500"><th className="px-3 py-2 font-semibold">Colour</th>{s.matrix.sizes.map((z) => <th key={z} className="px-2 py-2 text-center font-semibold">{z}</th>)}</tr></thead>
              <tbody>
                {s.matrix.colours.map((c) => (
                  <tr key={c.name} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 font-medium"><Swatch hex={c.hex} name={c.name} /> <span className="ml-1">{c.name}</span></td>
                    {s.matrix.sizes.map((z) => {
                      const cell = s.matrix.grid[c.name]?.[z];
                      if (!cell) return <td key={z} className="px-2 py-1.5 text-center text-ink-300">–</td>;
                      return (
                        <td key={z} className="px-1 py-1.5 text-center">
                          <input type="number" min="0" inputMode="numeric" aria-label={`${c.name} ${z}`} value={qty[cell.product_id] ?? ''} placeholder="0"
                                 onChange={(e) => setQty((q) => ({ ...q, [cell.product_id]: e.target.value }))}
                                 className="tabular h-11 w-14 rounded-md border border-line-strong bg-surface px-1 text-center" />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-40"><Field id="rsg-cost" label="Cost each (₹)" hint="Optional. Blank keeps each size's own cost."><Input id="rsg-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field></div>
            <Button onClick={add} disabled={!pieces}>Add {pieces || ''} piece{pieces === 1 ? '' : 's'} to the delivery</Button>
          </div>
        </div>
      )}
    </>
  );
};

const ReceiveStyleGrid = ({ onAdd, onClose }) => {
  const [search, setSearch] = useState('');
  const [styleId, setStyleId] = useState(null);
  const q = useDebounced(search);
  const list = useLoad(`/clothing/styles${qs({ search: q, limit: 12 })}`, { paged: true });
  const rows = list.data || [];
  return (
    <Modal wide title="Receive a style by size and colour" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {styleId ? <Grid styleId={styleId} onAdd={(entries, cost) => { onAdd(entries, cost); onClose(); }} onBack={() => setStyleId(null)} /> : (
        <div className="space-y-3">
          <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input aria-label="Search styles" autoFocus className="pl-10" placeholder="Name, style code, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Alert>{list.error}</Alert>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((s) => (
              <li key={s.style_id}><button type="button" onClick={() => setStyleId(s.style_id)} className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-small hover:bg-surface-2">
                <span className="min-w-0 truncate font-medium text-ink-900">{s.name}</span><span className="shrink-0 text-caption text-ink-500">{s.style_code}</span></button></li>
            ))}
            {!rows.length && !list.loading && <li className="px-4 py-3 text-small text-ink-500">No styles found.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
};

export default ReceiveStyleGrid;
