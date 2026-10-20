/* The hotel front desk on a phone: today's arrivals and departures, who is in the house, the rooms and their housekeeping state, and a guest's bill with check-in, a payment and check-out.
   The server decides everything (rates, availability, tax, the invoice); these only shape what a screen shows and sends. Online only: a stay is a live record shared by the whole desk. */

export type HotelDash = {
  business_date: string; arrivals_due: number; arrivals_late: number; departures_due: number; rooms_in_house: number; guests_in_house: number;
  total_rooms: number; out_of_order: number; dirty: number; rooms_arriving: number; occupancy_pct: number; check_in_time?: string; check_out_time?: string;
};
export type StayRow = {
  booking_id: number; res_no: string; status: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW'; arrival: string; departure: string; guest_name: string; phone: string | null;
  is_vip: boolean; rooms: string | null; adults: number; charges_paise: number; paid_paise: number; balance_paise: number; company: string | null;
};
export type Hk = 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER';
export type RackRoom = {
  room_id: number; room_no: string; floor: string | null; hk_status: Hk; hk_note: string | null; room_type: string; occupancy: 'VACANT' | 'OCCUPIED' | 'DUE_OUT' | 'ARRIVING';
  stay_booking_id: number | null; stay_guest: string | null; stay_departure: string | null; next_guest: string | null; next_arrival: string | null; blocked: boolean;
};
export type BookingRoom = { rr_id: number; room_id: number | null; room_no: string | null; room_type: string; status: string; adults: number; children: number };
export type BookingDetail = {
  booking_id: number; res_no: string; status: StayRow['status']; arrival: string; departure: string; guest_name: string; guest_phone: string | null; is_vip: boolean;
  rate_plan: string | null; notes: string | null; rooms: BookingRoom[]; charges_paise: number | string; paid_paise: number | string; balance_paise: number;
};
export type FolioCharge = { charge_id: number; description: string; department: string; quantity: number | string; amount_paise: number | string; tax_paise: number | string; voided_at: string | null; room_no: string | null };
export type FolioPayment = { fp_id: number; kind: 'ADVANCE' | 'PAYMENT' | 'REFUND'; method: string; amount_paise: number | string; pay_date: string };
export type Folio = { charges: FolioCharge[]; payments: FolioPayment[]; totals: { charges_paise: number; tax_paise: number; paid_paise: number; balance_paise: number; restaurant_paise: number } };

