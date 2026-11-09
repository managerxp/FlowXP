/*
 * Menu on / off. One big switch per dish for THIS outlet: switch a dish off when it runs out and it is greyed out on the till and the QR menu
 * (and cannot be added to a bill), switch it on again when it is back. Whole rows are tap targets (56px), so it works with a finger on a tablet.
 * The switch only changes this outlet; another outlet keeps selling the item. Prices and stock are never touched.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { useT } from '../i18n/useT.js';
import { pnameNow } from '../i18n/productName.js';
import { Alert, useToast } from '../components/ui.jsx';

const Switch = ({ on }) => (
  <span aria-hidden="true" className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors duration-(--duration-fast) ${on ? 'bg-success' : 'bg-ink-300'}`}>
    <span className={`absolute h-6 w-6 rounded-full bg-white shadow transition-transform duration-(--duration-fast) ${on ? 'translate-x-7' : 'translate-x-1'}`} />
  </span>
);

const MenuAvailability = () => {
  const tr = useT();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [offOnly, setOffOnly] = useState(false);

  const load = () => api('/products/availability').then((d) => { setItems(d.items); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const flip = async (item) => {
    const next = !item.is_available;
    setItems((rows) => rows.map((r) => (r.product_id === item.product_id ? { ...r, is_available: next } : r)));   // the switch moves at once
    try { await api(`/products/${item.product_id}/availability`, { method: 'PATCH', body: { is_available: next } }); }
    catch (caught) { setItems((rows) => rows.map((r) => (r.product_id === item.product_id ? { ...r, is_available: !next } : r))); toast.error(caught.message); }
  };

  const all = items || [];
  const categories = useMemo(() => [...new Set(all.map((i) => i.category_name || 'Other'))].sort(), [items]);   // eslint-disable-line react-hooks/exhaustive-deps
  const off = all.filter((i) => !i.is_available).length;
  const text = q.trim().toLowerCase();
  const shown = all.filter((i) => (category === 'all' || (i.category_name || 'Other') === category) && (!offOnly || !i.is_available)
    && (!text || i.name.toLowerCase().includes(text) || pnameNow(i).toLowerCase().includes(text)));
  const groups = useMemo(() => {
    const map = new Map();
    for (const i of shown) { const c = i.category_name || 'Other'; if (!map.has(c)) map.set(c, []); map.get(c).push(i); }
    return [...map.entries()];
  }, [shown]);   // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (active) => `min-h-11 rounded-lg border px-3.5 text-small font-medium transition-colors duration-(--duration-fast) ${active ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-h3 font-semibold text-ink-900">{tr('Menu on / off')}</h1>
        <p className="mt-1 text-small text-ink-500">{tr('Switch a dish off when it runs out. It stops being sold at this outlet until you switch it back on.')}</p>
      </div>

      <div className="sticky top-0 z-10 -mx-1 mb-3 space-y-2 bg-surface-2/95 px-1 pb-2 pt-1 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">{tr('Search dishes')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search dishes')} className="min-h-12 w-full rounded-lg border border-line-strong bg-surface pl-10 pr-3 text-body text-ink-900 outline-none focus:border-brand-500" />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tr('Show')}>
          <button type="button" aria-pressed={!offOnly} onClick={() => setOffOnly(false)} className={chip(!offOnly)}>{tr('All dishes')} <span className="tabular text-caption opacity-70">{all.length}</span></button>
          <button type="button" aria-pressed={offOnly} onClick={() => setOffOnly(true)} className={chip(offOnly)}>{tr('Switched off')} <span className="tabular text-caption opacity-70">{off}</span></button>
        </div>
        {categories.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={tr('Category')}>
            <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')} className={`${chip(category === 'all')} shrink-0`}>{tr('Everything')}</button>
            {categories.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={`${chip(category === c)} shrink-0`}>{c}</button>)}
          </div>
        )}
      </div>

      <Alert>{error}</Alert>
      {!items && !error && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
      {items && all.length === 0 && <p className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-small text-ink-500">{tr('No dishes yet. Add them under Products first.')}</p>}
      {items && all.length > 0 && shown.length === 0 && <p className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-small text-ink-500">{offOnly && !text ? tr('Everything is switched on.') : tr('No dish matches.')}</p>}

      <div className="space-y-5">
        {groups.map(([name, list]) => (
          <section key={name} aria-label={name}>
            <h2 className="mb-1.5 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{name}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {list.map((i) => (
                <li key={i.product_id}>
                  <button type="button" role="switch" aria-checked={i.is_available} aria-label={pnameNow(i)} onClick={() => flip(i)}
                          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left active:bg-surface-3">
                    <span className="min-w-0">
                      <span className={`block truncate text-body font-medium ${i.is_available ? 'text-ink-900' : 'text-ink-400 line-through'}`}>{pnameNow(i)}</span>
                      {!i.is_available && <span className="text-caption font-semibold text-warning">{tr('Off at this outlet')}</span>}
                    </span>
                    <Switch on={i.is_available} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};

export default MenuAvailability;
