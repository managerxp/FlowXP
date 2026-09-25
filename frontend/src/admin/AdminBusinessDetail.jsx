/*
 * One tenant, in full — everything an admin needs to answer a support
 * question without touching psql: who owns it, who else has access, what
 * it's built, what it's paid.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { formatCurrency } from '../lib/api.js';
import { Card, PageHeader, StatusBadge, Badge, Button, Alert, Table, Thead, Th, Td, Tr } from '../components/ui.jsx';

const Field = ({ label, value }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</p>
    {/* value == null, not falsy — 0 invoices is a real answer, not a missing one. */}
    <p className="mt-1 text-sm text-ink-900">{value == null || value === '' ? '—' : value}</p>
  </div>
);

const AdminBusinessDetail = () => {
  const { id } = useParams();
  const [business, setBusiness] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => adminApi(`/businesses/${id}`).then(setBusiness).catch((err) => setError(err.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await adminApi(`/businesses/${id}/status`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert>{error}</Alert>;
  if (!business) return <p className="text-sm text-ink-400">Loading…</p>;

  return (
    <div>
      <Link to="/superadmin/businesses" className="text-sm text-brand-600 hover:underline">← All businesses</Link>

      <PageHeader
        title={business.name}
        lead={business.business_type}
        action={
          <div className="flex gap-2">
            {business.status !== 'SUSPENDED' ? (
              <Button variant="secondary" disabled={busy} onClick={() => setStatus('SUSPENDED')}>Suspend</Button>
            ) : (
              <Button disabled={busy} onClick={() => setStatus('ACTIVE')}>Reactivate</Button>
            )}
            {business.status !== 'CLOSED' && (
              <Button variant="ghost" disabled={busy} onClick={() => setStatus('CLOSED')}>Close</Button>
            )}
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={business.status === 'ACTIVE' ? 'success' : business.status === 'SUSPENDED' ? 'danger' : 'neutral'}>
          {business.status}
        </Badge>
        <StatusBadge status={business.subscription.status} />
        <Badge tone="brand">{business.subscription.plan_code}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Business details</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Email" value={business.email} />
            <Field label="Phone" value={business.phone} />
            <Field label="Currency" value={business.currency} />
            <Field label="City" value={business.city} />
            <Field label="State" value={business.state} />
            <Field label="Country" value={business.country} />
            <Field label="GSTIN" value={business.gstin} />
            <Field label="GST enabled" value={business.gst_enabled ? 'Yes' : 'No'} />
            <Field label="Created" value={new Date(business.created_at).toLocaleDateString()} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Owner</h2>
          <Field label="Name" value={business.owner.name} />
          <div className="mt-3"><Field label="Email" value={business.owner.email} /></div>
          <div className="mt-3"><Field label="Phone" value={business.owner.phone} /></div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Activity</h2>
          <Field label="Invoices issued" value={business.counts.invoices} />
          <div className="mt-3"><Field label="Revenue collected" value={formatCurrency(business.revenue_collected)} /></div>
          <div className="mt-3"><Field label="Trial ends" value={business.subscription.trial_ends_at ? new Date(business.subscription.trial_ends_at).toLocaleString() : '—'} /></div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-400">Branches</h2>
          <ul className="space-y-1.5 text-sm text-ink-700">
            {business.branches.map((b) => (
              <li key={b.branch_id}>{b.name}{b.is_primary && <span className="ml-2 text-xs text-ink-400">(primary)</span>}</li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Team members</h2>
        <Table>
          <Thead>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Status</Th>
          </Thead>
          <tbody>
            {business.members.map((m) => (
              <Tr key={m.user_id}>
                <Td>{m.name}</Td>
                <Td>{m.email}</Td>
                <Td>{m.role}</Td>
                <Td>{m.status}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
};

export default AdminBusinessDetail;
