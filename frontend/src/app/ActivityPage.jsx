/*
 * The activity log: who did what, where and when, in plain sentences. For the
 * people who manage the business; filter by person, area, outlet and dates.
 */
import { useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Input, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const TONE = { sales: 'brand', stock: 'neutral', menu: 'neutral', money: 'warning', customers: 'neutral', team: 'danger', oversight: 'neutral', other: 'neutral' };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const ActivityPage = () => {
  const { outlets, pinned, business } = useAuth();
  const [people, setPeople] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ user_id: '', category: '', outlet: '', q: '', from: daysAgoISO(6), to: daysAgoISO(0) });
  const [entries, setEntries] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const query = (extra = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v);
    return p.toString();
  };

  const load = async (more = false) => {
    setBusy(true); setError('');
    try {
      const data = await api(`/audit?${query(more && next ? { before: next } : {})}`);
      setEntries((prev) => (more && prev ? [...prev, ...data.entries] : data.entries));
      setNext(data.next);
      if (!categories.length) setCategories(data.categories);
    } catch (caught) { setError(caught.status === 403 ? 'The activity log is for owners and admins.' : caught.message); }
    finally { setBusy(false); }
  };

  useEffect(() => { api('/staff').then(setPeople).catch(() => {}); }, []);
  useEffect(() => { load(); }, [filters.user_id, filters.category, filters.outlet, filters.from, filters.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const canExport = ['OWNER', 'ADMIN'].includes(business?.role);
  const exportCsv = async () => {
    try { await downloadFile(`/audit?${query({ format: 'csv' })}`, `activity-${filters.from}-to-${filters.to}.csv`); }
    catch (caught) { setError(caught.message); }
  };

  return (
    <div>
      <PageHeader
        title="Activity log"
        lead="Who did what, and when. Everything that changes money, stock, the menu or the team is recorded here."
        action={canExport && <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Select aria-label="Person" value={filters.user_id} onChange={set('user_id')}>
          <option value="">Everyone</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </Select>
        <Select aria-label="Area" value={filters.category} onChange={set('category')}>
          <option value="">All areas</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
        {!pinned && outlets.length > 1 && (
          <Select aria-label="Outlet" value={filters.outlet} onChange={set('outlet')}>
            <option value="">All outlets</option>{outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
          </Select>
        )}
        <Input type="date" aria-label="From" value={filters.from} max={filters.to} onChange={set('from')} />
        <Input type="date" aria-label="To" value={filters.to} min={filters.from} onChange={set('to')} />
        <form onSubmit={(e) => { e.preventDefault(); load(); }}><Input placeholder="Search…" value={filters.q} onChange={set('q')} /></form>
      </div>

      <Alert>{error}</Alert>
      {!entries && !error && <p className="py-10 text-center text-sm text-ink-400">Loading…</p>}
      {entries?.length === 0 && <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-400">Nothing recorded for these filters.</p>}

      {entries?.length > 0 && (
        <>
          <Table>
            <Thead><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Outlet</Th></Thead>
            <tbody>
              {entries.map((e) => (
                <Tr key={e.audit_id}>
                  <Td className="whitespace-nowrap text-ink-500">{when(e.at)}</Td>
                  <Td className="whitespace-nowrap font-medium">{e.user}{e.role && <span className="block text-xs font-normal text-ink-400">{e.role.toLowerCase().replace('_', ' ')}</span>}</Td>
                  <Td><span className="mr-2"><Badge tone={TONE[e.category]}>{categories.find((c) => c.key === e.category)?.label ?? 'Other'}</Badge></span>{e.summary}</Td>
                  <Td className="text-ink-500">{e.outlet || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex justify-center">
            {next ? <Button variant="secondary" onClick={() => load(true)} disabled={busy}>{busy ? 'Loading…' : 'Show older'}</Button> : <p className="text-xs text-ink-400">That’s everything for these dates.</p>}
          </div>
        </>
      )}
    </div>
  );
};

export default ActivityPage;
