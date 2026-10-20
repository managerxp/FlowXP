/*
 * Pharmacy inventory: what is on the shelf, and the batch/expiry ledger GRN posts into. A batch can be moved
 * out of ACTIVE (quarantined, recalled, blocked) — allocateBatches() then skips it for every sale, same as an
 * expired one, without anyone having to remember to check expiry by hand at the till.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { BATCH_STATUS, dateText, daysLeft, money, qs, qty, useDebounced, useLoad } from '../../lib/pharmacy.js';
import { Badge, Input, ListState, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Tabs, Toolbar, useAction } from './parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const BATCH_STATES = [{ value: 'active', label: T('Active') }, { value: 'expiring', label: T('Expiring soon') }, { value: 'expired', label: T('Expired') }, { value: 'quarantined', label: T('Quarantined') }, { value: 'recalled', label: T('Recalled') }, { value: 'blocked', label: T('Blocked') }];
const NEXT_STATUS = { ACTIVE: ['QUARANTINED', 'RECALLED', 'BLOCKED'], QUARANTINED: ['ACTIVE', 'RECALLED', 'BLOCKED'], RECALLED: ['ACTIVE', 'BLOCKED'], BLOCKED: ['ACTIVE'] };

const StockTab = () => {
  const tr = useT();
  const [q, setQ] = useState('');
  const [low, setLow] = useState('');
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ q: term, limit: 100 }), [term]);
  const { data, loading, error } = useLoad(`/pharmacy/inventory/stock${query}`, { paged: true });
  const rows = low ? (data || []).filter((r) => r.low) : data;

  return (
    <div>
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder={tr('Search products')} aria-label={tr('Search stock')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Chips label={tr('Filter')} value={low} onChange={setLow} options={[{ value: '', label: T('All') }, { value: '1', label: T('Low stock') }]} />
      </Toolbar>
      <ListState loading={loading && !data} error={error} empty={rows?.length === 0} emptyIcon={Boxes} emptyLabel={tr('Nothing here')} emptyBody="No product matches." />
      {rows?.length > 0 && (
        <Table><Thead><Th>{tr('Product')}</Th><Th>{tr('Type')}</Th><Th className="text-right">{tr('On hand')}</Th><Th className="text-right">{tr('Reserved')}</Th><Th className="text-right">{tr('Available')}</Th><Th className="text-right">{tr('Reorder at')}</Th></Thead>
          <tbody>{rows.map((r) => (
            <Tr key={r.product_id}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-ink-500">{r.product_type}{r.batch_tracking ? tr('· batch tracked') : ''}</Td>
              <Td className="text-right tabular">{qty(r.on_hand)} {r.unit}</Td>
              <Td className="text-right tabular text-ink-500">{qty(r.reserved)}</Td>
              <Td className={`text-right tabular ${r.low ? 'font-semibold text-warning' : ''}`}>{qty(r.available)}</Td>
              <Td className="text-right tabular text-ink-500">{qty(r.reorder_level)}</Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
};

const BatchesTab = ({ canEdit }) => {
  const tr = useT();
  const [state, setState] = useState('active');
  const [busy, run] = useAction();
  const { data, loading, error, reload } = useLoad(`/pharmacy/inventory/batches?state=${state}`);

  const setStatus = async (batch, status) => {
    await run(() => api(`/pharmacy/inventory/batches/${batch.batch_id}/status`, { method: 'POST', body: { status } }), `${batch.batch_no} is now ${BATCH_STATUS[status].label.toLowerCase()}`);
    reload();
  };

  return (
    <div>
      <Toolbar><Chips label={tr('Batch state')} value={state} onChange={setState} options={BATCH_STATES} /></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={TriangleAlert} emptyLabel={tr('No batches here')} emptyBody="Nothing matches this filter." />
      {data?.length > 0 && (
        <Table><Thead><Th>{tr('Product')}</Th><Th>{tr('Batch')}</Th><Th>{tr('Branch')}</Th><Th className="text-right">{tr('Qty')}</Th><Th className="text-right">{tr('Expires')}</Th><Th>{tr('Status')}</Th>{canEdit && <Th>{tr('Actions')}</Th>}</Thead>
          <tbody>{data.map((b) => {
            const left = b.expiry_date ? daysLeft(b.expiry_date) : null;
            return (
              <Tr key={b.batch_id}>
                <Td className="font-medium">{b.product}</Td>
                <Td>{b.batch_no}</Td>
                <Td className="text-ink-500">{b.branch}</Td>
                <Td className="text-right tabular">{qty(b.qty_on_hand)} {b.unit}</Td>
                <Td className={`text-right ${left != null && left < 0 ? 'font-semibold text-danger' : left != null && left <= 30 ? 'text-warning' : ''}`}>{b.expiry_date ? (left < 0 ? tr('Expired') : dateText(b.expiry_date)) : '—'}</Td>
                <Td><Badge tone={BATCH_STATUS[b.status]?.tone}>{BATCH_STATUS[b.status]?.label || b.status}</Badge></Td>
                {canEdit && (
                  <Td onClick={(e) => e.stopPropagation()}>
                    <Select aria-label={tr('Change status of {{batch_no}}', { batch_no: b.batch_no })} value="" disabled={busy} onChange={(e) => e.target.value && setStatus(b, e.target.value)} className="w-auto">
                      <option value="">{tr('Change status…')}</option>
                      {(NEXT_STATUS[b.status] || []).map((s) => <option key={s} value={s}>{tr(BATCH_STATUS[s].label)}</option>)}
                    </Select>
                  </Td>
                )}
              </Tr>
            );
          })}</tbody>
        </Table>
      )}
    </div>
  );
};

const PharmacyInventory = () => {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'stock';
  const canEdit = can('inventory');

  return (
    <div>
      <PageHeader title={tr('Inventory')} lead={tr('What is on the shelf, what is about to expire, and what has been pulled from sale.')} />
      <Tabs tabs={[{ key: 'stock', label: T('Stock') }, { key: 'batches', label: T('Batches & expiry') }]} value={tab} onChange={(k) => setParams(k === 'stock' ? {} : { tab: k }, { replace: true })} />
      {tab === 'stock' ? <StockTab /> : <BatchesTab canEdit={canEdit} />}
    </div>
  );
};

export default PharmacyInventory;
