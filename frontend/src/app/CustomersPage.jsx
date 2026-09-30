/*
 * Customers: who buys, how often, and what they owe. The list on the left
 * (search, filters, sort), the chosen customer on the right (?c=ID): spend,
 * visits, unpaid bills, their loyalty card and points, and every bill.
 *
 * Every figure comes from customers.controller.js (outstanding and totals are
 * summed from issued invoices on read), nothing is estimated here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, Plus, Search } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { LoyaltyCard } from '../components/LoyaltyCard.jsx';
import { Alert, Button, Field, Input, Modal, Select, StatusBadge, useToast } from '../components/ui.jsx';

const DAY = 86400000;
const daysSince = (iso) => (iso ? Math.max(0, Math.round((new Date(`${localISO()}T00:00`) - new Date(`${iso}T00:00`)) / DAY)) : null);
const ago = (iso) => {
  const d = daysSince(iso);
  if (d == null) return 'No bills yet';
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.round(d / 30)} month${Math.round(d / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? '' : 's'} ago`;
};
const longDate = (iso) => new Date(`${iso}T00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const REGULAR_BILLS = 5;
const LAPSED_DAYS = 60;
const FILTERS = [
  ['all', 'All', () => true],
  ['owes', 'Owes you', (c) => c.outstanding_balance > 0],
  ['regular', `${REGULAR_BILLS}+ bills`, (c) => c.bills >= REGULAR_BILLS],
  ['new', 'New in 30 days', (c) => c.first_bill_date && daysSince(c.first_bill_date) <= 30],
  ['lapsed', `Not back in ${LAPSED_DAYS} days`, (c) => c.last_bill_date && daysSince(c.last_bill_date) > LAPSED_DAYS]
];
const SORTS = {
  recent: ['Last bill', (a, b) => String(b.last_bill_date || '').localeCompare(String(a.last_bill_date || ''))],
  spent: ['Spent most', (a, b) => b.total_purchases - a.total_purchases],
  owes: ['Owes most', (a, b) => b.outstanding_balance - a.outstanding_balance],
  name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)]
};

const Initials = ({ name, size = 'md' }) => (
  <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ${size === 'lg' ? 'h-12 w-12 text-body' : 'h-9 w-9 text-caption'}`}>{initials(name)}</span>
);

/* ── Add / edit ───────────────────────────────────────────────────────── */

const emptyForm = { name: '', phone: '', email: '', address: '', state: '', pincode: '', gstin: '', credit_limit: '' };

