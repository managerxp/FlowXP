/* Drives the hotel front desk on a running server with the app's own request builders: walk-in, booking, room numbers at check-in, charge, void, advance, move, cancel, check-out.
   node --experimental-strip-types --no-warnings scripts/hotel-live.mts   (API on :5100, seeded with `npm run seed:hotel` in backend/) */
import { createApi, type Session } from '../src/lib/api.ts';
import { checkInBody, checkInProblem, checkOutBody, paymentBody, type BookingDetail, type Folio, type HotelDash } from '../src/lib/hotel.ts';
import { chargeBody, departureFor, freeRoomsPath, movableRooms, moveBody, reasonBody, stayBody, stayProblem, type FreeRoom, type RoomType, type StayForm } from '../src/lib/hotelDesk.ts';

const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: 'http://localhost:5100', getSession: () => session, onToken: (t) => { session.token = t; } });
const RUN = Date.now();
let step = 0;
const ok = (what: string, extra = '') => console.log(`ok ${++step}. ${what}${extra ? ` (${extra})` : ''}`);
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAILED: ${what}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: 'hotel@flowxp.test', password: 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.get<{ businesses: { business_id: number; outlets: { branch_id: number }[] }[] }>('/auth/me');
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok('signed in');

const dash = await api.get<HotelDash>('/hotel/dashboard');
const today = dash.business_date;
ok('front desk', `${dash.rooms_in_house} in house, ${dash.arrivals_due} arriving, ${dash.occupancy_pct}%`);
const types = await api.get<RoomType[]>('/hotel/room-types');
must(types.length > 0, 'room types');
let type = types[0]; let most = -1;
for (const t of types) { const n = (await api.get<FreeRoom[]>(freeRoomsPath(t.room_type_id, today, departureFor(today, 2)))).length; if (n > most) { most = n; type = t; } }
console.log(`using ${type.name} (${most} free)`);

const base: StayForm = { guestId: null, name: 'Phone Test Guest', phone: '9876500001', arrival: today, nights: 2, roomTypeId: type.room_type_id, rooms: 1, adults: 2, children: 0, ratePlanId: null, roomId: null, advance: '', method: '', notes: 'made by hotel-live' };

// a booking for a later date, no room number yet, with an advance
const later = departureFor(today, 25);
const bookingForm = { ...base, arrival: later, advance: '1000', method: 'UPI' as const };
must(stayProblem(bookingForm, today, false) === '', 'booking form valid');
const quote = await api.get<{ total_paise: number }>(`/hotel/quote?room_type_id=${type.room_type_id}&arrival=${later}&departure=${departureFor(later, 2)}&adults=2&children=0`);
must(quote.total_paise > 0, 'quote');
const booked = await api.post<{ booking_id: number }>('/hotel/bookings', stayBody(bookingForm, false), { idempotencyKey: `hl-1-${RUN}` });
const again = await api.post<{ booking_id: number }>('/hotel/bookings', stayBody(bookingForm, false), { idempotencyKey: `hl-1-${RUN}` });
ok('booking saved with an advance', `#${booked.booking_id}, quote ${quote.total_paise / 100}`);
must(again.booking_id === booked.booking_id, 'the same key books once');
ok('a retried save did not book twice');
let b = await api.get<BookingDetail>(`/hotel/bookings/${booked.booking_id}`);
must(b.status === 'CONFIRMED' && b.rooms.some((r) => !r.room_id), 'booked with no room number');
const bf = await api.get<Folio>(`/hotel/bookings/${booked.booking_id}/folio`);
must(bf.payments.length === 1 && Number(bf.payments[0].amount_paise) === 100000, 'advance on the folio');
ok('advance is on the bill', `balance ${bf.totals.balance_paise / 100}`);

// cancel it with a reason
await api.call(`/hotel/bookings/${booked.booking_id}/cancel`, { method: 'POST', body: reasonBody('Guest changed plans') });
b = await api.get<BookingDetail>(`/hotel/bookings/${booked.booking_id}`);
must(b.status === 'CANCELLED', 'cancelled');
ok('cancelled with a reason');

// a walk-in: room chosen, checked in at once
const any = await api.get<FreeRoom[]>(freeRoomsPath(type.room_type_id, today, departureFor(today, 2)));
// housekeeping: rooms left dirty by earlier runs are marked clean, as the Rooms tab does
for (const r of any.slice(0, 3)) if (r.hk_status === 'DIRTY') await api.call(`/hotel/rooms/${r.room_id}/status`, { method: 'POST', body: { status: 'CLEAN' } });
const free = (await api.get<FreeRoom[]>(freeRoomsPath(type.room_type_id, today, departureFor(today, 2)))).filter((r) => r.hk_status !== 'DIRTY');
ok('rooms marked clean', `${free.length} ready`);
must(free.length > 1, 'free rooms of the type');
const walkForm = { ...base, roomId: free[0].room_id };
must(stayProblem(walkForm, today, true) === '', 'walk-in form valid');
const walk = await api.post<{ booking_id: number }>('/hotel/walk-ins', stayBody(walkForm, true), { idempotencyKey: `hl-2-${RUN}` });
b = await api.get<BookingDetail>(`/hotel/bookings/${walk.booking_id}`);
must(b.status === 'CHECKED_IN', 'walk-in is in the house');
ok('walk-in checked in', `room ${free[0].room_no}`);

