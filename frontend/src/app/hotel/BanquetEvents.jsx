/* Banquet events: enquiries to completed events, by when they happen. A new event starts as an enquiry, a hold on the hall, or a confirmed booking. */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarPlus, Search } from 'lucide-react';
import { formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { EVENT_STATUS, eventTypeName, longDate, qs, useDebounced, useLoad } from '../../lib/hotel.js';
import { Badge, Button, Input, ListState, PageHeader, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Chips, Pager } from '../salon/parts.jsx';
import EventForm from './EventForm.jsx';

const rs = (p) => formatCurrency((p || 0) / 100);
const PAGE = 30;
const VIEWS = [['ENQUIRY,TENTATIVE,CONFIRMED', 'Open'], ['ENQUIRY', 'Enquiries'], ['TENTATIVE', 'Held'], ['CONFIRMED', 'Confirmed'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled'], ['', 'All']];

export default function BanquetEvents() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'ENQUIRY,TENTATIVE,CONFIRMED';
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const list = useLoad(`/hotel/banquet/events${qs({ status, q: q.trim(), limit: PAGE, offset })}`, { paged: true });
  const rows = list.data || [];

  return (
    <div>
      <PageHeader title="Banquet events" lead="Weddings, parties and conferences, from the first enquiry to the final invoice."
        action={<>{can('banquet') && <Button onClick={() => setOpen(true)}><CalendarPlus aria-hidden="true" className="h-4 w-4" />New event</Button>}<Button to="/app/hotel/banquet/calendar" variant="secondary">Hall calendar</Button></>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips label="Show" options={VIEWS.map(([value, label]) => ({ value, label }))} value={status} onChange={(v) => { setOffset(0); setParams(v === 'ENQUIRY,TENTATIVE,CONFIRMED' ? {} : { status: v }); }} />
        <div className="relative min-w-60 flex-1 sm:max-w-sm"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" />
          <Input aria-label="Search events" placeholder="Event, organiser, phone or number" value={text} onChange={(e) => { setText(e.target.value); setOffset(0); }} className="pl-9" /></div>
      </div>
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={q ? 'No event matches.' : 'No events here yet.'} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Event</Th><Th>Organiser</Th><Th>When</Th><Th className="text-right">Guests</Th><Th className="text-right">Value</Th><Th className="text-right">Balance</Th><Th>Status</Th></Thead>
          <tbody>{rows.map((e) => {
            const s = EVENT_STATUS[e.status];
            return (
              <Tr key={e.event_id}>
                <Td><Link to={`/app/hotel/banquet/events/${e.event_id}`} className="font-medium text-brand-600 hover:underline">{e.title}</Link><span className="block text-caption text-ink-500">{e.event_no} · {eventTypeName(e.event_type)}{e.functions > 1 ? ` · ${e.functions} functions` : ''}</span></Td>
                <Td>{e.organiser}<span className="block text-caption text-ink-500">{e.phone}</span></Td>
                <Td className="whitespace-nowrap">{e.first_date ? longDate(e.first_date) : '—'}</Td>
                <Td className="tabular text-right">{e.guests}</Td>
                <Td className="tabular text-right">{rs(e.charges_paise)}</Td>
                <Td className={`tabular text-right ${e.charges_paise - e.paid_paise > 0 && e.status !== 'CANCELLED' ? 'font-medium text-danger' : 'text-ink-500'}`}>{rs(e.charges_paise - e.paid_paise)}</Td>
                <Td><Badge tone={s.tone}>{s.label}</Badge>{e.status === 'TENTATIVE' && e.hold_until && <span className="block text-caption text-ink-500">until {longDate(e.hold_until)}</span>}</Td>
              </Tr>
            );
          })}</tbody>
        </Table>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
      {open && <EventForm onClose={() => setOpen(false)} onSaved={(saved) => { setOpen(false); nav(`/app/hotel/banquet/events/${saved.event_id}`); }} />}
    </div>
  );
}
