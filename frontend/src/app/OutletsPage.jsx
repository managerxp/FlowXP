/*
 * Outlets: the places this business trades from, and how they compare.
 * Each outlet has its own tables, stock, orders and staff; the menu is shared.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const EMPTY = { name: '', code: '', city: '', state: '', phone: '', address: '', gstin: '', pincode: '', invoice_prefix: '', invoice_next_number: '' };

const OutletForm = ({ outlet, onSaved, onClose }) => {
  const tr = useT();
  const [form, setForm] = useState(outlet ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, outlet[k] ?? ''])) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(outlet ? `/outlets/${outlet.branch_id}` : '/outlets', { method: outlet ? 'PUT' : 'POST', body: { ...form, invoice_next_number: form.invoice_prefix && form.invoice_next_number !== '' ? Number(form.invoice_next_number) : undefined } });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={outlet ? `Edit ${outlet.name}` : tr('Add outlet')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field id="o-name" label={tr('Outlet name')}><Input id="o-name" value={form.name} onChange={set('name')} placeholder={tr('e.g. Indiranagar')} required autoFocus /></Field></div>
          <Field id="o-code" label={tr('Short code')} hint={tr('Optional')}><Input id="o-code" value={form.code} onChange={set('code')} maxLength={12} placeholder={tr('IND')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="o-city" label={tr('City')}><Input id="o-city" value={form.city} onChange={set('city')} /></Field>
          <Field id="o-state" label={tr('State')} hint={tr('Decides GST place of supply for this outlet.')}><Input id="o-state" value={form.state} onChange={set('state')} /></Field>
          <Field id="o-phone" label={tr('Phone')}><Input id="o-phone" value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field id="o-address" label={tr('Address')}><Input id="o-address" value={form.address} onChange={set('address')} /></Field></div>
          <Field id="o-pin" label={tr('Pincode')} hint={tr('For GST e-invoices and e-way bills')}><Input id="o-pin" inputMode="numeric" value={form.pincode} onChange={set('pincode')} maxLength={6} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="o-prefix" label={tr('Invoice prefix')} hint={tr('Optional. Gives this outlet its own numbers (IND-0001). Empty uses the business-wide series.')}><Input id="o-prefix" value={form.invoice_prefix} onChange={set('invoice_prefix')} maxLength={12} placeholder={tr('IND')} /></Field>
          {form.invoice_prefix && (
            <Field id="o-next" label={tr('Next number')} hint={outlet ? tr('Never lower than numbers already issued.') : tr('Starts at 1 unless you say otherwise.')}><Input id="o-next" type="number" min="1" value={form.invoice_next_number} onChange={set('invoice_next_number')} placeholder={outlet ? String(outlet.invoice_next_number) : '1'} /></Field>
          )}
        </div>
        <Field id="o-gstin" label={tr('GSTIN')} hint={tr('Only if this outlet has its own registration.')}><Input id="o-gstin" value={form.gstin} onChange={set('gstin')} maxLength={15} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : outlet ? tr('Save changes') : tr('Add outlet')}</Button>
        </div>
      </form>
    </Modal>
  );
};

const OutletList = () => {
  const tr = useT();
  const { refresh } = useAuth();
  const [outlets, setOutlets] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // {} = new, outlet = edit

  const load = () => api('/outlets?include_closed=true').then(setOutlets).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const saved = () => { setEditing(null); load(); refresh(); };

  const setStatus = async (outlet, status) => {
    setError('');
    try { await api(`/outlets/${outlet.branch_id}`, { method: 'PUT', body: { status } }); saved(); }
    catch (caught) { setError(caught.message); }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}>{tr('Add outlet')}</Button></div>
      <Alert>{error}</Alert>
      <ListState loading={!outlets && !error} empty={outlets?.length === 0} emptyLabel={tr('No outlets yet.')} />
      {outlets?.length > 0 && (
        <Table>
          <Thead><Th>{tr('Outlet')}</Th><Th>{tr('Location')}</Th><Th>{tr('GSTIN')}</Th><Th>{tr('Invoice series')}</Th><Th>{tr('Status')}</Th><Th></Th></Thead>
          <tbody>
            {outlets.map((o) => (
              <Tr key={o.branch_id}>
                <Td className="font-medium">{o.name} {o.code && <span className="text-xs text-ink-400">· {o.code}</span>} {o.is_primary && <Badge tone="brand">{tr('Main')}</Badge>}</Td>
                <Td className="text-ink-500">{[o.city, o.state].filter(Boolean).join(', ') || '—'}</Td>
                <Td className="text-ink-500">{o.gstin || 'Business GSTIN'}</Td>
                <Td className="text-ink-500">{o.invoice_prefix ? `${o.invoice_prefix}-${String(o.invoice_next_number).padStart(4, '0')} next` : tr('Business series')}</Td>
                <Td>{o.status === 'ACTIVE' ? <Badge tone="success">{tr('Open')}</Badge> : <Badge tone="neutral">{tr('Closed')}</Badge>}</Td>
                <Td className="space-x-3 text-right">
                  <button onClick={() => setEditing(o)} className="text-xs font-semibold text-brand-600">{tr('Edit')}</button>
                  {!o.is_primary && (o.status === 'ACTIVE'
                    ? <button onClick={() => setStatus(o, 'CLOSED')} className="text-xs font-semibold text-danger">{tr('Close')}</button>
                    : <button onClick={() => setStatus(o, 'ACTIVE')} className="text-xs font-semibold text-brand-600">{tr('Reopen')}</button>)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-ink-400">{tr('Closing an outlet needs its stock moved out and its open orders settled first.')}</p>
      {editing && <OutletForm outlet={editing.branch_id ? editing : null} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
};

const RANGES = [{ days: 7, label: T('7 days') }, { days: 30, label: T('30 days') }, { days: 90, label: T('90 days') }];

const Compare = () => {
  const tr = useT();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api(`/outlets/compare?from=${daysAgoISO(days - 1)}&to=${daysAgoISO(0)}`).then(setData)
      .catch((e) => setError(e.status === 403 ? tr('Comparing outlets is for owners and group managers.') : e.message));
  }, [days]);

  const rows = data?.outlets ?? [];
  const traded = rows.filter((r) => r.orders > 0);
  const best = (key, dir) => {
    const withValue = traded.filter((r) => r[key] != null);
    if (withValue.length < 2) return null;
    return withValue.reduce((a, b) => ((dir === 'max' ? b[key] > a[key] : b[key] < a[key]) ? b : a)).branch_id;
  };
  const tone = (row, key, dir, worstDir) => {
    if (best(key, dir) === row.branch_id) return 'font-semibold text-success';
    if (best(key, worstDir) === row.branch_id) return 'font-semibold text-warning';
    return '';
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.days} type="button" onClick={() => setDays(r.days)} aria-pressed={days === r.days}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${days === r.days ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>{tr('Last {{label}}', { label: r.label })}</button>
        ))}
      </div>
      <Alert>{error}</Alert>
      {!data && !error && <p className="py-10 text-center text-sm text-ink-400">{tr('Adding up each outlet…')}</p>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{tr('Net revenue')}</p><p className="mt-1 text-xl font-bold text-ink-900">{formatCurrency(data.totals.net_revenue)}</p></Card>
            <Card><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{tr('Orders')}</p><p className="mt-1 text-xl font-bold text-ink-900">{data.totals.orders}</p></Card>
            <Card><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{tr('Estimated net')}</p><p className="mt-1 text-xl font-bold text-ink-900">{formatCurrency(data.totals.estimated_net)}</p></Card>
          </div>
          <div className="mt-6">
            <Table>
              <Thead>
                <Th>{tr('Outlet')}</Th><Th className="text-right">{tr('Orders')}</Th><Th className="text-right">{tr('Net revenue')}</Th><Th className="text-right">{tr('Avg order')}</Th>
                <Th className="text-right">{tr('Food cost')}</Th><Th className="text-right">{tr('Contribution')}</Th><Th className="text-right">{tr('Discounts')}</Th><Th className="text-right">{tr('Wastage')}</Th><Th className="text-right">{tr('Estimated net')}</Th>
              </Thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.branch_id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="text-right">{r.orders}</Td>
                    <Td className={`text-right ${tone(r, 'net_revenue', 'max', 'min')}`}>{formatCurrency(r.net_revenue)}</Td>
                    <Td className="text-right">{r.average_order != null ? formatCurrency(r.average_order) : '—'}</Td>
                    <Td className={`text-right ${tone(r, 'food_cost_pct', 'min', 'max')}`}>{r.food_cost_pct != null ? `${r.food_cost_pct}%` : '—'}</Td>
                    <Td className="text-right">{formatCurrency(r.contribution)}</Td>
                    <Td className={`text-right ${tone(r, 'discount_pct', 'min', 'max')}`}>{r.discount_pct != null ? `${r.discount_pct}%` : '—'}</Td>
                    <Td className="text-right">{formatCurrency(r.wastage)}</Td>
                    <Td className="text-right">{formatCurrency(r.estimated_net)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-ink-400">Green is the best outlet on that measure, amber the weakest. Figures are estimates from recorded sales, costs and the assumptions in Profitability; expenses are counted where they were entered.</p>
          </div>
        </>
      )}
    </div>
  );
};

const OutletsPage = () => {
  const tr = useT();
  const [tab, setTab] = useState('outlets');
  return (
    <div>
      <PageHeader title={tr('Outlets')} lead="Every place you trade from. The menu is shared; stock, tables, orders and staff belong to each outlet." />
      <div className="mb-6 flex gap-2" role="tablist">
        {[['outlets', T('Outlets')], ['compare', T('Compare')]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-700 hover:bg-surface-2'}`}>{tr(label)}</button>
        ))}
      </div>
      {tab === 'outlets' ? <OutletList /> : <Compare />}
    </div>
  );
};

export default OutletsPage;