// a charge, then another that is voided
const charge = await api.post<{ charge_id: number }>(`/hotel/bookings/${walk.booking_id}/charges`, chargeBody('LAUNDRY', 'Shirts', '150', '2', '12'), { idempotencyKey: `hl-3-${RUN}` });
const junk = await api.post<{ charge_id: number }>(`/hotel/bookings/${walk.booking_id}/charges`, chargeBody('MISC', 'Entered by mistake', '999', '1', '0'), { idempotencyKey: `hl-4-${RUN}` });
await api.call(`/hotel/charges/${junk.charge_id}/void`, { method: 'POST', body: reasonBody('Wrong guest') });
let f = await api.get<Folio>(`/hotel/bookings/${walk.booking_id}/folio`);
must(f.charges.filter((c) => !c.voided_at).some((c) => c.charge_id === charge.charge_id), 'charge on the bill');
must(f.charges.find((c) => c.charge_id === junk.charge_id)?.voided_at, 'voided charge is marked');
ok('charge added, another voided', `charges ${f.totals.charges_paise / 100}`);

// move to another room
b = await api.get<BookingDetail>(`/hotel/bookings/${walk.booking_id}`);
const line = movableRooms(b)[0];
await api.call(`/hotel/bookings/${walk.booking_id}/move-room`, { method: 'POST', body: moveBody(line.rr_id, free[1].room_id, 'AC not cooling') });
b = await api.get<BookingDetail>(`/hotel/bookings/${walk.booking_id}`);
must(b.rooms.some((r) => r.room_no === free[1].room_no && r.status === 'IN_HOUSE'), 'moved');
ok('moved to another room', `now room ${free[1].room_no}`);

// a booking arriving today: choose the room number at check-in
const todayForm = { ...base, name: 'Arrives Today', phone: '9876500002' };
const arr = await api.post<{ booking_id: number }>('/hotel/bookings', stayBody(todayForm, false), { idempotencyKey: `hl-5-${RUN}` });
b = await api.get<BookingDetail>(`/hotel/bookings/${arr.booking_id}`);
const loose = b.rooms.find((r) => !r.room_id);
must(loose, 'room without a number');
must(checkInProblem(b, {}) !== '', 'cannot check in without a number');
const pick = (await api.get<FreeRoom[]>(freeRoomsPath(type.room_type_id, today, departureFor(today, 2)))).find((r) => r.hk_status !== 'DIRTY' && !free.slice(0, 2).some((f) => f.room_id === r.room_id));
must(pick, 'a free room');
const picked = { [loose!.rr_id]: pick!.room_id };
must(checkInProblem(b, picked) === '', 'can check in once a number is chosen');
await api.call(`/hotel/bookings/${arr.booking_id}/check-in`, { method: 'POST', body: checkInBody(picked) });
b = await api.get<BookingDetail>(`/hotel/bookings/${arr.booking_id}`);
must(b.status === 'CHECKED_IN', 'checked in');
ok('room number chosen at check-in, then checked in', `room ${pick!.room_no}`);

// pay and check out the walk-in
f = await api.get<Folio>(`/hotel/bookings/${walk.booking_id}/folio`);
await api.call(`/hotel/bookings/${walk.booking_id}/payments`, { method: 'POST', body: paymentBody('100', 'CASH', '', 'PAYMENT'), idempotencyKey: `hl-6-${RUN}` });
f = await api.get<Folio>(`/hotel/bookings/${walk.booking_id}/folio`);
const out = await api.post<{ invoice_number?: string }>(`/hotel/bookings/${walk.booking_id}/check-out`, checkOutBody(f.totals.balance_paise, 'CASH'), { idempotencyKey: `hl-7-${RUN}` });
b = await api.get<BookingDetail>(`/hotel/bookings/${walk.booking_id}`);
must(b.status === 'CHECKED_OUT', 'checked out');
ok('paid and checked out', `invoice ${out.invoice_number ?? 'made'}`);

// leave the demo clean: check the second guest out too. The server may add the room charges as the bill closes, and says how much is still owed.
const f2 = await api.get<Folio>(`/hotel/bookings/${arr.booking_id}/folio`);
let owed = f2.totals.balance_paise;
try { await api.post(`/hotel/bookings/${arr.booking_id}/check-out`, checkOutBody(owed, 'CASH'), { idempotencyKey: `hl-8-${RUN}` }); }
catch (e) {
  const data = (e as { code?: string; data?: { balance_paise?: number } });
  must(data.code === 'BALANCE_DUE' && Number.isFinite(data.data?.balance_paise), 'the server names the balance');
  owed = data.data!.balance_paise as number;
  ok('check-out said what is still owed', `${owed / 100}`);
  await api.post(`/hotel/bookings/${arr.booking_id}/check-out`, checkOutBody(owed, 'CASH'), { idempotencyKey: `hl-9-${RUN}` });
}
b = await api.get<BookingDetail>(`/hotel/bookings/${arr.booking_id}`);
must(b.status === 'CHECKED_OUT', 'second guest checked out');
ok('second guest checked out');
console.log('ALL STEPS PASSED');
