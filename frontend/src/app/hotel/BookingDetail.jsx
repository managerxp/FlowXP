/*
 * One booking: the guest, the rooms, the bill so far (the folio), and what the desk can do next. Before arrival: take an advance, change the dates, check in,
 * cancel or mark a no-show. In the hotel: post charges, take payments, move room, extend or shorten, and check out. After: the invoice.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BedDouble, CalendarClock, CreditCard, FileText, LogIn, LogOut, MoveRight, Plus, Receipt, UserRound } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { BOOKING_STATUS, DEPARTMENTS, ID_TYPES, METHODS, departmentName, longDate, methodName, nightsBetween, qs, sourceName, useLoad } from '../../lib/hotel.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, Select, Table, Td, Textarea, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, useAction } from '../salon/parts.jsx';

const rs = (p) => formatCurrency((p || 0) / 100);

/* ── dialogs ───────────────────────────────────────────────────────────── */

const CheckInDialog = ({ booking, businessDate, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [free, setFree] = useState({});
  const [pick, setPick] = useState(() => Object.fromEntries(booking.rooms.filter((r) => r.status === 'RESERVED').map((r) => [r.rr_id, r.room_id || ''])));
  const [allowDirty, setAllowDirty] = useState(false);
  const [guest, setGuest] = useState({ id_type: booking.guest.id_type || '', id_number: booking.guest.id_number || '', nationality: booking.guest.nationality || 'Indian', address: booking.guest.address || '' });
  const rooms = booking.rooms.filter((r) => r.status === 'RESERVED');
  useEffect(() => {
    Promise.all(rooms.map((r) => api(`/hotel/free-rooms${qs({ arrival: String(booking.arrival).slice(0, 10) > businessDate ? String(booking.arrival).slice(0, 10) : businessDate, departure: String(r.departure).slice(0, 10), exclude_rr_id: r.rr_id })}`).then((list) => [r.rr_id, list])))
      .then((all) => setFree(Object.fromEntries(all))).catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (rooms.some((r) => !pick[r.rr_id])) { setError('Choose a room for each room on the booking'); return; }
    const out = await run(() => api(`/hotel/bookings/${booking.booking_id}/check-in`, { method: 'POST', body: {
      assignments: rooms.map((r) => ({ rr_id: r.rr_id, room_id: Number(pick[r.rr_id]) })), allow_dirty: allowDirty,
      guest: { id_type: guest.id_type || undefined, id_number: guest.id_number || undefined, nationality: guest.nationality || undefined, address: guest.address || undefined }
    } }).catch((c) => { setError(c.message); if (c.code === 'ROOM_DIRTY') setAllowDirty(false); throw c; }), 'Checked in');
    if (out) onDone(out);
  };
  const dirtyChosen = rooms.some((r) => (free[r.rr_id] || []).find((f) => String(f.room_id) === String(pick[r.rr_id]))?.hk_status === 'DIRTY');
  return (
    <Modal title={`Check in ${booking.guest_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {rooms.map((r, i) => (
          <Field key={r.rr_id} id={`ci-${i}`} label={`${r.room_type}${r.guest_name ? ` for ${r.guest_name}` : ''}`}>
            <Select id={`ci-${i}`} value={pick[r.rr_id]} onChange={(e) => setPick((p) => ({ ...p, [r.rr_id]: e.target.value }))}>
              <option value="">Choose a room</option>
              {(free[r.rr_id] || []).map((f) => <option key={f.room_id} value={f.room_id}>{f.room_no} · {f.room_type}{f.hk_status === 'DIRTY' ? ' (not cleaned)' : ''}</option>)}
            </Select>
          </Field>
        ))}
        {dirtyChosen && <label className="flex items-center gap-2 text-small text-ink-700"><input type="checkbox" checked={allowDirty} onChange={(e) => setAllowDirty(e.target.checked)} className="h-4 w-4 accent-(--color-brand-500)" />Check in even though the room has not been cleaned</label>}
        <div className="rounded-(--radius-card) border border-line p-4">
          <p className="mb-3 text-small font-medium text-ink-900">Guest ID</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ci-idt" label="ID type"><Select id="ci-idt" value={guest.id_type} onChange={(e) => setGuest((g) => ({ ...g, id_type: e.target.value }))}><option value="">Not taken</option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field id="ci-idn" label="ID number"><Input id="ci-idn" value={guest.id_number} onChange={(e) => setGuest((g) => ({ ...g, id_number: e.target.value }))} /></Field>
            <Field id="ci-nat" label="Nationality"><Input id="ci-nat" value={guest.nationality} onChange={(e) => setGuest((g) => ({ ...g, nationality: e.target.value }))} /></Field>
            <Field id="ci-addr" label="Address"><Input id="ci-addr" value={guest.address} onChange={(e) => setGuest((g) => ({ ...g, address: e.target.value }))} /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Check in</Button></div>
      </form>
    </Modal>
  );
};

const ChargeDialog = ({ booking, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ department: 'LAUNDRY', description: '', quantity: '1', price: '', tax_rate: '18', rr_id: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const total = (Number(f.quantity) || 0) * (Number(f.price) || 0) * (1 + (Number(f.tax_rate) || 0) / 100);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/bookings/${booking.booking_id}/charges`, { method: 'POST', body: { department: f.department, description: f.description, quantity: Number(f.quantity), price: Number(f.price), tax_rate: Number(f.tax_rate) || 0, rr_id: f.rr_id ? Number(f.rr_id) : undefined } }).catch((c) => { setError(c.message); throw c; }), 'Charge posted');
    if (out) onDone();
  };
  return (
    <Modal title="Post a charge" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ch-d" label="For"><Select id="ch-d" value={f.department} onChange={set('department')}>{DEPARTMENTS.filter(([c]) => c !== 'ROOM').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
          {booking.rooms.filter((r) => r.status === 'IN_HOUSE').length > 1 && <Field id="ch-r" label="Room"><Select id="ch-r" value={f.rr_id} onChange={set('rr_id')}><option value="">Whole booking</option>{booking.rooms.filter((r) => r.status === 'IN_HOUSE').map((r) => <option key={r.rr_id} value={r.rr_id}>{r.room_no}</option>)}</Select></Field>}
        </div>
        <Field id="ch-desc" label="What was it"><Input id="ch-desc" value={f.description} onChange={set('description')} required autoFocus placeholder="Laundry, extra bed, airport pickup…" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ch-q" label="Quantity"><Input id="ch-q" type="number" min="0.001" step="any" value={f.quantity} onChange={set('quantity')} required /></Field>
          <Field id="ch-p" label="Price each, before GST"><Input id="ch-p" type="number" min="0" step="any" value={f.price} onChange={set('price')} required /></Field>
          <Field id="ch-t" label="GST %"><Input id="ch-t" type="number" min="0" max="100" step="any" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
        </div>
        <p className="text-small text-ink-500">Goes on the bill as <span className="tabular font-semibold text-ink-900">{formatCurrency(total)}</span> with GST.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Post it</Button></div>
      </form>
    </Modal>
  );
};

const PaymentDialog = ({ booking, kind, due, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ amount: due > 0 && kind !== 'REFUND' ? String(due / 100) : '', method: 'CASH', reference: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const label = kind === 'REFUND' ? 'Refund' : kind === 'ADVANCE' ? 'Take an advance' : 'Take a payment';
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/bookings/${booking.booking_id}/payments`, { method: 'POST', body: { kind, amount: Number(f.amount), method: f.method, reference: f.reference || undefined } }).catch((c) => { setError(c.message); throw c; }), kind === 'REFUND' ? 'Refund recorded' : 'Payment recorded');
    if (out) onDone();
  };
  return (
    <Modal title={label} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="py-a" label="Amount"><Input id="py-a" type="number" min="0.01" step="any" value={f.amount} onChange={set('amount')} required autoFocus /></Field>
          <Field id="py-m" label="Paid by"><Select id="py-m" value={f.method} onChange={set('method')}>{METHODS.filter(([c]) => c !== 'CREDIT').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
        </div>
        <Field id="py-r" label="Reference"><Input id="py-r" value={f.reference} onChange={set('reference')} placeholder="UPI reference, card slip…" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{kind === 'REFUND' ? 'Refund' : 'Record it'}</Button></div>
      </form>
    </Modal>
  );
};

const DatesDialog = ({ booking, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const inHouse = booking.status === 'CHECKED_IN';
  const [f, setF] = useState({ arrival: String(booking.arrival).slice(0, 10), departure: String(booking.departure).slice(0, 10) });
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/bookings/${booking.booking_id}/dates`, { method: 'PUT', body: inHouse ? { departure: f.departure } : f }).catch((c) => { setError(c.message); throw c; }), 'Dates changed');
    if (out) onDone();
  };
  return (
    <Modal title={inHouse ? 'Extend or shorten the stay' : 'Change the dates'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="dt-a" label="Arrival"><Input id="dt-a" type="date" value={f.arrival} onChange={(e) => setF((x) => ({ ...x, arrival: e.target.value }))} disabled={inHouse} /></Field>
          <Field id="dt-d" label="Departure"><Input id="dt-d" type="date" value={f.departure} onChange={(e) => setF((x) => ({ ...x, departure: e.target.value }))} autoFocus /></Field>
        </div>
        <p className="text-caption text-ink-500">{nightsBetween(f.arrival, f.departure)} night{nightsBetween(f.arrival, f.departure) === 1 ? '' : 's'}. Nights already agreed keep their rate; new nights use the rate card.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const MoveDialog = ({ booking, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const here = booking.rooms.filter((r) => r.status === 'IN_HOUSE');
  const [rr, setRr] = useState(here[0]?.rr_id || '');
  const [free, setFree] = useState([]);
  const [f, setF] = useState({ room_id: '', rate: '', reason: '' });
  const room = here.find((r) => String(r.rr_id) === String(rr));
  useEffect(() => {
    if (!room) return;
    api('/hotel/dashboard').then((d) => api(`/hotel/free-rooms${qs({ arrival: d.business_date, departure: String(room.departure).slice(0, 10), exclude_rr_id: room.rr_id })}`)).then(setFree).catch((e) => setError(e.message));
  }, [rr]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/bookings/${booking.booking_id}/move-room`, { method: 'POST', body: { rr_id: Number(rr), room_id: Number(f.room_id), rate: f.rate === '' ? undefined : Number(f.rate), reason: f.reason || undefined } }).catch((c) => { setError(c.message); throw c; }), 'Guest moved');
    if (out) onDone();
  };
  return (
    <Modal title="Move to another room" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {here.length > 1 && <Field id="mv-r" label="Which room"><Select id="mv-r" value={rr} onChange={(e) => setRr(e.target.value)}>{here.map((r) => <option key={r.rr_id} value={r.rr_id}>{r.room_no} · {r.room_type}</option>)}</Select></Field>}
        <Field id="mv-n" label={`New room (now in ${room?.room_no})`}><Select id="mv-n" value={f.room_id} onChange={(e) => setF((x) => ({ ...x, room_id: e.target.value }))} required><option value="">Choose a room</option>{free.map((r) => <option key={r.room_id} value={r.room_id}>{r.room_no} · {r.room_type}{r.hk_status === 'DIRTY' ? ' (not cleaned)' : ''}</option>)}</Select></Field>
        <Field id="mv-rate" label="New rate a night (optional)" hint="Leave empty to keep the rate agreed. The old room goes to housekeeping."><Input id="mv-rate" type="number" min="0" step="any" value={f.rate} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value }))} /></Field>
        <Field id="mv-why" label="Why"><Input id="mv-why" value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} placeholder="Noise, upgrade, air conditioner not working…" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Move</Button></div>
      </form>
    </Modal>
  );
};

const CheckOutDialog = ({ booking, balance, onClose, onDone }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const owes = balance > 0; const credit = balance < 0;
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const body = owes ? { settlement: { method, reference: reference || undefined } } : credit ? { refund_method: method } : {};
    const out = await run(() => api(`/hotel/bookings/${booking.booking_id}/check-out`, { method: 'POST', body }).catch((c) => { setError(c.message); throw c; }), 'Checked out');
    if (out) onDone(out);
  };
  return (
    <Modal title={`Check out ${booking.guest_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-small text-ink-700">{owes ? <>The guest owes <span className="tabular font-semibold text-ink-900">{rs(balance)}</span>. Take it to make the GST invoice and check them out.</>
          : credit ? <>The guest has paid <span className="tabular font-semibold text-ink-900">{rs(-balance)}</span> more than the bill. Refund it to check them out.</>
          : <>The bill is settled. This makes the GST invoice and releases the room to housekeeping.</>}</p>
        {(owes || credit) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="co-m" label={owes ? 'Paid by' : 'Refunded by'}><Select id="co-m" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.filter(([c]) => owes || c !== 'CREDIT').map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
            {owes && <Field id="co-r" label="Reference"><Input id="co-r" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI reference, card slip…" /></Field>}
          </div>
        )}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{owes ? `Take ${rs(balance)} and check out` : 'Check out'}</Button></div>
      </form>
    </Modal>
  );
};

/* ── the page ──────────────────────────────────────────────────────────── */

export default function BookingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { can } = useAuth();
  const canDesk = can('front_desk');
  const dash = useLoad('/hotel/dashboard');
  const b = useLoad(`/hotel/bookings/${id}`);
  const f = useLoad(`/hotel/bookings/${id}/folio`);
  const [open, setOpen] = useState(null);
  const refresh = () => { b.reload(); f.reload(); setOpen(null); };
  const booking = b.data;
  const folio = f.data;

  const act = async (path, body, done) => {
    try { await api(`/hotel/bookings/${id}/${path}`, { method: 'POST', body }); toast.success(done); refresh(); } catch (e) { toast.error(e.message); }
  };

  if (!booking) return <ListState loading={b.loading} error={b.error} />;
  const totals = folio?.totals || { charges_paise: booking.charges_paise, paid_paise: booking.paid_paise, balance_paise: booking.balance_paise };
  const status = BOOKING_STATUS[booking.status] || { label: booking.status, tone: 'neutral' };
  const inHouse = booking.status === 'CHECKED_IN'; const booked = booking.status === 'CONFIRMED';
  const nights = nightsBetween(String(booking.arrival).slice(0, 10), String(booking.departure).slice(0, 10));
  const voidCharge = async (c) => {
    const reason = await dialog.prompt({ title: `Void “${c.description}”?`, body: c.invoiced ? 'It comes off this guest’s bill. The restaurant bill itself stays as an unpaid bill on their account.' : 'It stays on the history, marked as voided, and comes off the bill.', label: 'Reason', confirmLabel: 'Void the charge', danger: true });
    if (!reason) return;
    try { await api(`/hotel/charges/${c.charge_id}/void`, { method: 'POST', body: { reason } }); toast.success('Charge voided'); refresh(); } catch (e) { toast.error(e.message); }
  };
  const cancel = async () => {
    const reason = await dialog.prompt({ title: 'Cancel this booking?', body: totals.paid_paise > 0 ? `${rs(totals.paid_paise)} has been paid. Refund it afterwards if the guest is owed it.` : undefined, label: 'Reason', confirmLabel: 'Cancel the booking', danger: true });
    if (reason) act('cancel', { reason }, 'Booking cancelled');
  };
  const noShow = async () => { if (await dialog.confirm({ title: 'Mark as a no-show?', body: 'The room goes back on sale. Any advance stays on the booking until you refund it.', confirmLabel: 'Mark no-show', danger: true })) act('no-show', {}, 'Marked as a no-show'); };

  return (
    <div className="space-y-6">
      <Link to="/app/hotel/bookings" className="inline-flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-900"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Bookings</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight text-ink-900">{booking.guest_name}</h1><Badge tone={status.tone}>{status.label}</Badge>{booking.is_vip && <Badge tone="warning">VIP</Badge>}</div>
          <p className="mt-1 text-small text-ink-500">{booking.res_no} · {longDate(String(booking.arrival).slice(0, 10))} to {longDate(String(booking.departure).slice(0, 10))} · {nights} night{nights === 1 ? '' : 's'} · {sourceName(booking.source)}{booking.source_ref ? ` (${booking.source_ref})` : ''}</p>
        </div>
        {canDesk && (
          <div className="flex flex-wrap gap-2">
            {booked && <Button onClick={() => setOpen('checkin')}><LogIn aria-hidden="true" className="h-4 w-4" />Check in</Button>}
            {booked && <Button variant="secondary" onClick={() => setOpen('advance')}><CreditCard aria-hidden="true" className="h-4 w-4" />Take an advance</Button>}
            {booked && <Button variant="secondary" onClick={() => setOpen('dates')}><CalendarClock aria-hidden="true" className="h-4 w-4" />Change dates</Button>}
            {booked && <Button variant="secondary" onClick={noShow}>No-show</Button>}
            {booked && <Button variant="secondary" onClick={cancel}>Cancel</Button>}
            {inHouse && <Button variant="secondary" onClick={() => setOpen('charge')}><Plus aria-hidden="true" className="h-4 w-4" />Post a charge</Button>}
            {inHouse && <Button variant="secondary" onClick={() => setOpen('payment')}><CreditCard aria-hidden="true" className="h-4 w-4" />Take a payment</Button>}
            {inHouse && <Button variant="secondary" onClick={() => setOpen('move')}><MoveRight aria-hidden="true" className="h-4 w-4" />Move room</Button>}
            {inHouse && <Button variant="secondary" onClick={() => setOpen('dates')}><CalendarClock aria-hidden="true" className="h-4 w-4" />Extend / shorten</Button>}
            {inHouse && <Button onClick={() => setOpen('checkout')}><LogOut aria-hidden="true" className="h-4 w-4" />Check out</Button>}
            {booking.status === 'CANCELLED' && totals.paid_paise > 0 && <Button variant="secondary" onClick={() => setOpen('refund')}>Refund {rs(totals.paid_paise)}</Button>}
            {booking.invoice_id && <Button to={`/app/billing/invoices/${booking.invoice_id}`} variant="secondary"><FileText aria-hidden="true" className="h-4 w-4" />GST invoice</Button>}
          </div>
        )}
      </header>

      {booking.notes && <Alert>{`Note: ${booking.notes}`}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Rooms">
            <ul className="divide-y divide-line">
              {booking.rooms.map((r) => (
                <li key={r.rr_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><BedDouble aria-hidden="true" className="h-5 w-5" /></span>
                    <div><p className="text-small font-semibold text-ink-900">{r.room_no ? `Room ${r.room_no}` : 'Room not chosen yet'} <span className="font-normal text-ink-500">· {r.room_type}</span></p>
                      <p className="text-caption text-ink-500">{r.adults} adult{r.adults === 1 ? '' : 's'}{r.children ? `, ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}{r.guest_name ? ` · ${r.guest_name}` : ''} · {longDate(String(r.arrival).slice(0, 10))} to {longDate(String(r.departure).slice(0, 10))}</p></div></div>
                  <div className="text-right"><p className="tabular text-small font-semibold text-ink-900">{rs(r.rate_paise)} <span className="font-normal text-ink-500">a night</span></p>{r.status !== 'RESERVED' && <Badge tone={r.status === 'IN_HOUSE' ? 'success' : 'neutral'}>{r.status === 'IN_HOUSE' ? 'In the room' : r.status === 'DEPARTED' ? 'Left' : 'Cancelled'}</Badge>}</div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="The bill so far" lead="Room charges are added by night audit each night. GST is shown with each line.">
            {!folio ? <ListState loading={f.loading} error={f.error} /> : folio.charges.length === 0 ? <p className="text-small text-ink-500">Nothing charged yet. The first room charge is posted when you run night audit.</p> : (
              <div className="overflow-x-auto"><Table>
                <Thead><Th>Date</Th><Th>What</Th><Th className="text-right">Amount</Th><Th className="text-right">GST</Th><Th className="text-right">Total</Th><Th></Th></Thead>
                <tbody>
                  {folio.charges.map((c) => (
                    <Tr key={c.charge_id} className={c.voided_at ? 'opacity-50' : ''}>
                      <Td className="whitespace-nowrap">{String(c.charge_date).slice(5, 10).split('-').reverse().join('/')}</Td>
                      <Td className={c.voided_at ? 'line-through' : ''}>{c.description}{c.voided_at && <span className="ml-2 no-underline"><Badge tone="neutral">Voided</Badge></span>}<span className="block text-caption text-ink-500">{departmentName(c.department)}{c.invoiced && (c.invoice_status === 'CANCELLED' ? ' · bill cancelled, not counted' : <> · <Link to={`/app/billing/invoices/${c.ref_id}`} className="text-brand-700 hover:underline">{c.invoice_number}</Link> · restaurant bill, paid at check-out</>)}</span></Td>
                      <Td className="tabular text-right">{rs(c.amount_paise)}</Td>
                      <Td className="tabular text-right text-ink-500">{rs(c.tax_paise)} <span className="text-caption">({Number(c.tax_rate)}%)</span></Td>
                      <Td className="tabular text-right font-medium">{rs(Number(c.amount_paise) + Number(c.tax_paise))}</Td>
                      <Td className="text-right">{canDesk && inHouse && !c.voided_at && <button type="button" onClick={() => voidCharge(c)} className="text-caption font-medium text-danger hover:underline">Void</button>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table></div>
            )}
            {folio && folio.payments.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-2 text-small font-medium text-ink-900">Payments</p>
                <ul className="space-y-1.5 text-small">
                  {folio.payments.map((p) => (
                    <li key={p.fp_id} className="flex flex-wrap justify-between gap-2"><span className="text-ink-700">{p.kind === 'ADVANCE' ? 'Advance' : p.kind === 'REFUND' ? 'Refund' : 'Payment'} · {methodName(p.method)}{p.reference ? ` · ${p.reference}` : ''} <span className="text-ink-400">{String(p.pay_date).slice(0, 10)}</span></span><span className={`tabular font-medium ${p.kind === 'REFUND' ? 'text-danger' : 'text-ink-900'}`}>{p.kind === 'REFUND' ? '−' : ''}{rs(p.amount_paise)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Balance">
            <dl className="space-y-2 text-small">
              <div className="flex justify-between"><dt className="text-ink-500">Charges with GST</dt><dd className="tabular font-medium text-ink-900">{rs(totals.charges_paise)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">GST in that</dt><dd className="tabular text-ink-700">{rs(totals.tax_paise)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Paid</dt><dd className="tabular font-medium text-ink-900">{rs(totals.paid_paise)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-body"><dt className="font-semibold text-ink-900">{totals.balance_paise < 0 ? 'Owed back' : 'To pay'}</dt><dd className={`tabular font-semibold ${totals.balance_paise > 0 ? 'text-danger' : 'text-success'}`}>{rs(Math.abs(totals.balance_paise))}</dd></div>
            </dl>
          </Panel>
          <Panel title="Guest" action={<UserRound aria-hidden="true" className="h-4 w-4 text-ink-400" />}>
            <dl className="space-y-1.5 text-small">
              {[['Phone', booking.guest.phone], ['Email', booking.guest.email], ['Company', booking.company || booking.guest.company], ['GSTIN', booking.guest.gstin], ['ID', booking.guest.id_type ? `${booking.guest.id_type} ${booking.guest.id_number || ''}` : null], ['Nationality', booking.guest.nationality], ['Address', booking.guest.address]]
                .filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="shrink-0 text-ink-500">{k}</dt><dd className="text-right text-ink-900">{v}</dd></div>)}
            </dl>
            {booking.cancel_reason && <p className="mt-3 text-caption text-ink-500">Cancelled: {booking.cancel_reason}</p>}
          </Panel>
          <Panel title="Receipt"><Button variant="secondary" size="sm" onClick={() => window.print()}><Receipt aria-hidden="true" className="h-4 w-4" />Print this page</Button></Panel>
        </div>
      </div>

      {open === 'checkin' && dash.data && <CheckInDialog booking={booking} businessDate={dash.data.business_date} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'charge' && <ChargeDialog booking={booking} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'payment' && <PaymentDialog booking={booking} kind="PAYMENT" due={totals.balance_paise} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'advance' && <PaymentDialog booking={booking} kind="ADVANCE" due={0} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'refund' && <PaymentDialog booking={booking} kind="REFUND" due={0} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'dates' && <DatesDialog booking={booking} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'move' && <MoveDialog booking={booking} onClose={() => setOpen(null)} onDone={refresh} />}
      {open === 'checkout' && <CheckOutDialog booking={booking} balance={totals.balance_paise} onClose={() => setOpen(null)} onDone={(out) => { refresh(); if (out?.invoice_id) nav(`/app/billing/invoices/${out.invoice_id}`); }} />}
    </div>
  );
}
