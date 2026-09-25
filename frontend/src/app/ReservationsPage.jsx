/*
 * Reservations and the walk-in waitlist for the active outlet.
 * Seating a party marks them seated; the floor (Tables) then opens an order on that table as usual.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const TONE = { BOOKED: 'brand', SEATED: 'success', COMPLETED: 'neutral', CANCELLED: 'neutral', NO_SHOW: 'warning', WAITING: 'brand', NOTIFIED: 'warning' };
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const localInput = (d) => `${localISO(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const useTables = () => {
  const [tables, setTables] = useState([]);
  useEffect(() => { api('/tables').then(setTables).catch(() => {}); }, []);
  return tables;
};

/* ── Book a table ─────────────────────────────────────────────────────── */

const BookingForm = ({ booking, date, onSaved, onClose }) => {
  const [form, setForm] = useState(booking ? {
    guest_name: booking.guest_name, phone: booking.phone || '', party_size: booking.party_size,
    when: localInput(new Date(booking.reserved_at)), duration_min: booking.duration_min, table_id: booking.table_id || '', notes: booking.notes || ''
  } : { guest_name: '', phone: '', party_size: 2, when: `${date}T20:00`, duration_min: 90, table_id: '', notes: '' });
  const [free, setFree] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // which tables are free for this slot and party
  useEffect(() => {
    const at = new Date(form.when);
    if (Number.isNaN(at.getTime())) return;
    const q = new URLSearchParams({ reserved_at: at.toISOString(), party_size: form.party_size || 1, duration_min: form.duration_min || 90 });
    api(`/reservations/availability?${q}`).then(setFree).catch(() => setFree(null));
  }, [form.when, form.party_size, form.duration_min]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = { ...form, reserved_at: new Date(form.when).toISOString(), party_size: Number(form.party_size), duration_min: Number(form.duration_min), table_id: form.table_id ? Number(form.table_id) : null };
      await api(booking ? `/reservations/${booking.reservation_id}` : '/reservations', { method: booking ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={booking ? 'Edit reservation' : 'New reservation'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field id="r-name" label="Guest name"><Input id="r-name" value={form.guest_name} onChange={set('guest_name')} required autoFocus /></Field></div>
          <Field id="r-phone" label="Mobile" hint="Links to their loyalty card"><Input id="r-phone" inputMode="tel" value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="r-when" label="Date and time"><Input id="r-when" type="datetime-local" value={form.when} onChange={set('when')} required /></Field>
          <Field id="r-party" label="Party size"><Input id="r-party" type="number" min="1" max="100" value={form.party_size} onChange={set('party_size')} required /></Field>
          <Field id="r-dur" label="Stay (minutes)"><Input id="r-dur" type="number" min="15" max="480" step="15" value={form.duration_min} onChange={set('duration_min')} /></Field>
        </div>
        <Field id="r-table" label="Table" hint={free ? `${free.length} free for this slot` : undefined}>
          <Select id="r-table" value={form.table_id} onChange={set('table_id')}>
            <option value="">Assign later</option>
            {(free || []).map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.seats ? ` · seats ${t.seats}` : ''}{t.zone ? ` · ${t.zone}` : ''}</option>)}
            {booking?.table_id && !(free || []).some((t) => t.table_id === booking.table_id) && <option value={booking.table_id}>{booking.table_name}</option>}
          </Select>
        </Field>
        <Field id="r-notes" label="Notes"><Input id="r-notes" value={form.notes} onChange={set('notes')} placeholder="Birthday, high chair, window seat…" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : booking ? 'Save changes' : 'Book table'}</Button>
        </div>
      </form>
    </Modal>
  );
};

