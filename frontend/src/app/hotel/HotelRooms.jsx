/*
 * The room rack and housekeeping in one: every room with who is in it and whether it is clean. Housekeeping marks a room clean, inspected, dirty or out of order
 * with one tap; the front desk sees at once which rooms can be given to a guest.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { HK_STATUS, OCCUPANCY, longDate, useLoad } from '../../lib/hotel.js';
import { Badge, ListState, PageHeader, useToast } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { Chips } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const FILTERS = [['', 'All'], ['TO_CLEAN', T('To clean')], ['VACANT', T('Ready to sell')], ['OCCUPIED', T('Occupied')], ['DUE_OUT', T('Due out')], ['OUT_OF_ORDER', T('Out of order')]];

const match = (r, f) => {
  if (!f) return true;
  if (f === 'TO_CLEAN') return r.hk_status === 'DIRTY';
  if (f === 'OUT_OF_ORDER') return r.hk_status === 'OUT_OF_ORDER';
  if (f === 'VACANT') return (r.occupancy === 'VACANT' || r.occupancy === 'ARRIVING') && ['CLEAN', 'INSPECTED'].includes(r.hk_status);
  return r.occupancy === f;
};

export default function HotelRooms() {
  const tr = useT();
  const toast = useToast();
  const { can } = useAuth();
  const rack = useLoad('/hotel/rack');
  const canAssign = can('housekeeping') || can('hr') || can('front_desk');
  const cleaners = useLoad(canAssign ? '/hotel/staff/housekeepers' : null);
  const assigned = useLoad(canAssign ? '/hotel/staff/assignments' : null);
  const cleanerOf = (roomId) => (assigned.data || []).find((a) => a.room_id === roomId)?.employee_id || '';
  const assign = async (room, employeeId) => {
    try { await api('/hotel/staff/assignments', { method: 'POST', body: { room_ids: [room.room_id], employee_id: employeeId ? Number(employeeId) : undefined } }); assigned.reload(); } catch (e) { toast.error(e.message); }
  };
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(0);
  const rooms = rack.data?.rooms || [];
  const shown = useMemo(() => rooms.filter((r) => match(r, filter)), [rooms, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, rooms.filter((r) => match(r, k)).length])), [rooms]);
  const floors = useMemo(() => [...new Set(shown.map((r) => r.floor || ''))].sort(), [shown]);

  const setStatus = async (room, status) => {
    if (room.hk_status === status) return;
    setBusy(room.room_id);
    try {
      let note;
      if (status === 'OUT_OF_ORDER') note = window.prompt(`Why is room ${room.room_no} out of order?`, room.hk_note || '') ?? null;
      if (status === 'OUT_OF_ORDER' && note === null) { setBusy(0); return; }
      await api(`/hotel/rooms/${room.room_id}/status`, { method: 'POST', body: { status, note: note || undefined } });
      rack.reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(0); }
  };

  return (
    <div>
      <PageHeader title={tr('Rooms and housekeeping')} lead={rack.data ? `Where every room stands on ${longDate(rack.data.business_date)}.` : undefined} />
      <div className="mb-5"><Chips label={tr('Show')} options={FILTERS.map(([value, label]) => ({ value, label, count: counts[value] }))} value={filter} onChange={setFilter} /></div>
      <ListState loading={rack.loading && !rack.data} error={rack.error} empty={!rack.loading && !rooms.length} emptyLabel={tr('Add rooms in Set-up to see them here.')} />
      {floors.map((fl) => (
        <section key={fl || 'none'} className="mb-6">
          {floors.length > 1 && <h2 className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-500">{fl ? `Floor ${fl}` : tr('Rooms')}</h2>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.filter((r) => (r.floor || '') === fl).map((r) => {
              const occ = OCCUPANCY[r.occupancy];
              const hk = HK_STATUS[r.hk_status];
              return (
                <div key={r.room_id} className={`rounded-(--radius-card) border p-3.5 ${r.hk_status === 'OUT_OF_ORDER' ? 'border-danger/40 bg-danger/5' : occ.cell}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="text-body font-semibold text-ink-900">{r.room_no}</p><p className="text-caption text-ink-500">{r.room_type}</p></div>
                    <div className="flex flex-col items-end gap-1"><Badge tone={hk.tone}>{tr(hk.label)}</Badge><span className="text-caption text-ink-500">{tr(occ.label)}</span></div>
                  </div>
                  <div className="mt-2 min-h-9 text-caption">
                    {r.stay_booking_id ? <Link to={`/app/hotel/bookings/${r.stay_booking_id}`} className="font-medium text-brand-600 hover:underline">{r.stay_guest}{r.stay_vip ? tr('(VIP)') : ''}<span className="block font-normal text-ink-500">{tr('until {{longDate}}', { longDate: longDate(r.stay_departure) })}</span></Link>
                      : r.next_booking_id ? <Link to={`/app/hotel/bookings/${r.next_booking_id}`} className="text-ink-700 hover:underline">Next: {r.next_guest}<span className="block text-ink-500">{longDate(r.next_arrival)}</span></Link>
                      : <span className="text-ink-400">{tr('No one booked')}</span>}
                    {r.hk_note && <span className="mt-1 block text-ink-500">{r.hk_note}</span>}
                  </div>
                  {canAssign && (cleaners.data || []).length > 0 && (
                    <select aria-label={tr('Who cleans room {{room_no}}', { room_no: r.room_no })} value={cleanerOf(r.room_id)} onChange={(e) => assign(r, e.target.value)} className="mt-3 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-caption text-ink-700">
                      <option value="">{tr('Cleaner: not assigned')}</option>{cleaners.data.map((c) => <option key={c.employee_id} value={c.employee_id}>{tr('Cleaner: {{c_name}}', { c_name: c.name })}</option>)}
                    </select>
                  )}
                  {(can('housekeeping') || can('front_desk')) && (
                    <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={tr('Set room {{room_no}}', { room_no: r.room_no })}>
                      {[['CLEAN', T('Clean')], ['INSPECTED', T('Inspected')], ['DIRTY', T('Dirty')], ['OUT_OF_ORDER', T('Out of order')]].map(([k, l]) => (
                        <button key={k} type="button" disabled={busy === r.room_id} aria-pressed={r.hk_status === k} onClick={() => setStatus(r, k)}
                                className={`rounded-full border px-2.5 py-1 text-caption font-medium transition-colors ${r.hk_status === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700 hover:border-line-strong'} disabled:opacity-50`}>{l}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
