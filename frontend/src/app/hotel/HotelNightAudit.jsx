/*
 * Night audit: closing the hotel's day. Shows what still needs settling (bookings that never arrived, guests due out), then posts the night's room charges, writes
 * down the day's figures and moves the hotel's date on. It cannot be undone, so it asks first.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Moon } from 'lucide-react';
import { api } from '../../lib/api.js';
import { longDate, useLoad } from '../../lib/hotel.js';
import { Badge, Button, ListState, PageHeader, useDialog } from '../../components/ui.jsx';
import { Panel, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

export default function HotelNightAudit() {
  const tr = useT();
  const dialog = useDialog();
  const [busy, run] = useAction();
  const pre = useLoad('/hotel/night-audit');
  const [done, setDone] = useState(null);
  const [noShowAll, setNoShowAll] = useState(false);
  const p = pre.data;

  const go = async () => {
    const ok = await dialog.confirm({
      title: `Close ${longDate(p.business_date)}?`,
      body: `This posts tonight's room charge to ${p.rooms_in_house} room${p.rooms_in_house === 1 ? '' : 's'}${p.pending_arrivals.length && noShowAll ? `, marks ${p.pending_arrivals.length} booking${p.pending_arrivals.length === 1 ? '' : 's'} as no-show` : ''}, records the day's figures and moves the hotel's date to ${longDate(p.next_date)}. It cannot be undone.`,
      confirmLabel: tr('Close the day')
    });
    if (!ok) return;
    const out = await run(() => api('/hotel/night-audit', { method: 'POST', body: { no_show_all: noShowAll } }), 'Day closed');
    if (out) { setDone(out); pre.reload(); }
  };

  if (!p) return <ListState loading={pre.loading} error={pre.error} />;
  const blocked = p.pending_arrivals.length > 0 && !noShowAll;

  return (
    <div className="max-w-3xl">
      <PageHeader title={tr('Night audit')} lead={tr('Close the day: charge the rooms, record the figures, move the hotel\'s date on.')} />
      {done && (
        <div className="mb-6 flex items-start gap-3 rounded-(--radius-card) border border-success/30 bg-success/5 p-4">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="text-small"><p className="font-semibold text-ink-900">{tr('{{longDate}} is closed. The hotel\'s date is now {{longDate2}}.', { longDate: longDate(done.audited), longDate2: longDate(done.business_date) })}</p>
            <p className="mt-1 text-ink-700">{done.room_charges_posted} room charge{done.room_charges_posted === 1 ? '' : 's'} posted{done.no_shows_marked ? `, ${done.no_shows_marked} no-show${done.no_shows_marked === 1 ? '' : 's'} marked` : ''}. <Link className="font-medium text-brand-600 hover:underline" to={`/app/hotel/reports?report=flash&date=${done.audited}`}>{tr('See that day\'s flash report')}</Link></p></div>
        </div>
      )}

      <Panel title={tr('Today is {{longDate}}', { longDate: longDate(p.business_date) })} lead={p.last_audit ? `The last audit was for ${longDate(p.last_audit.audit_date)}.` : tr('No day has been closed yet.')}>
        <dl className="grid grid-cols-3 gap-4 text-small">
          <div><dt className="text-ink-500">{tr('Rooms occupied tonight')}</dt><dd className="mt-1 text-2xl font-semibold tabular text-ink-900">{p.rooms_in_house}</dd></div>
          <div><dt className="text-ink-500">{tr('Not arrived')}</dt><dd className={`mt-1 text-2xl font-semibold tabular ${p.pending_arrivals.length ? 'text-warning' : 'text-ink-900'}`}>{p.pending_arrivals.length}</dd></div>
          <div><dt className="text-ink-500">{tr('Due out, not checked out')}</dt><dd className={`mt-1 text-2xl font-semibold tabular ${p.overdue_departures.length ? 'text-warning' : 'text-ink-900'}`}>{p.overdue_departures.length}</dd></div>
        </dl>
      </Panel>

      {p.pending_arrivals.length > 0 && (
        <Panel className="mt-6" title={tr('Bookings that have not arrived')} lead={tr('Check them in, or mark them as no-shows, before closing the day.')}>
          <ul className="divide-y divide-line">
            {p.pending_arrivals.map((b) => <li key={b.booking_id} className="flex items-center justify-between gap-3 py-2.5 text-small"><span><span className="font-medium text-ink-900">{b.guest_name}</span> <span className="text-ink-500">{b.res_no} · {b.rooms} room{b.rooms === 1 ? '' : 's'} · due {longDate(String(b.arrival).slice(0, 10))}</span></span><Link to={`/app/hotel/bookings/${b.booking_id}`} className="font-medium text-brand-600 hover:underline">{tr('Open')}</Link></li>)}
          </ul>
          <label className="mt-4 flex items-center gap-2 text-small text-ink-700"><input type="checkbox" checked={noShowAll} onChange={(e) => setNoShowAll(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />{tr('Mark all of these as no-shows when I close the day')}</label>
        </Panel>
      )}

      {p.overdue_departures.length > 0 && (
        <Panel className="mt-6" title={tr('Due out and still in the hotel')} lead={tr('They are charged tonight and kept on for tomorrow unless you check them out first.')}>
          <ul className="divide-y divide-line">
            {p.overdue_departures.map((b) => <li key={b.booking_id} className="flex items-center justify-between gap-3 py-2.5 text-small"><span><span className="font-medium text-ink-900">{b.guest_name}</span> <span className="text-ink-500">{tr('room {{rooms}}', { rooms: b.rooms })}</span></span><Link to={`/app/hotel/bookings/${b.booking_id}`} className="font-medium text-brand-600 hover:underline">{tr('Check out')}</Link></li>)}
          </ul>
        </Panel>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={go} loading={busy} disabled={blocked}><Moon aria-hidden="true" className="h-4 w-4" />Close {longDate(p.business_date)}</Button>
        {blocked && <Badge tone="warning">{tr('Settle the bookings above first')}</Badge>}
      </div>
    </div>
  );
}
