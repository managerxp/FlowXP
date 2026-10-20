/* The hall calendar: each hall down the side, the next four weeks across. A bar is a function; blue is booked, amber is held for now. Click one to open its event. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { addDays, hhmm, isWeekend, monthDay, qs, shortDay, useLoad } from '../../lib/hotel.js';
import { Button, ListState, PageHeader } from '../../components/ui.jsx';
import EventForm from './EventForm.jsx';
import { useT } from '../../i18n/useT.js';

const DAYS = 28;

export default function BanquetCalendar() {
  const tr = useT();
  const nav = useNavigate();
  const { can } = useAuth();
  const dash = useLoad('/hotel/dashboard');
  const [from, setFrom] = useState(null);
  const [open, setOpen] = useState(false);
  const today = dash.data?.business_date;
  const start = from || today;
  const cal = useLoad(start ? `/hotel/banquet/calendar${qs({ from: start, to: addDays(start, DAYS - 1) })}` : null);
  const days = useMemo(() => (start ? Array.from({ length: DAYS }, (_, i) => addDays(start, i)) : []), [start]);
  const c = cal.data;
  if (!dash.data) return <ListState loading={dash.loading} error={dash.error} />;
  const grid = { display: 'grid', gridTemplateColumns: `9rem repeat(${DAYS}, minmax(2.6rem, 1fr))` };

  return (
    <div>
      <PageHeader title={tr('Hall calendar')} lead={tr('Which hall is booked or held on which day.')}
        action={<>{can('banquet') && <Button onClick={() => setOpen(true)}>{tr('New event')}</Button>}
          <Button variant="secondary" size="sm" onClick={() => setFrom(addDays(start, -14))} aria-label={tr('Earlier')}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setFrom(null)}>{tr('Today')}</Button>
          <Button variant="secondary" size="sm" onClick={() => setFrom(addDays(start, 14))} aria-label={tr('Later')}><ChevronRight aria-hidden="true" className="h-4 w-4" /></Button></>} />
      <ListState loading={cal.loading && !c} error={cal.error} empty={c && !c.halls.length} emptyLabel={tr('Add your halls in Rooms & rates, on the Banquet tab.')} />
      {c && c.halls.length > 0 && (
        <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
          <div className="min-w-[72rem]">
            <div style={grid} className="border-b border-line bg-surface-2 text-caption font-medium text-ink-500">
              <div className="px-3 py-2">{tr('{{monthDay}} to {{monthDay2}}', { monthDay: monthDay(start), monthDay2: monthDay(days[days.length - 1]) })}</div>
              {days.map((d) => <div key={d} className={`border-l border-line px-0.5 py-2 text-center ${d === today ? 'bg-brand-50 text-brand-700' : isWeekend(d) ? 'bg-surface-3/60' : ''}`}>{shortDay(d)}</div>)}
            </div>
            {c.halls.map((h) => {
              const fs = c.functions.filter((f) => f.hall_id === h.hall_id);
              const lanes = [];
              const placed = fs.map((f) => { let lane = lanes.findIndex((e) => e <= `${f.event_date}${f.start_time}`); if (lane < 0) lane = lanes.length; lanes[lane] = `${f.event_date}${f.end_time}`; return { ...f, lane }; });
              const rows = Math.max(1, lanes.length);
              return Array.from({ length: rows }, (_, lane) => (
                <div key={`${h.hall_id}-${lane}`} style={grid} className="relative border-b border-line">
                  <div className="px-3 py-2.5 text-small font-medium text-ink-900">{lane === 0 ? h.name : ''}{lane === 0 && <span className="block text-caption font-normal text-ink-500">seats {h.capacity_seated || '—'}</span>}</div>
                  {days.map((d, i) => <div key={d} style={{ gridColumn: i + 2, gridRow: 1 }} className={`border-l border-line ${d === today ? 'bg-brand-50/60' : isWeekend(d) ? 'bg-surface-3/40' : ''}`} />)}
                  {placed.filter((f) => f.lane === lane).map((f) => {
                    const i = days.indexOf(f.event_date);
                    if (i < 0) return null;
                    return (
                      <button key={f.function_id} type="button" onClick={() => nav(`/app/hotel/banquet/events/${f.event_id}`)} style={{ gridColumn: `${i + 2} / ${i + 3}`, gridRow: 1 }}
                              title={`${f.title} · ${f.function_name} · ${hhmm(f.start_time)}–${hhmm(f.end_time)} · ${f.organiser}`}
                              className={`z-10 m-0.5 truncate rounded-md px-1 text-left text-[11px] font-medium text-white ${f.status === 'TENTATIVE' ? 'bg-warning' : f.status === 'COMPLETED' ? 'bg-ink-500' : 'bg-brand-500'} hover:brightness-110`}>{f.function_name}</button>
                    );
                  })}
                </div>
              ));
            })}
          </div>
        </div>
      )}
      <p className="mt-3 text-caption text-ink-500"><span className="mr-4"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-brand-500" />{tr('Confirmed')}</span><span className="mr-4"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-warning" />{tr('Held for now')}</span><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-ink-500" />{tr('Done')}</span></p>
      {open && <EventForm onClose={() => setOpen(false)} onSaved={(saved) => { setOpen(false); nav(`/app/hotel/banquet/events/${saved.event_id}`); }} />}
    </div>
  );
}