/* Pick a table to seat someone at. `force` is offered when the table has a booking within the hour. */
const SeatModal = ({ title, tables, initial, onSeat, onClose }) => {
  const [tableId, setTableId] = useState(initial || '');
  const [error, setError] = useState('');
  const [needsForce, setNeedsForce] = useState(false);
  const go = async (force) => {
    setError('');
    try { await onSeat(Number(tableId), force); }
    catch (caught) { setError(caught.message); setNeedsForce(/reserved within the next hour/.test(caught.message)); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="s-table" label="Table">
          <Select id="s-table" value={tableId} onChange={(e) => { setTableId(e.target.value); setNeedsForce(false); }}>
            <option value="">Choose a table</option>
            {tables.filter((t) => !t.open_order_id).map((t) => <option key={t.table_id} value={t.table_id}>{t.name}{t.seats ? ` · seats ${t.seats}` : ''}{t.next_reservation ? ` · booked ${time(t.next_reservation.reserved_at)}` : ''}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {needsForce && <Button variant="secondary" onClick={() => go(true)}>Seat anyway</Button>}
          <Button disabled={!tableId} onClick={() => go(false)}>Seat</Button>
        </div>
      </div>
    </Modal>
  );
};

/* ── Reservations tab ─────────────────────────────────────────────────── */

const Reservations = ({ tables }) => {
  const { outletId } = useAuth();
  const [date, setDate] = useState(localISO());
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // {} = new
  const [seating, setSeating] = useState(null);

  const load = () => api(`/reservations?date=${date}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [date, outletId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { setError(''); try { await fn(); load(); } catch (caught) { setError(caught.message); } };
  const setStatus = (r, status) => act(() => api(`/reservations/${r.reservation_id}/status`, { method: 'POST', body: { status } }));
  const booked = (rows || []).filter((r) => r.status === 'BOOKED');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Field id="r-date" label="Day"><Input id="r-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <div className="flex items-center gap-4">
          {rows && <span className="text-sm text-ink-500">{booked.length} booked · {booked.reduce((n, r) => n + r.party_size, 0)} guests expected</span>}
          <Button onClick={() => setEditing({})}>New reservation</Button>
        </div>
      </div>
      <Alert>{error}</Alert>
      <ListState loading={!rows && !error} empty={rows?.length === 0} emptyLabel="No reservations for this day." />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>Time</Th><Th>Guest</Th><Th>Party</Th><Th>Table</Th><Th>Status</Th><Th></Th></Thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.reservation_id}>
                <Td className="font-medium">{time(r.reserved_at)}</Td>
                <Td>{r.guest_name}{r.phone && <span className="block text-xs text-ink-400">{r.phone}</span>}{r.notes && <span className="block text-xs text-ink-500">{r.notes}</span>}</Td>
                <Td>{r.party_size}</Td>
                <Td>{r.table_name || <span className="text-ink-400">Not assigned</span>}</Td>
                <Td><Badge tone={TONE[r.status]}>{r.status.replace('_', ' ')}</Badge></Td>
                <Td className="space-x-3 text-right">
                  {r.status === 'BOOKED' && <>
                    <button onClick={() => setSeating(r)} className="text-xs font-semibold text-brand-600">Seat</button>
                    <button onClick={() => setEditing(r)} className="text-xs font-semibold text-brand-600">Edit</button>
                    <button onClick={() => setStatus(r, 'NO_SHOW')} className="text-xs font-semibold text-ink-500">No-show</button>
                    <button onClick={() => setStatus(r, 'CANCELLED')} className="text-xs font-semibold text-danger">Cancel</button>
                  </>}
                  {r.status === 'SEATED' && <button onClick={() => setStatus(r, 'COMPLETED')} className="text-xs font-semibold text-brand-600">Done</button>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <BookingForm booking={editing.reservation_id ? editing : null} date={date} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {seating && (
        <SeatModal title={`Seat ${seating.guest_name}`} tables={tables} initial={seating.table_id} onClose={() => setSeating(null)}
          onSeat={async (table_id) => { await api(`/reservations/${seating.reservation_id}/seat`, { method: 'POST', body: { table_id } }); setSeating(null); load(); }} />
      )}
    </div>
  );
};

/* ── Waitlist tab ─────────────────────────────────────────────────────── */

const Waitlist = ({ tables }) => {
  const { outletId } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ guest_name: '', phone: '', party_size: 2 });
  const [seating, setSeating] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const load = () => api('/waitlist').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [outletId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { setError(''); try { await fn(); load(); } catch (caught) { setError(caught.message); } };
  const add = (e) => { e.preventDefault(); act(async () => { await api('/waitlist', { method: 'POST', body: { ...form, party_size: Number(form.party_size) } }); setForm({ guest_name: '', phone: '', party_size: 2 }); }); };
  const post = (w, path) => act(() => api(`/waitlist/${w.entry_id}/${path}`, { method: 'POST' }));

  return (
    <div>
      <Card className="mb-5 p-4">
        <form onSubmit={add} className="grid items-end gap-3 sm:grid-cols-[2fr_1.5fr_1fr_auto]">
          <Field id="w-name" label="Guest name"><Input id="w-name" value={form.guest_name} onChange={set('guest_name')} required /></Field>
          <Field id="w-phone" label="Mobile"><Input id="w-phone" inputMode="tel" value={form.phone} onChange={set('phone')} /></Field>
          <Field id="w-party" label="Party"><Input id="w-party" type="number" min="1" max="100" value={form.party_size} onChange={set('party_size')} required /></Field>
          <Button type="submit">Add to waitlist</Button>
        </form>
      </Card>
      <Alert>{error}</Alert>
      <ListState loading={!rows && !error} empty={rows?.length === 0} emptyLabel="Nobody is waiting." />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>#</Th><Th>Guest</Th><Th>Party</Th><Th>Waiting</Th><Th>Quoted</Th><Th></Th></Thead>
          <tbody>
            {rows.map((w, i) => (
              <Tr key={w.entry_id}>
                <Td>{i + 1}</Td>
                <Td className="font-medium">{w.guest_name}{w.phone && <span className="block text-xs text-ink-400">{w.phone}</span>} {w.status === 'NOTIFIED' && <Badge tone="warning">Called</Badge>}</Td>
                <Td>{w.party_size}</Td>
                <Td className={w.waited_min > (w.quoted_wait_min ?? 999) ? 'text-danger' : ''}>{w.waited_min} min</Td>
                <Td className="text-ink-500">{w.quoted_wait_min != null ? `${w.quoted_wait_min} min` : '—'}</Td>
                <Td className="space-x-3 text-right">
                  <button onClick={() => setSeating(w)} className="text-xs font-semibold text-brand-600">Seat</button>
                  <button onClick={() => post(w, 'notify')} className="text-xs font-semibold text-brand-600">Call</button>
                  <button onClick={() => post(w, 'leave')} className="text-xs font-semibold text-danger">Left</button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {seating && (
        <SeatModal title={`Seat ${seating.guest_name}`} tables={tables} onClose={() => setSeating(null)}
          onSeat={async (table_id, force) => { await api(`/waitlist/${seating.entry_id}/seat`, { method: 'POST', body: { table_id, force } }); setSeating(null); load(); }} />
      )}
    </div>
  );
};

const ReservationsPage = () => {
  const [tab, setTab] = useState('reservations');
  const tables = useTables();
  return (
    <div>
      <PageHeader title="Reservations" lead="Bookings and the walk-in waitlist for this outlet." />
      <div className="mb-6 flex gap-2" role="tablist">
        {[['reservations', 'Reservations'], ['waitlist', 'Waitlist']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-surface-2'}`}>{label}</button>
        ))}
      </div>
      {tab === 'reservations' ? <Reservations tables={tables} /> : <Waitlist tables={tables} />}
    </div>
  );
};

export default ReservationsPage;
