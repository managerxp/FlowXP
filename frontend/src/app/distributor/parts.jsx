/*
 * Small pieces the distributor screens share: territory and salesperson choosers, and a retailer chooser that collects
 * many retailers (optionally in a chosen order).
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useLoad } from '../../lib/distributor.js';
import { Field, Input, Select } from '../../components/ui.jsx';
import { SearchPicker } from '../wholesale/parts.jsx';

/** "South › Secunderabad › Ameerpet" for every node, in tree order. */
export const useTerritories = () => {
  const { data, reload } = useLoad('/distributor/territories');
  const list = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.map((t) => [t.territory_id, t]));
    const path = (t) => { const out = [t.name]; let p = t.parent_id; while (p && byId.has(p)) { out.unshift(byId.get(p).name); p = byId.get(p).parent_id; } return out.join(' › '); };
    return data.map((t) => ({ ...t, path: path(t) })).sort((a, b) => a.path.localeCompare(b.path));
  }, [data]);
  return { territories: list, raw: data, reload };
};

export const TerritorySelect = ({ value, onChange, id = 'territory', label = 'Territory', emptyLabel = 'None', levels, hint, required }) => {
  const { territories } = useTerritories();
  const rows = levels ? territories.filter((t) => levels.includes(t.level)) : territories;
  return (
    <Field id={id} label={label} hint={hint}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} required={required}>
        <option value="">{emptyLabel}</option>
        {rows.map((t) => <option key={t.territory_id} value={t.territory_id}>{t.path}{t.level !== 'AREA' ? ` (${t.level.toLowerCase()})` : ''}</option>)}
      </Select>
    </Field>
  );
};

export const useSalespeople = (status = 'ACTIVE') => useLoad(`/wholesale/salespeople?status=${status}`).data || [];

export const SalespersonSelect = ({ value, onChange, id = 'salesperson', label = 'Salesperson', emptyLabel = 'Unassigned', hint }) => {
  const people = useSalespeople();
  return (
    <Field id={id} label={label} hint={hint}>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}>
        <option value="">{emptyLabel}</option>
        {people.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}
      </Select>
    </Field>
  );
};

/**
 * Collect retailers: search to add, and (with `ordered`) move them up and down — the order is the route.
 * `value` is a list of { customer_id, name, ... }; `onChange` gets the new list.
 */
export const RetailerPicker = ({ value, onChange, ordered = false, id = 'retailer-picker', max = 500 }) => {
  const add = (c) => { if (value.some((x) => x.customer_id === c.customer_id) || value.length >= max) return; onChange([...value, { customer_id: c.customer_id, name: c.name, city: c.city, phone: c.phone }]); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= value.length) return; const next = [...value]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div className="space-y-3">
      <SearchPicker id={id} placeholder="Search retailers by name, phone or GSTIN" minChars={2} search={(t) => api(`/wholesale/customers?q=${encodeURIComponent(t)}&limit=15`)} onPick={add}
                    render={(c) => <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-ink-900">{c.name}</span><span className="block truncate text-caption text-ink-500">{[c.city, c.phone, c.territory].filter(Boolean).join(' · ')}</span></span>} />
      {value.length > 0 && (
        <ol className="max-h-72 divide-y divide-line overflow-auto rounded-lg border border-line">
          {value.map((c, i) => (
            <li key={c.customer_id} className="flex items-center gap-2 px-3 py-1.5 text-small">
              {ordered && <span className="w-6 text-right text-caption tabular text-ink-400">{i + 1}</span>}
              <span className="min-w-0 flex-1 truncate">{c.name}{c.city && <span className="ml-2 text-caption text-ink-500">{c.city}</span>}</span>
              {ordered && <><button type="button" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-ink-500 enabled:hover:bg-surface-2 disabled:opacity-30"><ArrowUp aria-hidden="true" className="h-4 w-4" /></button>
                <button type="button" aria-label={`Move ${c.name} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-ink-500 enabled:hover:bg-surface-2 disabled:opacity-30"><ArrowDown aria-hidden="true" className="h-4 w-4" /></button></>}
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => onChange(value.filter((x) => x.customer_id !== c.customer_id))} className="rounded p-1 text-ink-400 hover:bg-surface-2 hover:text-danger"><X aria-hidden="true" className="h-4 w-4" /></button>
            </li>
          ))}
        </ol>
      )}
      <p className="text-caption text-ink-500">{value.length} retailer{value.length === 1 ? '' : 's'} chosen{ordered ? ' — in the order they will be visited' : ''}.</p>
    </div>
  );
};

export { Input };