const CustomerForm = ({ initial, onSaved, onClose }) => {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(initial.customer_id);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = {
        name: form.name, phone: form.phone, email: form.email, address: form.address, state: form.state,
        pincode: form.pincode, gstin: form.gstin, credit_limit: form.credit_limit || 0
      };
      const saved = await api(isEdit ? `/customers/${initial.customer_id}` : '/customers', { method: isEdit ? 'PATCH' : 'POST', body });
      onSaved(saved);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const legend = 'text-caption font-semibold uppercase tracking-[0.12em] text-ink-500';
  return (
    <Modal title={isEdit ? `Edit ${initial.name}` : 'Add a customer'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <fieldset className="space-y-4">
          <legend className={legend}>Contact</legend>
          <Field id="c-name" label="Name"><Input id="c-name" value={form.name} onChange={set('name')} required autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="c-phone" label="Mobile" hint="Finds them at the counter and on their loyalty card"><Input id="c-phone" type="tel" inputMode="tel" value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field id="c-email" label="Email (optional)"><Input id="c-email" type="email" value={form.email || ''} onChange={set('email')} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className={legend}>For GST bills <span className="font-normal normal-case tracking-normal text-ink-400">· only for business customers</span></legend>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field id="c-gstin" label="GSTIN"><Input id="c-gstin" value={form.gstin || ''} onChange={set('gstin')} maxLength={15} className="uppercase" /></Field>
            <Field id="c-pincode" label="Pincode"><Input id="c-pincode" inputMode="numeric" value={form.pincode || ''} onChange={set('pincode')} maxLength={6} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field id="c-address" label="Address"><Input id="c-address" value={form.address || ''} onChange={set('address')} /></Field>
            <Field id="c-state" label="State" hint="Decides CGST + SGST or IGST"><Input id="c-state" value={form.state || ''} onChange={set('state')} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className={legend}>Credit</legend>
          <div className="sm:w-1/2">
            <Field id="c-credit" label="Credit limit (₹)" hint="A warning only; nothing is blocked. 0 means no limit.">
              <Input id="c-credit" type="number" min="0" step="0.01" value={form.credit_limit} onChange={set('credit_limit')} />
            </Field>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── One customer ─────────────────────────────────────────────────────── */

const Stat = ({ label, value, note }) => (
  <div className="rounded-(--radius-card) border border-line bg-surface p-3.5">
    <p className="text-caption text-ink-500">{label}</p>
    <p className="tabular mt-1 text-title font-semibold text-ink-900">{value}</p>
    {note && <p className="mt-0.5 text-caption text-ink-500">{note}</p>}
  </div>
);

const BillRow = ({ bill }) => {
  const cancelled = bill.status === 'CANCELLED';
  return (
    <li>
      <Link to={`/app/billing/invoices/${bill.invoice_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className={`block text-small font-medium ${cancelled ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{bill.invoice_number}</span>
          <span className="block text-caption text-ink-500">{longDate(bill.invoice_date)}</span>
        </span>
        <span className="text-right">
          <span className={`tabular block text-small font-semibold ${cancelled ? 'text-ink-400' : 'text-ink-900'}`}>{formatCurrency(bill.total)}</span>
          {!cancelled && bill.balance_due > 0 && <span className="tabular block text-caption font-medium text-warning">{formatCurrency(bill.balance_due)} due</span>}
        </span>
        <span className="w-20 shrink-0 text-right"><StatusBadge status={cancelled ? 'CANCELLED' : bill.payment_status} /></span>
      </Link>
    </li>
  );
};

const CustomerPanel = ({ customer: c, onEdit, onBack }) => {
  const [bills, setBills] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setBills(null); setLoyalty(null); setError(''); setShowAll(false);
    api(`/customers/${c.customer_id}/invoices`).then(setBills).catch((e) => setError(e.message));
    api(`/loyalty/customers/${c.customer_id}`).then(setLoyalty).catch(() => setLoyalty(null));
  }, [c.customer_id]);

  const live = (bills || []).filter((b) => b.status !== 'CANCELLED');
  const unpaid = live.filter((b) => b.balance_due > 0);
  const overLimit = c.credit_limit > 0 && c.outstanding_balance > c.credit_limit;
  const pts = loyalty?.points;
  const shown = showAll ? bills : (bills || []).slice(0, 10);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4 sm:p-6">
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />All customers</button>
        <div className="flex items-start gap-3">
          <Initials name={c.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold text-ink-900">{c.name}</h2>
            <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-500">
              {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-brand-700"><Phone aria-hidden="true" className="h-3.5 w-3.5" />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-brand-700"><Mail aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{c.email}</span></a>}
              {!c.phone && !c.email && 'No contact details'}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" to={`/app/billing?customer=${c.customer_id}`}>New bill</Button>
          <Button size="sm" variant="secondary" onClick={onEdit}>Edit details</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <Alert>{error}</Alert>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Spent with you" value={formatCurrency(c.total_purchases)} note={c.first_bill_date ? `since ${longDate(c.first_bill_date)}` : undefined} />
          <Stat label="Bills" value={c.bills} note={c.bills ? `${formatCurrency(c.total_purchases / c.bills)} a bill on average` : undefined} />
          <Stat label="Last bill" value={ago(c.last_bill_date)} note={c.last_bill_date ? longDate(c.last_bill_date) : undefined} />
          <Stat label="Owes you" value={formatCurrency(c.outstanding_balance)} note={c.credit_limit > 0 ? `limit ${formatCurrency(c.credit_limit)}` : undefined} />
        </div>

        {unpaid.length > 0 && (
          <section aria-label="Unpaid bills" className={`rounded-(--radius-card) border ${overLimit ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}>
            <div className="px-4 pt-3.5">
              <p className={`text-small font-semibold ${overLimit ? 'text-danger' : 'text-ink-900'}`}>
                {formatCurrency(c.outstanding_balance)} unpaid on {unpaid.length} bill{unpaid.length === 1 ? '' : 's'}
                {overLimit && ` · over their ${formatCurrency(c.credit_limit)} limit`}
              </p>
              <p className="mt-0.5 text-caption text-ink-500">Open a bill to record a payment against it.</p>
            </div>
            <ul className="mt-2 divide-y divide-line/70 border-t border-line/70">{unpaid.map((b) => <BillRow key={b.invoice_id} bill={b} />)}</ul>
          </section>
        )}

        {(loyalty?.loyalty || pts) && (
          <section aria-label="Loyalty">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Loyalty</h3>
            <div className="space-y-2">
              {loyalty.loyalty && <LoyaltyCard card={loyalty.loyalty} />}
              {pts && (
                <div className="rounded-lg border border-line bg-surface-2 p-3.5 text-small text-ink-700">
                  <p><strong className="tabular text-ink-900">{pts.balance} points</strong> <span className="tabular">worth {formatCurrency(pts.balance_value)}</span>{pts.tier && <> · <span className="font-semibold text-brand-700">{pts.tier.name}</span></>}</p>
                  {pts.next_tier && <p className="mt-0.5 text-caption text-ink-500">{pts.next_tier.points_needed} more points to {pts.next_tier.name}.</p>}
                </div>
              )}
            </div>
          </section>
        )}

        <section aria-label="Bills">
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Bills {bills && <span className="tabular font-normal">· {bills.length}{bills.length === 100 ? '+' : ''}</span>}</h3>
          {!bills && !error && <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" />}
          {bills?.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-6 text-center text-small text-ink-500">No bills yet. Pick them on a bill and it shows here.</p>}
          {bills?.length > 0 && (
            <div className="overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              <ul className="divide-y divide-line">{shown.map((b) => <BillRow key={b.invoice_id} bill={b} />)}</ul>
              {!showAll && bills.length > 10 && <button type="button" onClick={() => setShowAll(true)} className="w-full border-t border-line py-2.5 text-small font-medium text-brand-700 hover:bg-surface-2">Show all {bills.length}</button>}
            </div>
          )}
        </section>

        {(c.gstin || c.address || c.state || c.pincode) && (
          <section aria-label="GST details">
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">For GST bills</h3>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-small">
              {c.gstin && <><dt className="text-ink-500">GSTIN</dt><dd className="font-medium text-ink-900">{c.gstin}</dd></>}
              {c.address && <><dt className="text-ink-500">Address</dt><dd className="text-ink-900">{c.address}</dd></>}
              {(c.state || c.pincode) && <><dt className="text-ink-500">State</dt><dd className="text-ink-900">{[c.state, c.pincode].filter(Boolean).join(' · ')}</dd></>}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const CustomerRow = ({ c, active, onOpen }) => (
  <li>
    <button type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) ${active ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>
      <Initials name={c.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-semibold text-ink-900">{c.name}</span>
        <span className="block truncate text-caption text-ink-500">{[c.phone, c.bills ? `${c.bills} bill${c.bills === 1 ? '' : 's'} · last ${ago(c.last_bill_date).toLowerCase()}` : 'No bills yet'].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tabular block text-small font-semibold text-ink-900">{formatCurrency(c.total_purchases)}</span>
        {c.outstanding_balance > 0 && <span className="tabular block text-caption font-medium text-warning">owes {formatCurrency(c.outstanding_balance)}</span>}
      </span>
    </button>
  </li>
);

const CustomersPage = () => {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('c') ? Number(params.get('c')) : null;
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [editing, setEditing] = useState(null);

  // ponytail: loads every active customer and filters here; page it on the server when a business has thousands
  const load = () => api('/customers').then((rows) => { setCustomers(rows); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const open = (id) => setParams(id ? { c: String(id) } : {});
  const q = search.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const matches = (c) => !q || c.name.toLowerCase().includes(q) || (digits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(digits))
    || String(c.email || '').toLowerCase().includes(q) || String(c.gstin || '').toLowerCase().includes(q);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , fn]) => [k, (customers || []).filter(fn).length])), [customers]);
  const shown = useMemo(() => {
    const fn = FILTERS.find(([k]) => k === filter)[2];
    return (customers || []).filter((c) => fn(c) && matches(c)).sort(SORTS[sort][1]);
  }, [customers, filter, sort, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = (customers || []).find((c) => c.customer_id === selectedId);
  const owed = (customers || []).reduce((s, c) => s + c.outstanding_balance, 0);

  return (
    <div className="-m-4 grid grid-cols-1 sm:-m-6 lg:-m-8 xl:h-[calc(100vh-3.5rem)] xl:grid-cols-[minmax(0,1fr)_460px]">
      <section aria-label="Customer list" className={`min-w-0 flex-col p-4 sm:p-6 lg:p-8 xl:flex xl:overflow-hidden ${selectedId ? 'hidden' : 'flex'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">Customers</h1>
            <p className="tabular mt-1 text-small text-ink-500">
              {customers ? <>{customers.length} customer{customers.length === 1 ? '' : 's'}{owed > 0 && <> · <span className="font-medium text-warning">{formatCurrency(owed)} owed by {counts.owes}</span></>}</> : 'Who buys from you, and what they owe.'}
            </p>
          </div>
          <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />Add customer</Button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">Search customers</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile, email or GSTIN" className="!pl-9" />
          </label>
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto">
            {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
        <div role="group" aria-label="Show" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${filter === key ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
              {label} <span className={`tabular ml-1 ${filter === key ? 'text-white/70' : 'text-ink-400'}`}>{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 xl:overflow-y-auto">
          <Alert>{error}</Alert>
          {!customers && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {customers?.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">No customers yet</p>
              <p className="mt-1 text-small text-ink-500">Add them here, or type a mobile number on a bill at the counter.</p>
              <Button className="mt-4" onClick={() => setEditing({})}>Add the first customer</Button>
            </div>
          )}
          {customers?.length > 0 && shown.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">No customers match{q ? ` “${search.trim()}”` : ''}.</p>}
          {shown.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              {shown.map((c) => <CustomerRow key={c.customer_id} c={c} active={c.customer_id === selectedId} onOpen={() => open(c.customer_id)} />)}
            </ul>
          )}
        </div>
      </section>

      <section aria-label="Selected customer" className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selected ? (
          <CustomerPanel key={selected.customer_id} customer={selected} onEdit={() => setEditing(selected)} onBack={() => open(null)} />
        ) : selectedId && customers ? (
          <div className="p-8 text-center text-small text-ink-500">That customer isn't in this list. <button type="button" onClick={() => open(null)} className="font-medium text-brand-700">Back to all</button></div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="text-small font-medium text-ink-700">Pick a customer to see their bills, loyalty and what they owe</p>
          </div>
        )}
      </section>

      {editing && (
        <CustomerForm
          initial={editing.customer_id ? { ...editing, credit_limit: editing.credit_limit ? String(editing.credit_limit) : '' } : emptyForm}
          onClose={() => setEditing(null)}
          onSaved={(saved) => { const isNew = !editing.customer_id; setEditing(null); toast.success(isNew ? `${saved.name} added` : 'Saved'); load(); if (isNew) open(saved.customer_id); }}
        />
      )}
    </div>
  );
};

export default CustomersPage;
