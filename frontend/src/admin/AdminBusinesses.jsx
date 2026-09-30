/*
 * Every tenant on the platform, searchable, with the one lever a support
 * situation actually needs day to day: suspend / reactivate.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
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
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    adminApi(`/businesses?${params.toString()}`)
      .then((data) => setBusinesses(data.businesses))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    const timer = setTimeout(load, 250); // debounce the search box
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

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
                  <p className="text-xs text-ink-400">{b.business_type}</p>
                </Td>
                <Td>
                  <p>{b.owner.name}</p>
                  <p className="text-xs text-ink-400">{b.owner.email}</p>
                </Td>
                <Td>{b.subscription.plan_code}</Td>
                <Td><StatusBadge status={b.subscription.status} /></Td>
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
    </div>
  );
};

export default AdminBusinesses;
