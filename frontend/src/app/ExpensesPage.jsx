/*
 * Expenses: what the business spent outside of stock (rent, salaries, bills),
 * for a chosen period. Exact totals come from GET /expenses/summary (the list
 * is capped at 300), compared with the matching period before; the list below
 * is grouped by day and each expense opens to be corrected or deleted.
 *
 * These are the expenses Profitability takes off contribution for its
 * estimated net.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';

const DEFAULT_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Gas', 'Water', 'Internet & phone', 'Transport', 'Repairs', 'Marketing', 'Cleaning', 'Other'];
const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank'], ['CARD', 'Card'], ['OTHER', 'Other']];
const METHOD_LABEL = Object.fromEntries(METHODS);

/* ── Periods ───────────────────────────────────────────────────────────── */

const d0 = (iso) => new Date(`${iso}T00:00`);
const plusDays = (iso, n) => { const d = d0(iso); d.setDate(d.getDate() + n); return localISO(d); };
const monthStart = (d) => localISO(new Date(d.getFullYear(), d.getMonth(), 1));
const monthEnd = (d) => localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const monthName = (d) => d.toLocaleDateString([], { month: 'long' });
const sameDayIn = (year, month, day) => localISO(new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate())));

/* A period and the one to compare it with. "This month" is compared with the same days of last month, not all of it. */
const periodFor = (key, custom) => {
  const now = new Date(); const today = localISO(now);
  if (key === 'month') {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { from: monthStart(now), to: today, prevFrom: monthStart(prev), prevTo: sameDayIn(prev.getFullYear(), prev.getMonth(), now.getDate()), vs: `the same days of ${monthName(prev)}`, label: `${monthName(now)} so far` };
  }
  if (key === 'last-month') {
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1); const before = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return { from: monthStart(last), to: monthEnd(last), prevFrom: monthStart(before), prevTo: monthEnd(before), vs: monthName(before), label: monthName(last) };
  }
  if (key === '30d') return { from: plusDays(today, -29), to: today, prevFrom: plusDays(today, -59), prevTo: plusDays(today, -30), vs: 'the 30 days before' };
  if (key === 'year') {
    const y = now.getFullYear();
    return { from: `${y}-01-01`, to: today, prevFrom: `${y - 1}-01-01`, prevTo: sameDayIn(y - 1, now.getMonth(), now.getDate()), vs: 'the same time last year' };
  }
  const from = custom.from || today; const to = custom.to && custom.to >= from ? custom.to : from;
  const days = Math.round((d0(to) - d0(from)) / 86400000) + 1;
  return { from, to, prevFrom: plusDays(from, -days), prevTo: plusDays(from, -1), vs: `the ${days} day${days === 1 ? '' : 's'} before` };
};
const PERIODS = [['month', 'This month'], ['last-month', 'Last month'], ['30d', 'Last 30 days'], ['year', 'This year'], ['custom', 'Pick dates']];

