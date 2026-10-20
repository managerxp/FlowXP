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
import { ArrowLeft, Mail, Phone, Plus, Search, Upload, UserRound } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { LoyaltyCard } from '../components/LoyaltyCard.jsx';
import { Alert, Button, Field, Input, Modal, Select, StatusBadge, useToast, StatCard, EmptyState } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';
import { formatDate } from '../lib/display.js';
import { CsvImportModal } from './wholesale/parts.jsx';

const IMPORT = {
  file: 'customers-template.csv', columns: ['Name', 'Phone', 'Email', 'GSTIN', 'Address', 'State', 'Pincode', 'Credit Limit'],
  sample: ['Ravi Motors', '9876543210', 'ravi@example.com', '36ABCDE1234F1Z5', '12 Main Road, Hyderabad', 'Telangana', '500001', '50000'],
  accepts: ['customer', 'customer_name', 'party', 'party_name', 'ledger', 'ledger_name', 'account_name', 'mobile', 'mobile_no', 'mobile_number', 'phone_no', 'contact_no', 'contact_number', 'email_id', 'gst_no', 'gst_number', 'gstin/uin', 'billing_address', 'address_line_1', 'place_of_supply', 'pin', 'pin_code', 'zip', 'postal_code', 'credit_limit_amount']
};

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
const longDate = (iso) => formatDate(iso);
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
  const tr = useT();
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
    <Modal title={isEdit ? `Edit ${initial.name}` : tr('Add a customer')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-6">
        <Alert>{error}</Alert>
        <fieldset className="space-y-4">
          <legend className={legend}>{tr('Contact')}</legend>
          <Field id="c-name" label={tr('Name')}><Input id="c-name" value={form.name} onChange={set('name')} required autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="c-phone" label={tr('Mobile')} hint={tr('Finds them at the counter and on their loyalty card')}><Input id="c-phone" type="tel" inputMode="tel" value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field id="c-email" label={tr('Email (optional)')}><Input id="c-email" type="email" value={form.email || ''} onChange={set('email')} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className={legend}>{tr('For GST bills')} <span className="font-normal normal-case tracking-normal text-ink-400">{tr('· only for business customers')}</span></legend>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field id="c-gstin" label={tr('GSTIN')}><Input id="c-gstin" value={form.gstin || ''} onChange={set('gstin')} maxLength={15} className="uppercase" /></Field>
            <Field id="c-pincode" label={tr('Pincode')}><Input id="c-pincode" inputMode="numeric" value={form.pincode || ''} onChange={set('pincode')} maxLength={6} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field id="c-address" label={tr('Address')}><Input id="c-address" value={form.address || ''} onChange={set('address')} /></Field>
            <Field id="c-state" label={tr('State')} hint={tr('Decides CGST + SGST or IGST')}><Input id="c-state" value={form.state || ''} onChange={set('state')} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className={legend}>{tr('Credit')}</legend>
          <div className="sm:w-1/2">
            <Field id="c-credit" label={tr('Credit limit (₹)')} hint="A warning only; nothing is blocked. 0 means no limit.">
              <Input id="c-credit" type="number" min="0" step="0.01" value={form.credit_limit} onChange={set('credit_limit')} />
            </Field>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : isEdit ? tr('Save changes') : tr('Add customer')}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* ── One customer ─────────────────────────────────────────────────────── */

const Stat = StatCard;

const BillRow = ({ bill }) => {
  const tr = useT();
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
          {!cancelled && bill.balance_due > 0 && <span className="tabular block text-caption font-medium text-warning">{tr('{{formatCurrency}} due', { formatCurrency: formatCurrency(bill.balance_due) })}</span>}
        </span>
        <span className="w-20 shrink-0 text-right"><StatusBadge status={cancelled ? 'CANCELLED' : bill.payment_status} /></span>
      </Link>
    </li>
  );
};

