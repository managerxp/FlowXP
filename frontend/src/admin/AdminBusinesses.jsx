/*
 * Every tenant on the platform, searchable, with the one lever a support
 * situation actually needs day to day: suspend / reactivate.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { BUSINESS_TYPE_LABEL } from './businessTypes.js';
import {
  PageHeader, Input, Select, Table, Thead, Th, Td, Tr, ListState,
  SkeletonRows, StatusBadge, Badge, Button
} from '../components/ui.jsx';

const STATUS_TONE = { ACTIVE: 'success', SUSPENDED: 'danger', CLOSED: 'neutral' };

const AdminBusinesses = () => {
  const [businesses, setBusinesses] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [sub, setSub] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const PAGE_SIZE = 25;

  const query = (p, size) => {
    const params = new URLSearchParams({ page: String(p), page_size: String(size) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (sub) params.set('subscription_status', sub);
    return params.toString();
  };
  const load = () => {
    adminApi(`/businesses?${query(page, PAGE_SIZE)}`)
      .then((data) => { setBusinesses(data.businesses); setTotal(data.total); setError(''); })
      .catch((err) => setError(err.message));
  };

  useEffect(() => { setPage(1); }, [search, status, type, sub]);
  useEffect(() => {
    const timer = setTimeout(load, 250); // debounce the search box
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, type, sub, page]);

  /* every business matching the filters, as a spreadsheet file (a quoted cell never breaks the row) */
  const exportCsv = async () => {
    try {
      const rows = [];
      for (let p = 1; p <= 50; p++) {
        const d = await adminApi(`/businesses?${query(p, 100)}`);
        rows.push(...d.businesses);
        if (rows.length >= d.total) break;
      }
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Business', 'Type', 'Owner', 'Owner email', 'Plan', 'Subscription', 'Trial ends', 'Status', 'Created'].map(cell).join(',')];
      for (const b of rows) lines.push([b.name, BUSINESS_TYPE_LABEL[b.business_type] || b.business_type, b.owner.name, b.owner.email, b.subscription.plan_code, b.subscription.status, b.subscription.trial_ends_at ? b.subscription.trial_ends_at.slice(0, 10) : '', b.status, String(b.created_at).slice(0, 10)].map(cell).join(','));
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = 'flowxp-businesses.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleStatus = async (business) => {
    const next = business.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    setBusyId(business.business_id);
    try {
      await adminApi(`/businesses/${business.business_id}/status`, { method: 'PATCH', body: { status: next } });
      setBusinesses((rows) => rows.map((b) => (b.business_id === business.business_id ? { ...b, status: next } : b)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Businesses" lead="Every FlowXP tenant, across every plan." />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full max-w-xs">
          <Input placeholder="Search by business, owner name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>
        <div className="w-48">
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Business type">
            <option value="">All business types</option>
            {Object.entries(BUSINESS_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Subscription">
            <option value="">All subscriptions</option>
            {['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'].map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
          </Select>
        </div>
        <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
      </div>

      <ListState
        loading={!businesses && !error}
        error={error}
        empty={businesses?.length === 0}
        emptyLabel="No businesses match this filter."
        skeleton={<SkeletonRows rows={6} columns={5} />}
      />

      {businesses?.length > 0 && (
        <Table>
          <Thead>
            <Th>Business</Th>
            <Th>Owner</Th>
            <Th>Plan</Th>
            <Th>Subscription</Th>
            <Th>Trial ends</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </Thead>
          <tbody>
            {businesses.map((b) => (
              <Tr key={b.business_id}>
                <Td>
                  <Link to={`/superadmin/businesses/${b.business_id}`} className="font-semibold text-brand-600 hover:underline">
                    {b.name}
                  </Link>
                  <p className="text-xs text-ink-400">{BUSINESS_TYPE_LABEL[b.business_type] || b.business_type}</p>
                </Td>
                <Td>
                  <p>{b.owner.name}</p>
                  <p className="text-xs text-ink-400">{b.owner.email}</p>
                </Td>
                <Td>{b.subscription.plan_code}</Td>
                <Td><StatusBadge status={b.subscription.status} /></Td>
                <Td className="text-xs">{b.subscription.status === 'TRIAL' && b.subscription.trial_ends_at ? `${new Date(b.subscription.trial_ends_at).toLocaleDateString()} (${b.subscription.trial_days_remaining} d)` : '—'}</Td>
                <Td><Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge></Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant={b.status === 'SUSPENDED' ? 'secondary' : 'ghost'}
                    disabled={busyId === b.business_id || b.status === 'CLOSED'}
                    onClick={() => toggleStatus(b)}
                  >
                    {b.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages} · {total} businesses</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

export default AdminBusinesses;
