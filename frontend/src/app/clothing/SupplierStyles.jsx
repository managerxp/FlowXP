/*
 * On a supplier's page for a clothing shop: what they have delivered, style by style (pieces, spend, average cost a piece, last delivery, pieces per size).
 * Plain English like the Suppliers page it sits in.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../../lib/api.js';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const SupplierStyles = ({ supplierId }) => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows(null); setError('');
    api(`/clothing/suppliers/${supplierId}/styles`).then(setRows).catch((e) => setError(e.message));
  }, [supplierId]);
  if (error) return null;           // no access to costs, or not a clothing shop: show nothing rather than an error
  const pieces = (rows || []).reduce((t, r) => t + r.pieces, 0);
  const spent = (rows || []).reduce((t, r) => t + r.spent, 0);
  return (
    <section aria-label="Styles bought">
      <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Styles bought {rows && rows.length > 0 && <span className="tabular font-normal">· {rows.length} · {pieces} pieces · {formatCurrency(spent)}</span>}</h3>
      {!rows && <div className="h-24 animate-pulse rounded-(--radius-card) bg-surface-3" />}
      {rows?.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-5 text-center text-small text-ink-500">No clothing received from this supplier yet.</p>}
      {rows?.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.style_id} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0"><span className="block truncate text-small font-medium text-ink-900">{r.name}</span>
                  <span className="block text-caption text-ink-500">{r.style_code} · {r.orders} order{r.orders === 1 ? '' : 's'} · last {day(r.last_date)}</span></span>
                <span className="tabular shrink-0 text-right"><span className="block text-small font-semibold text-ink-900">{formatCurrency(r.spent)}</span>
                  <span className="block text-caption text-ink-500">{r.pieces} pcs · {formatCurrency(r.avg_cost)} each</span></span>
              </div>
              <p className="tabular mt-1 text-caption text-ink-500">{r.sizes.map((z) => `${z.size}: ${z.pieces}`).join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SupplierStyles;