const CustomerPanel = ({ customer: c, onEdit, onBack }) => {
  const tr = useT();
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
        <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900 xl:hidden"><ArrowLeft className="h-4 w-4" />{tr('All customers')}</button>
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
          <Button size="sm" to={`/app/billing?customer=${c.customer_id}`}>{tr('New bill')}</Button>
          <Button size="sm" variant="secondary" onClick={onEdit}>{tr('Edit details')}</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <Alert>{error}</Alert>

        <div className="grid grid-cols-2 gap-2">
          <Stat label={tr('Spent with you')} value={formatCurrency(c.total_purchases)} note={c.first_bill_date ? `since ${longDate(c.first_bill_date)}` : undefined} />
          <Stat label={tr('Bills')} value={c.bills} note={c.bills ? `${formatCurrency(c.total_purchases / c.bills)} a bill on average` : undefined} />
          <Stat label={tr('Last bill')} value={ago(c.last_bill_date)} note={c.last_bill_date ? longDate(c.last_bill_date) : undefined} />
          <Stat label={tr('Owes you')} value={formatCurrency(c.outstanding_balance)} note={c.credit_limit > 0 ? `limit ${formatCurrency(c.credit_limit)}` : undefined} />
        </div>

        {unpaid.length > 0 && (
          <section aria-label={tr('Unpaid bills')} className={`rounded-(--radius-card) border ${overLimit ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}>
            <div className="px-4 pt-3.5">
              <p className={`text-small font-semibold ${overLimit ? 'text-danger' : 'text-ink-900'}`}>
                {formatCurrency(c.outstanding_balance)} unpaid on {unpaid.length} bill{unpaid.length === 1 ? '' : 's'}
                {overLimit && ` · over their ${formatCurrency(c.credit_limit)} limit`}
              </p>
              <p className="mt-0.5 text-caption text-ink-500">{tr('Open a bill to record a payment against it.')}</p>
            </div>
            <ul className="mt-2 divide-y divide-line/70 border-t border-line/70">{unpaid.map((b) => <BillRow key={b.invoice_id} bill={b} />)}</ul>
          </section>
        )}

        {(loyalty?.loyalty || pts) && (
          <section aria-label={tr('Loyalty')}>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{tr('Loyalty')}</h3>
            <div className="space-y-2">
              {loyalty.loyalty && <LoyaltyCard card={loyalty.loyalty} />}
              {pts && (
                <div className="rounded-lg border border-line bg-surface-2 p-3.5 text-small text-ink-700">
                  <p><strong className="tabular text-ink-900">{tr('{{balance}} points', { balance: pts.balance })}</strong> <span className="tabular">{tr('worth {{formatCurrency}}', { formatCurrency: formatCurrency(pts.balance_value) })}</span>{pts.tier && <> · <span className="font-semibold text-brand-700">{pts.tier.name}</span></>}</p>
                  {pts.next_tier && <p className="mt-0.5 text-caption text-ink-500">{tr('{{points_needed}} more points to {{next_tier_name}}.', { points_needed: pts.next_tier.points_needed, next_tier_name: pts.next_tier.name })}</p>}
                </div>
              )}
            </div>
          </section>
        )}

        <section aria-label={tr('Bills')}>
          <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">Bills {bills && <span className="tabular font-normal">· {bills.length}{bills.length === 100 ? '+' : ''}</span>}</h3>
          {!bills && !error && <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" />}
          {bills?.length === 0 && <p className="rounded-(--radius-card) border border-dashed border-line-strong p-6 text-center text-small text-ink-500">{tr('No bills yet. Pick them on a bill and it shows here.')}</p>}
          {bills?.length > 0 && (
            <div className="overflow-hidden rounded-(--radius-card) border border-line bg-surface">
              <ul className="divide-y divide-line">{shown.map((b) => <BillRow key={b.invoice_id} bill={b} />)}</ul>
              {!showAll && bills.length > 10 && <button type="button" onClick={() => setShowAll(true)} className="w-full border-t border-line py-2.5 text-small font-medium text-brand-700 hover:bg-surface-2">{tr('Show all {{bills_length}}', { bills_length: bills.length })}</button>}
            </div>
          )}
        </section>

        {(c.gstin || c.address || c.state || c.pincode) && (
          <section aria-label={tr('GST details')}>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{tr('For GST bills')}</h3>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-small">
              {c.gstin && <><dt className="text-ink-500">{tr('GSTIN')}</dt><dd className="font-medium text-ink-900">{c.gstin}</dd></>}
              {c.address && <><dt className="text-ink-500">{tr('Address')}</dt><dd className="text-ink-900">{c.address}</dd></>}
              {(c.state || c.pincode) && <><dt className="text-ink-500">{tr('State')}</dt><dd className="text-ink-900">{[c.state, c.pincode].filter(Boolean).join(' · ')}</dd></>}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
};

/* ── The screen ───────────────────────────────────────────────────────── */

const CustomerRow = ({ c, active, onOpen }) => {
  const tr = useT();
  return (
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
        {c.outstanding_balance > 0 && <span className="tabular block text-caption font-medium text-warning">{tr('owes {{formatCurrency}}', { formatCurrency: formatCurrency(c.outstanding_balance) })}</span>}
      </span>
    </button>
  </li>
);
};

const CustomersPage = () => {
  const tr = useT();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('c') ? Number(params.get('c')) : null;
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);

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
      <section aria-label={tr('Customer list')} className={`min-w-0 flex-col p-4 sm:p-6 lg:p-8 xl:flex xl:overflow-hidden ${selectedId ? 'hidden' : 'flex'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-ink-900">{tr('Customers')}</h1>
            <p className="tabular mt-1 text-small text-ink-500">
              {customers ? <>{customers.length} customer{customers.length === 1 ? '' : 's'}{owed > 0 && <> · <span className="font-medium text-warning">{tr('{{formatCurrency}} owed by {{owes}}', { formatCurrency: formatCurrency(owed), owes: counts.owes })}</span></>}</> : tr('Who buys from you, and what they owe.')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" />{tr('Import customers')}</Button>
            <Button onClick={() => setEditing({})}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add customer')}</Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <span className="sr-only">{tr('Search customers')}</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Name, mobile, email or GSTIN')} className="!pl-9" />
          </label>
          <Select aria-label={tr('Sort by')} value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto">
            {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{tr(label)}</option>)}
          </Select>
        </div>
        <div role="group" aria-label={tr('Show')} className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-small font-medium ${filter === key ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-strong bg-surface text-ink-700 hover:border-ink-400'}`}>
              {tr(label)} <span className={`tabular ml-1 ${filter === key ? 'text-white/70' : 'text-ink-400'}`}>{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 xl:overflow-y-auto">
          <Alert>{error}</Alert>
          {!customers && !error && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-3" />)}</div>}
          {customers?.length === 0 && (
            <div className="rounded-(--radius-card) border border-dashed border-line-strong p-10 text-center">
              <p className="text-body font-medium text-ink-900">{tr('No customers yet')}</p>
              <p className="mt-1 text-small text-ink-500">{tr('Add them here, or type a mobile number on a bill at the counter.')}</p>
              <Button className="mt-4" onClick={() => setEditing({})}>{tr('Add the first customer')}</Button>
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

      <section aria-label={tr('Selected customer')} className={`min-h-0 min-w-0 flex-col border-line bg-surface xl:flex xl:border-l ${selectedId ? 'flex min-h-[calc(100vh-3.5rem)] xl:min-h-0' : 'hidden'}`}>
        {selected ? (
          <CustomerPanel key={selected.customer_id} customer={selected} onEdit={() => setEditing(selected)} onBack={() => open(null)} />
        ) : selectedId && customers ? (
          <div className="p-8 text-center text-small text-ink-500">{tr('That customer isn\'t in this list.')} <button type="button" onClick={() => open(null)} className="font-medium text-brand-700">{tr('Back to all')}</button></div>
        ) : (
          <EmptyState compact icon={UserRound} className="h-full justify-center" title={tr('Pick a customer')} body={tr('See their bills, loyalty and what they owe.')} />
        )}
      </section>

      {importing && (
        <CsvImportModal kind="customers" title={tr('Import customers')} endpoint="/customers/import" allowUpdate={false} template={IMPORT} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }}>
          <p className="text-caption text-ink-500">{tr('Customers already here (same phone, or same name when there is no phone) are skipped. What a customer owes comes from their unpaid bills, so it is not imported.')}</p>
        </CsvImportModal>
      )}
      {editing && (
        <CustomerForm
          initial={editing.customer_id ? { ...editing, credit_limit: editing.credit_limit ? String(editing.credit_limit) : '' } : emptyForm}
          onClose={() => setEditing(null)}
          onSaved={(saved) => { const isNew = !editing.customer_id; setEditing(null); toast.success(isNew ? `${saved.name} added` : tr('Saved')); load(); if (isNew) open(saved.customer_id); }}
        />
      )}
    </div>
  );
};

export default CustomersPage;
