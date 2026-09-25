/*
 * Outlets: the places this business trades from, and how they compare.
 * Each outlet has its own tables, stock, orders and staff; the menu is shared.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const EMPTY = { name: '', code: '', city: '', state: '', phone: '', address: '', gstin: '' };

const OutletForm = ({ outlet, onSaved, onClose }) => {
  const [form, setForm] = useState(outlet ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, outlet[k] ?? ''])) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api(outlet ? `/outlets/${outlet.branch_id}` : '/outlets', { method: outlet ? 'PUT' : 'POST', body: form });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={outlet ? `Edit ${outlet.name}` : 'Add outlet'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field id="o-name" label="Outlet name"><Input id="o-name" value={form.name} onChange={set('name')} placeholder="e.g. Indiranagar" required autoFocus /></Field></div>
          <Field id="o-code" label="Short code" hint="Optional"><Input id="o-code" value={form.code} onChange={set('code')} maxLength={12} placeholder="IND" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="o-city" label="City"><Input id="o-city" value={form.city} onChange={set('city')} /></Field>
          <Field id="o-state" label="State" hint="Decides GST place of supply for this outlet."><Input id="o-state" value={form.state} onChange={set('state')} /></Field>
          <Field id="o-phone" label="Phone"><Input id="o-phone" value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <Field id="o-address" label="Address"><Input id="o-address" value={form.address} onChange={set('address')} /></Field>
        <Field id="o-gstin" label="GSTIN" hint="Only if this outlet has its own registration."><Input id="o-gstin" value={form.gstin} onChange={set('gstin')} maxLength={15} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : outlet ? 'Save changes' : 'Add outlet'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const OutletList = () => {
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
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing({})}>Add outlet</Button></div>
      <Alert>{error}</Alert>
      <ListState loading={!outlets && !error} empty={outlets?.length === 0} emptyLabel="No outlets yet." />
      {outlets?.length > 0 && (
        <Table>
          <Thead><Th>Outlet</Th><Th>Location</Th><Th>GSTIN</Th><Th>Status</Th><Th></Th></Thead>
          <tbody>
            {outlets.map((o) => (
              <Tr key={o.branch_id}>
                <Td className="font-medium">{o.name} {o.code && <span className="text-xs text-ink-400">· {o.code}</span>} {o.is_primary && <Badge tone="brand">Main</Badge>}</Td>
                <Td className="text-ink-500">{[o.city, o.state].filter(Boolean).join(', ') || '—'}</Td>
                <Td className="text-ink-500">{o.gstin || 'Business GSTIN'}</Td>
                <Td>{o.status === 'ACTIVE' ? <Badge tone="success">Open</Badge> : <Badge tone="neutral">Closed</Badge>}</Td>
                <Td className="space-x-3 text-right">
                  <button onClick={() => setEditing(o)} className="text-xs font-semibold text-brand-600">Edit</button>
                  {!o.is_primary && (o.status === 'ACTIVE'
                    ? <button onClick={() => setStatus(o, 'CLOSED')} className="text-xs font-semibold text-danger">Close</button>
                    : <button onClick={() => setStatus(o, 'ACTIVE')} className="text-xs font-semibold text-brand-600">Reopen</button>)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-ink-400">Closing an outlet needs its stock moved out and its open orders settled first.</p>
      {editing && <OutletForm outlet={editing.branch_id ? editing : null} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
};

const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }];

const Compare = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setError('');
    api(`/outlets/compare?from=${daysAgoISO(days - 1)}&to=${daysAgoISO(0)}`).then(setData)
      .catch((e) => setError(e.status === 403 ? 'Comparing outlets is for owners and group managers.' : e.message));
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
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${days === r.days ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>Last {r.label}</button>
        ))}
      </div>
      <Alert>{error}</Alert>
      {!data && !error && <p className="py-10 text-center text-sm text-ink-400">Adding up each outlet…</p>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Net revenue</p><p className="mt-1 text-xl font-bold text-ink-900">{formatCurrency(data.totals.net_revenue)}</p></Card>
            <Card><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Orders</p><p className="mt-1 text-xl font-bold text-ink-900">{data.totals.orders}</p></Card>
            <Card><p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Estimated net</p><p className="mt-1 text-xl font-bold text-ink-900">{formatCurrency(data.totals.estimated_net)}</p></Card>
          </div>
          <div className="mt-6">
            <Table>
              <Thead>
                <Th>Outlet</Th><Th className="text-right">Orders</Th><Th className="text-right">Net revenue</Th><Th className="text-right">Avg order</Th>
                <Th className="text-right">Food cost</Th><Th className="text-right">Contribution</Th><Th className="text-right">Discounts</Th><Th className="text-right">Wastage</Th><Th className="text-right">Estimated net</Th>
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
  const [tab, setTab] = useState('outlets');
  return (
    <div>
      <PageHeader title="Outlets" lead="Every place you trade from. The menu is shared; stock, tables, orders and staff belong to each outlet." />
      <div className="mb-6 flex gap-2" role="tablist">
        {[['outlets', 'Outlets'], ['compare', 'Compare']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-surface-2'}`}>{label}</button>
        ))}
      </div>
      {tab === 'outlets' ? <OutletList /> : <Compare />}
    </div>
  );
};

export default OutletsPage;
