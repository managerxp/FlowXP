/*
 * Small pieces the salon screens share, so they look and behave the same: tabs, a toolbar, money, a segmented
 * choice, a "busy" wrapper for saves, a reason prompt. Everything else comes from components/ui.jsx.
 */
import { useState } from 'react';
import { formatCurrency } from '../../lib/api.js';
import { Badge, Button, Field, Input, Select, useToast } from '../../components/ui.jsx';

export const Money = ({ value, className = '' }) => <span className={`tabular ${className}`}>{formatCurrency(value)}</span>;

/* Tabs as links to a section of one page: the selected tab is remembered in the address (?tab=) so a reload or a
   shared link lands in the same place. */
export const Tabs = ({ tabs, value, onChange, label = 'Sections' }) => (
  <div role="tablist" aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
    {tabs.map((t) => (
      <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-small font-medium transition-colors duration-(--duration-fast) ${
                value === t.key ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>
        {t.label}
        {t.count != null && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold text-ink-500">{t.count}</span>}
      </button>
    ))}
  </div>
);

/* A row of mutually exclusive choices, for things with two to five options (a view, a discount kind). */
export const Segmented = ({ options, value, onChange, label, size = 'md' }) => (
  <div role="radiogroup" aria-label={label} className="inline-flex rounded-(--radius-control) border border-line-strong bg-surface p-0.5">
    {options.map((o) => (
      <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
              className={`rounded-[calc(var(--radius-control)-2px)] px-3 ${size === 'sm' ? 'py-1 text-caption' : 'py-1.5 text-small'} font-medium transition-colors duration-(--duration-fast) ${
                value === o.value ? 'bg-brand-500 text-white' : 'text-ink-700 hover:bg-surface-2'}`}>
        {o.label}
      </button>
    ))}
  </div>
);

export const Toolbar = ({ children }) => <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;

/* Chips for filters: several can be shown, one is on. */
export const Chips = ({ options, value, onChange, label }) => (
  <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
    {options.map((o) => (
      <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
              className={`rounded-full border px-3 py-1 text-caption font-medium transition-colors duration-(--duration-fast) ${
                value === o.value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700 hover:border-line-strong'}`}>
        {o.label}{o.count != null && <span className="ml-1.5 text-ink-400">{o.count}</span>}
      </button>
    ))}
  </div>
);

/* A titled block inside a page. */
export const Panel = ({ title, lead, action, children, className = '' }) => (
  <section className={`rounded-(--radius-card) border border-line bg-surface ${className}`}>
    {(title || action) && (
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-ink-900">{title}</h2>
          {lead && <p className="text-caption text-ink-500">{lead}</p>}
        </div>
        {action}
      </header>
    )}
    <div className="p-5">{children}</div>
  </section>
);

/* Runs an async action with a "busy" flag and an error toast, so every save button behaves alike. */
export const useAction = () => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, success) => {
    setBusy(true);
    try { const out = await fn(); if (success) toast.success(success); return out; }
    catch (error) { toast.error(error.message); return undefined; }
    finally { setBusy(false); }
  };
  return [busy, run];
};

/* A numeric field that keeps what was typed (so "1." is not rewritten) and hands the parent a string. */
export const NumberField = ({ id, label, hint, value, onChange, min = 0, step = 'any', prefix, suffix, required, disabled }) => (
  <Field id={id} label={label} hint={hint}>
    <div className="relative">
      {prefix && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-small text-ink-400">{prefix}</span>}
      <Input id={id} type="number" inputMode="decimal" min={min} step={step} value={value ?? ''} required={required} disabled={disabled}
             onChange={(e) => onChange(e.target.value)} className={`${prefix ? 'pl-7' : ''} ${suffix ? 'pr-10' : ''}`} />
      {suffix && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-small text-ink-400">{suffix}</span>}
    </div>
  </Field>
);

export const SelectField = ({ id, label, hint, value, onChange, children, ...rest }) => (
  <Field id={id} label={label} hint={hint}><Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>{children}</Select></Field>
);

export const Toggle = ({ checked, onChange, label, hint, id }) => (
  <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
    <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-(--color-brand-500)" />
    <span><span className="block text-small font-medium text-ink-900">{label}</span>{hint && <span className="block text-caption text-ink-500">{hint}</span>}</span>
  </label>
);

export const Pill = ({ tone = 'neutral', children }) => <Badge tone={tone}>{children}</Badge>;

/* Pager for server-paged lists. */
export const Pager = ({ meta, onPage }) => {
  if (!meta || meta.total <= meta.limit) return null;
  const from = meta.offset + 1; const to = Math.min(meta.total, meta.offset + meta.limit);
  return (
    <div className="mt-3 flex items-center justify-between text-small text-ink-500">
      <span>{from}–{to} of {meta.total}</span>
      <span className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.offset === 0} onClick={() => onPage(Math.max(0, meta.offset - meta.limit))}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={to >= meta.total} onClick={() => onPage(meta.offset + meta.limit)}>Next</Button>
      </span>
    </div>
  );
};
