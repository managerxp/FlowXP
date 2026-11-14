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

const rs = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const ATTENTION = [['', 'All'], ['trial_ending', 'Trial ends in 7 days'], ['expired', 'Expired'], ['low_credit', 'Low WhatsApp credit'], ['unpaid', 'Unpaid invoice'], ['followup_due', 'Follow-up due'], ['quiet', 'No bills in 14 days']];
const ago = (d) => { if (!d) return 'Never'; const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`; };
const STATUS_TONE = { ACTIVE: 'success', SUSPENDED: 'danger', CLOSED: 'neutral' };

const AdminBusinesses = () => {
  const [businesses, setBusinesses] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [sub, setSub] = useState('');
  const [attention, setAttention] = useState('');
  const [tag, setTag] = useState('');
  const [counts, setCounts] = useState({});
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
    if (attention) params.set('attention', attention);
    if (tag) params.set('tag', tag.trim().toLowerCase());
    return params.toString();
  };
  const load = () => {
    adminApi(`/businesses?${query(page, PAGE_SIZE)}`)
      .then((data) => { setBusinesses(data.businesses); setTotal(data.total); setCounts(data.attention || {}); setError(''); })
      .catch((err) => setError(err.message));
  };

  useEffect(() => { setPage(1); }, [search, status, type, sub, attention, tag]);
  useEffect(() => {
    const timer = setTimeout(load, 250); // debounce the search box
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, type, sub, attention, tag, page]);

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
      const lines = [['Business', 'Type', 'Owner', 'Owner email', 'Plan', 'Subscription', 'Trial ends', 'Phone', 'WhatsApp credit (Rs)', 'WhatsApp sent (30 days)', 'Last bill', 'Unpaid invoices (Rs)', 'Status', 'Created'].map(cell).join(',')];
      for (const b of rows) lines.push([b.name, BUSINESS_TYPE_LABEL[b.business_type] || b.business_type, b.owner.name, b.owner.email, b.subscription.plan_code, b.subscription.status, b.subscription.trial_ends_at ? b.subscription.trial_ends_at.slice(0, 10) : '', b.phone || '', b.wallet_paise / 100, b.wa_sent_30d, b.last_bill_at ? String(b.last_bill_at).slice(0, 10) : '', b.unpaid_paise / 100, b.status, String(b.created_at).slice(0, 10)].map(cell).join(','));
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
      <PageHeader title="Clients" lead="Every FlowXP client in one place: who to follow up, who to bill, who is running low on WhatsApp credit." />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Needs attention">
        {ATTENTION.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setAttention(key)} aria-pressed={attention === key}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${attention === key ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>
            {label}{key && counts[key] ? <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs font-semibold text-white">{counts[key]}</span> : null}
          </button>
        ))}
      </div>

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
        <div className="w-36"><Input placeholder="Tag, e.g. vip" aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)} /></div>
        <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
      </div>

      <ListState
        loading={!businesses && !error}
        error={error}
        empty={businesses?.length === 0}
        emptyLabel="No businesses match this filter."
        skeleton={<SkeletonRows rows={6} columns={8} />}
      />

      {businesses?.length > 0 && (
        <Table>
          <Thead>
            <Th>Business</Th>
            <Th>Owner</Th>
            <Th>Plan</Th>
            <Th>Subscription</Th>
            <Th>Trial ends</Th>
            <Th className="text-right">WhatsApp credit</Th>
            <Th>Last bill</Th>
            <Th className="text-right">Unpaid</Th>
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
                  {(b.tags?.length > 0 || b.follow_up_on) && (
                    <p className="mt-1 flex flex-wrap items-center gap-1">
                      {b.tags.map((t) => <button key={t} type="button" onClick={() => setTag(t)} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 hover:bg-brand-100">{t}</button>)}
                      {b.follow_up_on && <span className={`text-xs ${b.follow_up_on <= new Date().toLocaleDateString('en-CA') ? 'font-semibold text-danger' : 'text-ink-500'}`} title={b.follow_up_note || ''}>Follow up {new Date(b.follow_up_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                    </p>
                  )}
                </Td>
                <Td>
                  <p>{b.owner.name}</p>
                  <p className="text-xs text-ink-400">{b.owner.email}</p>
                  {b.phone && <p className="text-xs text-ink-400">{b.phone}</p>}
                </Td>
                <Td>{b.subscription.plan_code}</Td>
                <Td><StatusBadge status={b.subscription.status} /></Td>
                <Td className="text-xs">{b.subscription.status === 'TRIAL' && b.subscription.trial_ends_at ? `${new Date(b.subscription.trial_ends_at).toLocaleDateString()} (${b.subscription.trial_days_remaining} d)` : '—'}</Td>
                <Td className="text-right text-xs"><p className={b.wallet_paise < 2000 && b.subscription.status === 'ACTIVE' ? 'font-semibold text-danger' : ''}>{rs(b.wallet_paise)}</p><p className="text-ink-400">{b.wa_sent_30d} sent in 30 days</p></Td>
                <Td className="text-xs">{ago(b.last_bill_at)}</Td>
                <Td className="text-right text-xs">{b.unpaid_paise > 0 ? <span className="font-semibold text-danger">{rs(b.unpaid_paise)}</span> : '—'}</Td>
                <Td><Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge></Td>
                <Td className="text-right whitespace-nowrap">
                  <Link to={`/superadmin/invoices?client=${b.business_id}`} className="mr-2 text-xs font-semibold text-brand-600 hover:underline">Invoice</Link>
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
