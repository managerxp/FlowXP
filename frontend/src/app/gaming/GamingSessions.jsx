/* Session history: every sitting, what it cost, and the invoice it was billed on. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gamepad2 } from 'lucide-react';
import { KIND_LABEL, dateTimeText, duration, qs, rs, useLoad } from '../../lib/gaming.js';
import { Badge, Button, ListState, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Toolbar } from '../salon/parts.jsx';

const PRESETS = [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']];
const STATUS_TONE = { RUNNING: 'brand', PAUSED: 'warning', ENDED: 'success', CANCELLED: 'neutral' };
const STATUS_LABEL = { RUNNING: 'Playing', PAUSED: 'Paused', ENDED: 'Finished', CANCELLED: 'Cancelled' };
const LIMIT = 25;

const dayOf = (offset) => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function GamingSessions() {
  const [preset, setPreset] = useState('7');
  const [station, setStation] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const stations = useLoad('/gaming/stations');
  const range = preset === 'all' ? {} : { from: dayOf(preset === 'today' ? 0 : Number(preset) - 1), to: dayOf(0) };
  const list = useLoad(`/gaming/sessions${qs({ ...range, station_id: station, status, limit: LIMIT, offset })}`, { paged: true });
  const rows = list.data || [];
  const total = list.meta?.total || 0;
  const change = (fn) => (v) => { fn(v); setOffset(0); };

  return (
    <div>
      <PageHeader title="Sessions" lead="Every sitting at a station, what it cost and the bill it went on." action={<Button variant="secondary" to="/app/gaming">Back to the board</Button>} />
      <Toolbar>
        <Chips label="Period" value={preset} onChange={change(setPreset)} options={PRESETS.map(([value, label]) => ({ value, label }))} />
        <div className="w-44"><Select aria-label="Station" value={station} onChange={(e) => change(setStation)(e.target.value)}><option value="">All stations</option>{(stations.data || []).map((s) => <option key={s.station_id} value={s.station_id}>{s.name}</option>)}</Select></div>
        <div className="w-40"><Select aria-label="Status" value={status} onChange={(e) => change(setStatus)(e.target.value)}><option value="">Any status</option><option value="ENDED">Finished</option><option value="RUNNING">Playing</option><option value="PAUSED">Paused</option><option value="CANCELLED">Cancelled</option></Select></div>
      </Toolbar>
      <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && !rows.length} emptyLabel="No sessions in this period" emptyIcon={Gamepad2} emptyBody="Start one from the board." />
      {rows.length > 0 && (
        <>
          <Table>
            <Thead><Th>Started</Th><Th>Station</Th><Th>Player</Th><Th>Played</Th><Th className="text-right">Charge</Th><Th>Status</Th><Th>Bill</Th></Thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.session_id}>
                  <Td>{dateTimeText(r.started_at)}</Td>
                  <Td><span className="font-medium text-ink-900">{r.station_name}</span><span className="block text-caption text-ink-500">{KIND_LABEL[r.kind]}{r.mode === 'FIXED' ? ' · offer' : ''}{r.game_name ? ` · ${r.game_name}` : ''}</span></Td>
                  <Td>{r.customer_name || r.player_name || <span className="text-ink-400">Walk-in</span>}{r.players > 1 ? <span className="block text-caption text-ink-500">{r.players} players</span> : null}</Td>
                  <Td className="tabular">{duration(r.elapsed_seconds)}{r.units > 0 ? <span className="block text-caption text-ink-500">{r.units} frame{r.units === 1 ? '' : 's'}</span> : null}</Td>
                  <Td className="tabular text-right">{r.status === 'ENDED' ? rs(r.charge) : r.status === 'CANCELLED' ? <span title={r.void_reason}>–</span> : ''}</Td>
                  <Td><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></Td>
                  <Td>{r.invoice_number ? <Link className="text-brand-700 hover:underline" to="/app/billing/invoices">{r.invoice_number}</Link> : r.status === 'ENDED' ? <Link className="text-brand-700 hover:underline" to={`/app/orders?order=${r.order_id}`}>To bill</Link> : ''}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex items-center justify-between text-small text-ink-500">
            <span>{offset + 1} to {Math.min(offset + LIMIT, total)} of {total}</span>
            <span className="flex gap-2"><Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Newer</Button><Button size="sm" variant="secondary" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Older</Button></span>
          </div>
        </>
      )}
    </div>
  );
}