const dayLabel = (iso) => {
  const today = localISO();
  if (iso === today) return 'Today';
  if (iso === plusDays(today, -1)) return 'Yesterday';
  return d0(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d0(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

/* ── Add / edit ───────────────────────────────────────────────────────── */

const ExpenseForm = ({ expense, known, onSaved, onDeleted, onClose }) => {
  const toast = useToast();
  const isEdit = Boolean(expense?.expense_id);
  const blank = { category: '', amount: '', payment_method: 'CASH', expense_date: localISO(), description: '' };
  const [form, setForm] = useState(isEdit ? { ...expense, amount: String(expense.amount), description: expense.description || '' } : blank);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(0);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // their own categories first (most used), then the usual ones they haven't used
  const chips = [...new Set([...known, ...DEFAULT_CATEGORIES])].slice(0, 16);
  if (form.category && !chips.includes(form.category)) chips.unshift(form.category);

  const save = async (another) => {
    if (!form.category.trim()) { setError('Choose a category'); return; }
    setError(''); setBusy(true);
    try {
      const body = { category: form.category.trim(), amount: Number(form.amount), payment_method: form.payment_method, expense_date: form.expense_date, description: form.description.trim() || null };
      await api(isEdit ? `/expenses/${expense.expense_id}` : '/expenses', { method: isEdit ? 'PATCH' : 'POST', body });
      if (another) {
        toast.success(`${body.category} · ${formatCurrency(body.amount)} saved`);
        setAdded((n) => n + 1);
        setForm((f) => ({ ...blank, payment_method: f.payment_method, expense_date: f.expense_date }));
        setCustom(false);
        onSaved(false);
      } else onSaved(true, isEdit ? 'Expense updated' : `${body.category} · ${formatCurrency(body.amount)} saved`);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete this ${expense.category} expense of ${formatCurrency(expense.amount)}? This can't be undone.`)) return;
    setBusy(true); setError('');
    try { await api(`/expenses/${expense.expense_id}`, { method: 'DELETE' }); onDeleted(); }
    catch (caught) { setError(caught.message); setBusy(false); }
  };

  return (
    <Modal title={isEdit ? 'Edit expense' : 'Add an expense'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(false); }} className="space-y-5">
        <Alert>{error}</Alert>
        {added > 0 && <p className="-mt-2 text-caption font-medium text-success">{added} saved. Add the next one.</p>}
        <Field id="x-amount" label="Amount (₹)">
          <Input id="x-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required autoFocus className="!h-12 !text-[22px] font-semibold tabular" />
        </Field>
        <fieldset>
          <legend className="text-small font-medium text-ink-700">What for</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button key={c} type="button" aria-pressed={!custom && form.category === c} onClick={() => { setCustom(false); setForm((f) => ({ ...f, category: c })); }}
                      className={`rounded-lg border px-2.5 py-1.5 text-small ${!custom && form.category === c ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-500' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{c}</button>
            ))}
            <button type="button" aria-pressed={custom} onClick={() => { setCustom(true); setForm((f) => ({ ...f, category: '' })); }}
                    className={`rounded-lg border border-dashed px-2.5 py-1.5 text-small ${custom ? 'border-brand-500 text-brand-700' : 'border-line-strong text-ink-500 hover:border-ink-400'}`}>+ New</button>
          </div>
          {custom && <Input aria-label="New category" value={form.category} onChange={set('category')} placeholder="e.g. Pest control" maxLength={60} className="mt-2" autoFocus />}
        </fieldset>
        <div>
          <p className="text-small font-medium text-ink-700">Paid by</p>
          <div role="radiogroup" aria-label="Paid by" className="mt-2 grid grid-cols-5 gap-1.5">
            {METHODS.map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={form.payment_method === v} onClick={() => setForm((f) => ({ ...f, payment_method: v }))}
                      className={`h-9 rounded-lg border text-small font-medium ${form.payment_method === v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[9.5rem_1fr] gap-3">
          <Field id="x-date" label="Date"><Input id="x-date" type="date" value={form.expense_date} max={localISO()} onChange={set('expense_date')} required /></Field>
          <Field id="x-note" label="Note (optional)"><Input id="x-note" value={form.description} onChange={set('description')} placeholder="e.g. September rent" /></Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          {isEdit ? <Button type="button" variant="ghost" className="text-danger" onClick={remove} disabled={busy}>Delete</Button> : <span />}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{added ? 'Done' : 'Cancel'}</Button>
            {!isEdit && <Button type="button" variant="secondary" onClick={() => document.getElementById('x-amount').form.reportValidity() && save(true)} disabled={busy}>Save & add another</Button>}
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const Change = ({ now, before, vs }) => {
  if (!before && !now) return null;
  if (!before) return <p className="mt-1 text-small text-ink-500">Nothing was logged in {vs}.</p>;
  const diff = now - before;
  const pct = Math.round((Math.abs(diff) / before) * 100);
  if (Math.abs(diff) < 0.5) return <p className="mt-1 text-small text-ink-500">The same as {vs}.</p>;
  // spending more is the thing to notice, so it is the one in colour
  return (
    <p className="tabular mt-1 text-small text-ink-500">
      <span className={`font-semibold ${diff > 0 ? 'text-warning' : 'text-success'}`}>{formatCurrency(Math.abs(diff))} {diff > 0 ? 'more' : 'less'}</span> than {vs} ({pct}%{diff > 0 ? ' up' : ' down'}, {formatCurrency(before)} then)
    </p>
  );
};

const ExpensesPage = () => {
  const toast = useToast();
  const { outletId, activeOutlet } = useAuth();
  const allView = outletId === 'all';
  const [periodKey, setPeriodKey] = useState('month');
  const [custom, setCustom] = useState({ from: plusDays(localISO(), -6), to: localISO() });
  const [category, setCategory] = useState(null);
  const [summary, setSummary] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // {} = new, or an expense
  const period = useMemo(() => periodFor(periodKey, custom), [periodKey, custom]);

  const load = async () => {
    try {
      const q = `from=${period.from}&to=${period.to}`;
      const [s, p, list] = await Promise.all([
        api(`/expenses/summary?${q}`), api(`/expenses/summary?from=${period.prevFrom}&to=${period.prevTo}`),
        api(`/expenses?${q}${category ? `&category=${encodeURIComponent(category)}` : ''}`)
      ]);
      setSummary(s); setPrevious(p); setRows(list); setError('');
    } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { setRows(null); load(); }, [period, category, outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of rows || []) { if (!map.has(e.expense_date)) map.set(e.expense_date, []); map.get(e.expense_date).push(e); }
    return [...map.entries()];
  }, [rows]);
  const top = summary?.by_category[0]?.total || 1;
  const prevOf = (c) => previous?.by_category.find((x) => x.category === c)?.total || 0;
  const range = `${d0(period.from).toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${d0(period.to).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">Expenses</h1>
          <p className="mt-1 text-small text-ink-500">Rent, salaries, bills: what the business spends outside of stock{activeOutlet && !allView ? ` at ${activeOutlet.name}` : allView ? ', across every outlet' : ''}.</p>
        </div>
        <Button onClick={() => setEditing({})} disabled={allView} title={allView ? 'Pick an outlet at the top to add an expense to it' : undefined}><Plus aria-hidden="true" className="h-4 w-4" />Add expense</Button>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2 p-1">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={periodKey === k} onClick={() => { setPeriodKey(k); setCategory(null); }}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-small font-medium ${periodKey === k ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>{label}</button>
          ))}
        </div>
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" value={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="!w-auto" />
            <span className="text-small text-ink-500">to</span>
            <Input type="date" aria-label="To" value={custom.to} min={custom.from} max={localISO()} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="!w-auto" />
          </div>
        )}
      </div>

      <Alert>{error}</Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="Summary" className="space-y-4">
          <div className="rounded-(--radius-card) border border-line bg-surface p-5">
            <p className="text-caption text-ink-500">Spent, {period.label || range}</p>
            {summary ? <>
              <p className="tabular mt-1 text-[32px] font-semibold leading-tight tracking-tight text-ink-900">{formatCurrency(summary.total)}</p>
              <p className="text-small text-ink-500">{summary.count} expense{summary.count === 1 ? '' : 's'}</p>
              {previous && <Change now={summary.total} before={previous.total} vs={period.vs} />}
            </> : <div className="mt-2 h-16 animate-pulse rounded-lg bg-surface-3" />}
            <p className="mt-3 border-t border-line pt-3 text-caption text-ink-500">See what is left after these on <Link to="/app/profitability" className="font-medium text-brand-700 hover:underline">Profitability</Link>.</p>
          </div>

          {summary?.by_category.length > 0 && (
            <div className="rounded-(--radius-card) border border-line bg-surface p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Where it went</h2>
                {category && <button type="button" onClick={() => setCategory(null)} className="text-caption font-medium text-brand-700">Show all</button>}
              </div>
              <ul className="space-y-1">
                {summary.by_category.map((c) => {
                  const before = prevOf(c.category);
                  const active = category === c.category;
                  return (
                    <li key={c.category}>
                      <button type="button" onClick={() => setCategory(active ? null : c.category)} aria-pressed={active}
                              className={`w-full rounded-lg px-2 py-2 text-left transition-colors duration-(--duration-fast) ${active ? 'bg-brand-50' : category ? 'opacity-60 hover:bg-surface-2 hover:opacity-100' : 'hover:bg-surface-2'}`}>
                        <span className="flex items-baseline justify-between gap-3 text-small">
                          <span className="min-w-0 truncate font-medium text-ink-900">{c.category} <span className="tabular font-normal text-ink-500">· {Math.round((c.total / summary.total) * 100)}%</span></span>
                          <span className="tabular shrink-0 font-semibold text-ink-900">{formatCurrency(c.total)}</span>
                        </span>
                        <span aria-hidden="true" className="mt-1.5 block h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (c.total / top) * 100)}%` }} /></span>
                        {before > 0 && Math.abs(c.total - before) >= 1 && (
                          <span className={`tabular mt-1 block text-caption ${c.total > before ? 'text-warning' : 'text-ink-500'}`}>{c.total > before ? '↑' : '↓'} {formatCurrency(Math.abs(c.total - before))} vs {period.vs}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {summary.by_method.length > 1 && (
                <p className="tabular mt-4 border-t border-line pt-3 text-caption text-ink-500">Paid by {summary.by_method.map((m) => `${METHOD_LABEL[m.method] || m.method} ${formatCurrency(m.total)}`).join(' · ')}</p>
              )}
            </div>
          )}
        </section>

        <section aria-label="Expense list">
          <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{category ? `${category}, ${period.label || range}` : 'Every expense'}</h2>
          {!rows && !error && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {rows?.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">Nothing logged for {period.label || 'these dates'}</p>
              <p className="mt-1 text-small text-ink-500">Add rent, salaries and bills as you pay them, so profit counts them.</p>
              {!allView && <Button className="mt-4" onClick={() => setEditing({})}>Add an expense</Button>}
            </div>
          )}
          <div className="space-y-5">
            {byDay.map(([date, list]) => (
              <div key={date}>
                <p className="mb-1.5 flex justify-between text-caption font-medium text-ink-500"><span>{dayLabel(date)}</span><span className="tabular">{formatCurrency(list.reduce((t, e) => t + e.amount, 0))}</span></p>
                <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
                  {list.map((e) => (
                    <li key={e.expense_id}>
                      <button type="button" onClick={() => setEditing(e)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-small font-semibold text-ink-900">{e.category}</span>
                          <span className="block truncate text-caption text-ink-500">{[METHOD_LABEL[e.payment_method] || e.payment_method, e.description].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="tabular shrink-0 text-small font-semibold text-ink-900">{formatCurrency(e.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {rows?.length === 300 && <p className="mt-3 text-caption text-ink-500">Showing the latest 300. The totals on the left count every expense in the period.</p>}
        </section>
      </div>

      {editing && (
        <ExpenseForm expense={editing.expense_id ? editing : null} known={summary?.categories || []} onClose={() => setEditing(null)}
                     onSaved={(close, msg) => { if (close) { setEditing(null); toast.success(msg); } load(); }}
                     onDeleted={() => { setEditing(null); toast.success('Expense deleted'); load(); }} />
      )}
    </div>
  );
};

export default ExpensesPage;
