/*
 * WhatsApp sent by every business and what Meta roughly charges for it. Click a business to see its messages by kind and by day.
 * The cost is an estimate from fixed per-message rates (see the backend adminMessaging controller), not Meta's invoice.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Input, Table, Thead, Th, Td, Tr, ListState, SkeletonRows, Button } from '../components/ui.jsx';

const rs = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const Stat = ({ label, value, hint }) => (
  <div className="rounded-xl border border-line bg-surface p-4">
    <p className="text-xs text-ink-500">{label}</p>
    <p className="mt-1 text-xl font-semibold text-ink-900">{value}</p>
    {hint && <p className="text-xs text-ink-400">{hint}</p>}
  </div>
);

const BusinessMessages = ({ id, range, onClose }) => {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setD(null);
    adminApi(`/businesses/${id}/messaging?from=${range.from}&to=${range.to}`).then((x) => { setError(''); setD(x); }).catch((e) => setError(e.message));
  }, [id, range.from, range.to]);
  const max = Math.max(1, ...(d?.days || []).map((x) => x.n));
  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink-900">Business #{id} <Link className="ml-2 text-sm font-normal text-brand-600 hover:underline" to={`/superadmin/businesses/${id}`}>Open business</Link></h2>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <ListState loading={!d && !error} error={error} empty={d && d.kinds.length === 0} emptyLabel="No WhatsApp messages in this period." skeleton={<SkeletonRows rows={4} columns={5} />} />
      {d && d.kinds.length > 0 && (
        <>
          <p className="mb-3 text-sm text-ink-700">{d.summary.sent} sent · {d.summary.failed} failed · about <strong>{rs(d.summary.cost)}</strong> ({d.summary.UTILITY} utility, {d.summary.AUTHENTICATION} OTP, {d.summary.MARKETING} marketing)</p>
          <Table>
            <Thead><Th>Message</Th><Th>Charged as</Th><Th>Sent</Th><Th>Delivered</Th><Th>Read</Th><Th>Failed</Th></Thead>
            <tbody>
              {d.kinds.map((k) => (
                <Tr key={k.kind}><Td className="font-mono text-xs">{k.kind}</Td><Td>{k.category.toLowerCase()}</Td><Td>{k.n}</Td><Td>{k.delivered}</Td><Td>{k.read}</Td><Td>{k.failed}</Td></Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex h-24 items-end gap-1" aria-label="Messages per day">
            {d.days.map((x) => <div key={x.day} title={`${String(x.day).slice(0, 10)}: ${x.n}`} className="min-w-1 flex-1 rounded-t bg-brand-500" style={{ height: `${(x.n / max) * 100}%` }} />)}
          </div>
        </>
      )}
    </div>
  );
};

const AdminMessages = () => {
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState({ from: daysAgo(29), to: today() });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const open = params.get('business');

  useEffect(() => {
    adminApi(`/messaging/usage?from=${range.from}&to=${range.to}`).then((d) => { setError(''); setData(d); }).catch((e) => setError(e.message));
  }, [range.from, range.to]);

  const t = data?.total;
  return (
    <div>
      <PageHeader title="Messages" lead="WhatsApp sent by every business, and an estimate of what Meta charges for it." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-40"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From date" /></div>
        <div className="w-40"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To date" /></div>
      </div>
      {t && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Sent" value={t.sent} hint={`${t.failed} failed`} />
          <Stat label="Estimated Meta cost" value={rs(t.cost)} />
          <Stat label="Utility" value={t.UTILITY} hint={`${rs(data.rates.UTILITY)} each`} />
          <Stat label="OTP" value={t.AUTHENTICATION} hint={`${rs(data.rates.AUTHENTICATION)} each`} />
          <Stat label="Marketing" value={t.MARKETING} hint={`${rs(data.rates.MARKETING)} each`} />
        </div>
      )}
      <ListState loading={!data && !error} error={error} empty={data?.businesses.length === 0} emptyLabel="No WhatsApp messages in this period." skeleton={<SkeletonRows rows={6} columns={7} />} />
      {data?.businesses.length > 0 && (
        <Table>
          <Thead><Th>Business</Th><Th>Type</Th><Th>Sent</Th><Th>Utility</Th><Th>OTP</Th><Th>Marketing</Th><Th>Failed</Th><Th>Est. cost</Th></Thead>
          <tbody>
            {data.businesses.map((b) => (
              <Tr key={b.business_id} className="cursor-pointer" onClick={() => setParams({ business: String(b.business_id) })}>
                <Td>{b.name}</Td><Td className="text-xs">{b.business_type}</Td><Td>{b.sent}</Td><Td>{b.UTILITY}</Td><Td>{b.AUTHENTICATION}</Td><Td>{b.MARKETING}</Td><Td>{b.failed}</Td><Td className="font-semibold">{rs(b.cost)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {open && <BusinessMessages id={open} range={range} onClose={() => setParams({})} />}
    </div>
  );
};

export default AdminMessages;