export const HK_LABEL: Record<Hk, string> = { CLEAN: 'Clean', DIRTY: 'Dirty', INSPECTED: 'Inspected', OUT_OF_ORDER: 'Out of order' };
export const HK_ORDER: Hk[] = ['DIRTY', 'CLEAN', 'INSPECTED', 'OUT_OF_ORDER'];
export const OCCUPANCY_LABEL: Record<RackRoom['occupancy'], string> = { VACANT: 'Vacant', OCCUPIED: 'Occupied', DUE_OUT: 'Due out', ARRIVING: 'Arriving today' };
export const STAY_LABEL: Record<StayRow['status'], string> = { CONFIRMED: 'Booked', CHECKED_IN: 'In house', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled', NO_SHOW: 'No show' };
export const PAY_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
export type PayMethod = typeof PAY_METHODS[number];
export const PAY_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', OTHER: 'Other', CREDIT: 'On account' };

/** The housekeeping states a room can be moved to from where it is now. */
export const hkChoices = (now: Hk): Hk[] => HK_ORDER.filter((h) => h !== now);

/** Rooms to look at first: due out, then arriving, then dirty, then the rest; each group in room order. */
export const rackSort = (rooms: RackRoom[]): RackRoom[] => {
  const rank = (r: RackRoom) => (r.occupancy === 'DUE_OUT' ? 0 : r.occupancy === 'ARRIVING' ? 1 : r.hk_status === 'DIRTY' ? 2 : 3);
  return [...rooms].sort((a, b) => rank(a) - rank(b) || a.room_no.localeCompare(b.room_no, undefined, { numeric: true }));
};
export type RackFilter = 'all' | 'dirty' | 'vacant' | 'occupied';
export const rackFilter = (rooms: RackRoom[], f: RackFilter): RackRoom[] =>
  f === 'dirty' ? rooms.filter((r) => r.hk_status === 'DIRTY') : f === 'vacant' ? rooms.filter((r) => r.occupancy === 'VACANT' || r.occupancy === 'ARRIVING') : f === 'occupied' ? rooms.filter((r) => r.occupancy === 'OCCUPIED' || r.occupancy === 'DUE_OUT') : rooms;

/** The rooms on a stay that still have no room number (held by type only). */
export const unassignedRooms = (b: Pick<BookingDetail, 'rooms'>): BookingRoom[] => b.rooms.filter((r) => r.status !== 'CANCELLED' && !r.room_id);

/** Why a booking cannot be checked in from the phone, or an empty string when it can. `picked` maps a room line (rr_id) to the room number chosen for it now. */
export const checkInProblem = (b: Pick<BookingDetail, 'status' | 'rooms'>, picked: Record<number, number> = {}): string => {
  if (b.status !== 'CONFIRMED') return b.status === 'CHECKED_IN' ? 'Already checked in' : 'This booking cannot be checked in';
  const live = b.rooms.filter((r) => r.status !== 'CANCELLED');
  if (!live.length) return 'There is no room on this booking';
  if (unassignedRooms(b).some((r) => !picked[r.rr_id])) return 'Choose a room number for each room first.';
  const chosen = Object.values(picked).filter(Boolean);
  if (new Set(chosen).size !== chosen.length) return 'The same room is chosen twice.';
  return '';
};
/** What check-in sends: the room numbers picked for rooms that had none. */
export const checkInBody = (picked: Record<number, number>, allowDirty = false) => ({ assignments: Object.entries(picked).filter(([, room]) => room).map(([rr, room]) => ({ rr_id: Number(rr), room_id: room })), ...(allowDirty ? { allow_dirty: true } : {}) });

/** What check-out sends: what is still owed is settled by a method, a credit balance is refunded by one. */
export const checkOutBody = (balancePaise: number, method: PayMethod | '', reference = '') => {
  if (balancePaise > 0) return { settlement: { method, ...(reference.trim() ? { reference: reference.trim() } : {}) } };
  if (balancePaise < 0) return { refund_method: method };
  return {};
};
export const checkOutProblem = (balancePaise: number, method: PayMethod | ''): string => (balancePaise !== 0 && !method ? (balancePaise > 0 ? 'Choose how the balance is paid' : 'Choose how the refund is paid') : '');

export const paymentProblem = (amount: string, method: PayMethod | ''): string => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 'Type an amount above zero';
  return method ? '' : 'Choose how it was paid';
};
export const paymentBody = (amount: string, method: PayMethod, reference: string, kind: 'ADVANCE' | 'PAYMENT' | 'REFUND' = 'PAYMENT') => ({ kind, method, amount: Number(amount), ...(reference.trim() ? { reference: reference.trim() } : {}) });

/** A stay as one line: "Room 204 · to 14 Oct". */
export const stayLine = (s: Pick<StayRow, 'rooms' | 'departure'>): string => `${s.rooms ? `Room ${s.rooms}` : 'No room yet'} · to ${new Date(`${s.departure}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;

export const HOTEL_TYPES = ['HOTEL'];

/** An in-house guest the restaurant bill can be put on (GET /hotel/room-charge/guests). */
export type RoomGuest = { booking_id: number; res_no: string; guest_name: string; rooms: string | null; is_vip: boolean; balance_paise: number | string };
export const roomGuestLine = (g: Pick<RoomGuest, 'guest_name' | 'rooms'>): string => `${g.guest_name}${g.rooms ? ` · room ${g.rooms}` : ''}`;

/** A bill charged to a room is not paid at the till: the payment is dropped and the stay it goes on is named. The bill reaches the guest's folio and is paid at check-out. */
export const roomChargeBody = <T extends object>(body: T, bookingId: number): Omit<T, 'payment'> & { charge_to_booking_id: number } => {
  const { payment: _paid, ...rest } = body as T & { payment?: unknown };
  return { ...(rest as Omit<T, 'payment'>), charge_to_booking_id: bookingId };
};
