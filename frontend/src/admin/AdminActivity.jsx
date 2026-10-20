/*
 * The platform activity log: who changed what, across every business, newest first. Filter by action word, business number or dates.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Input, Table, Thead, Th, Td, Tr, ListState, SkeletonRows, Button } from '../components/ui.jsx';

const AdminActivity = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ action: '', business_id: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), page_size: '50' });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    const t = setTimeout(() => adminApi(`/audit?${q}`).then((d) => { setError(''); setData(d); }).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [f, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      <PageHeader title="Activity" lead="Everything that was changed, across all businesses." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-48"><Input placeholder="Action, e.g. trial" value={f.action} onChange={set('action')} aria-label="Action" /></div>
        <div className="w-36"><Input placeholder="Business number" inputMode="numeric" value={f.business_id} onChange={set('business_id')} aria-label="Business number" /></div>
        <div className="w-40"><Input type="date" value={f.from} onChange={set('from')} aria-label="From date" /></div>
        <div className="w-40"><Input type="date" value={f.to} onChange={set('to')} aria-label="To date" /></div>
      </div>
      <ListState loading={!data && !error} error={error} empty={data?.events.length === 0} emptyLabel="Nothing matches." skeleton={<SkeletonRows rows={8} columns={5} />} />
      {data?.events.length > 0 && (
        <Table>
          <Thead><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Business</Th><Th>Details</Th></Thead>
          <tbody>
            {data.events.map((e) => (
              <Tr key={e.audit_id}>
                <Td className="whitespace-nowrap text-xs">{new Date(e.created_at).toLocaleString()}</Td>
                <Td>{e.user_name || '—'}<p className="text-xs text-ink-400">{e.user_email}</p></Td>
                <Td className="font-mono text-xs">{e.action}</Td>
                <Td>{e.business_id ? <Link className="text-brand-600 hover:underline" to={`/superadmin/businesses/${e.business_id}`}>{e.business_name || `#${e.business_id}`}</Link> : '—'}</Td>
                <Td className="max-w-xs truncate text-xs text-ink-500" title={JSON.stringify(e.metadata)}>{e.resource_type ? `${e.resource_type} ${e.resource_id ?? ''} ` : ''}{Object.keys(e.metadata || {}).length ? JSON.stringify(e.metadata) : ''}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span>Page {page} of {pages} · {data.total} events</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
};

export default AdminActivity;
