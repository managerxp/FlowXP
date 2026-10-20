/* The hotel front desk, phase 2: making a booking or a walk-in, adding a charge to a guest's bill, cancelling, marking a no-show, and moving a guest to another room.
   The server works out rates, availability and tax; these only shape what a screen asks and sends. */
import type { BookingDetail, BookingRoom, Hk, PayMethod } from './hotel.ts';

export type RoomType = { room_type_id: number; name: string; code: string; base_rate: number; base_adults: number; max_adults: number; max_children: number };
export type RatePlan = { rate_plan_id: number; name: string; is_default: boolean; meal_plan_name?: string };
export type FreeRoom = { room_id: number; room_no: string; floor: string | null; hk_status: Hk; room_type_id: number; room_type: string };
export type Quote = { room_type: string; nights: { date: string; rate_paise: number }[]; total_paise: number };
export type GuestHit = { guest_id: number; name: string; phone: string | null; is_vip: boolean };

export const DEPARTMENTS: readonly (readonly [string, string])[] = [['FNB', 'Food and drink'], ['LAUNDRY', 'Laundry'], ['SPA', 'Spa'], ['TRANSPORT', 'Transport'], ['MISC', 'Other']];
export const MAX_ROOMS = 5;

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(day(s));
/** The departure date for a stay of `nights` nights from `arrival` (both yyyy-mm-dd). */
export const departureFor = (arrival: string, nights: number): string => new Date(day(arrival) + Math.max(1, nights) * 86400000).toISOString().slice(0, 10);
export const nightsBetween = (arrival: string, departure: string): number => Math.round((day(departure) - day(arrival)) / 86400000);

export type StayForm = {
  guestId: number | null; name: string; phone: string; arrival: string; nights: number; roomTypeId: number | null; rooms: number; adults: number; children: number;
  ratePlanId: number | null; roomId: number | null; advance: string; method: PayMethod | ''; notes: string;
};

export const stayProblem = (f: StayForm, today: string, walkIn: boolean): string => {
  if (!f.guestId && !f.name.trim()) return 'Type the guest name, or choose a guest you know.';
  if (!f.roomTypeId) return 'Choose a room type.';
  if (!isDay(f.arrival)) return 'Type the arrival date like 2026-10-20.';
  if (!walkIn && f.arrival < today) return 'The arrival cannot be before today.';
  if (!(f.nights >= 1 && f.nights <= 60)) return 'Stay from 1 to 60 nights.';
  if (!(f.rooms >= 1 && f.rooms <= MAX_ROOMS)) return `Book from 1 to ${MAX_ROOMS} rooms.`;
  if (!(f.adults >= 1)) return 'At least one adult.';
  if (walkIn && f.rooms > 1) return 'A walk-in is one room at a time. Check in each room as its own stay.';
  if (walkIn && !f.roomId) return 'Choose the room number for a walk-in guest.';
  if (f.roomId && f.rooms > 1) return 'A room number can only be chosen when booking one room.';
  const adv = Number(f.advance || 0);
  if (f.advance && (!Number.isFinite(adv) || adv < 0)) return 'The advance is not a valid amount.';
  if (adv > 0 && !f.method) return 'Choose how the advance was paid.';
  return '';
};

/** POST /hotel/bookings, or /hotel/walk-ins (a walk-in arrives today, so it sends no arrival date). */
export const stayBody = (f: StayForm, walkIn: boolean, allowDirty = false) => {
  const adv = Number(f.advance || 0);
  return {
    guest: f.guestId ? { guest_id: f.guestId } : { name: f.name.trim(), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}) },
    ...(walkIn ? {} : { arrival: f.arrival }), departure: departureFor(f.arrival, f.nights),
    rooms: Array.from({ length: f.rooms }, () => ({ room_type_id: f.roomTypeId, adults: f.adults, children: f.children, ...(f.roomId ? { room_id: f.roomId } : {}) })),
    ...(f.ratePlanId ? { rate_plan_id: f.ratePlanId } : {}), source: walkIn ? 'WALK_IN' : 'PHONE',
    ...(adv > 0 ? { advance: { amount: adv, method: f.method } } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}), ...(allowDirty ? { allow_dirty: true } : {})
  };
};

/** The price quote to show before saving, or null until a room type and a date are chosen. */
export const quotePath = (f: Pick<StayForm, 'arrival' | 'nights' | 'roomTypeId' | 'ratePlanId' | 'adults' | 'children'>): string | null =>
  f.roomTypeId && isDay(f.arrival) ? `/hotel/quote?room_type_id=${f.roomTypeId}&arrival=${f.arrival}&departure=${departureFor(f.arrival, f.nights)}&adults=${f.adults}&children=${f.children}${f.ratePlanId ? `&rate_plan_id=${f.ratePlanId}` : ''}` : null;
export const freeRoomsPath = (roomTypeId: number, arrival: string, departure: string, excludeRr?: number): string =>
  `/hotel/free-rooms?room_type_id=${roomTypeId}&arrival=${arrival}&departure=${departure}${excludeRr ? `&exclude_rr_id=${excludeRr}` : ''}`;

export const chargeProblem = (description: string, price: string, quantity: string, taxRate: string): string => {
  if (!description.trim()) return 'Say what the charge is for.';
  const p = Number(price); const q = Number(quantity || 1); const t = Number(taxRate || 0);
  if (!Number.isFinite(p) || p <= 0) return 'Type a price above zero.';
  if (!Number.isFinite(q) || q <= 0) return 'The quantity must be above zero.';
  if (!Number.isFinite(t) || t < 0 || t > 100) return 'GST is from 0 to 100.';
  return '';
};
export const chargeBody = (department: string, description: string, price: string, quantity: string, taxRate: string, rrId?: number) =>
  ({ department, description: description.trim(), price: Number(price), quantity: Number(quantity || 1), tax_rate: Number(taxRate || 0), ...(rrId ? { rr_id: rrId } : {}) });

export const reasonProblem = (reason: string): string => (reason.trim() ? '' : 'Say why.');
export const reasonBody = (reason: string) => ({ reason: reason.trim().slice(0, 300) });

/** A booking can be cancelled before check-in, and marked no-show once its arrival day has come. */
export const canCancel = (b: Pick<BookingDetail, 'status'>): boolean => b.status === 'CONFIRMED';
export const canNoShow = (b: Pick<BookingDetail, 'status' | 'arrival'>, today: string): boolean => b.status === 'CONFIRMED' && b.arrival <= today;
/** The room lines that can be moved to another room: held or in the house, with a room already. */
export const movableRooms = (b: Pick<BookingDetail, 'rooms'>): BookingRoom[] => b.rooms.filter((r) => ['RESERVED', 'IN_HOUSE'].includes(r.status) && r.room_id);
export const moveBody = (rrId: number, roomId: number, reason: string) => ({ rr_id: rrId, room_id: roomId, ...(reason.trim() ? { reason: reason.trim().slice(0, 200) } : {}) });
