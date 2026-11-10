/* The gaming lounge desk on a phone, beyond the board: bookings, players and their wallets, tournaments, and the takings. The server decides every rule (clashes, holds, fees);
   these are the shapes and the small sums the screens need. Times are real moments; the phone shows them in its own clock, which is the lounge's. */

export type Booking = {
  booking_id: number; station_id: number; station_name: string; starts_at: string; ends_at: string; minutes: number; players: number; name: string | null; phone: string | null;
  status: 'BOOKED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW'; note: string | null; session_id: number | null;
};
export type StationLite = { station_id: number; name: string; max_players: number; status: string };
export type Player = { customer_id: number; name: string; phone: string | null; gamer_tag: string | null; player_id: number | null; is_minor: boolean; wallet: number };
export type Tournament = {
  tournament_id: number; name: string; game_name: string | null; starts_at: string; entry_fee: number; prize_pool: number; max_players: number | null; status: 'PLANNED' | 'OPEN' | 'RUNNING' | 'DONE' | 'CANCELLED';
  entries?: number; paid?: number; checked_in?: number; entries_list?: Entry[];
};
export type Entry = { entry_id: number; name: string; phone: string | null; status: string; placement: number | null; prize: number; paid: boolean };
export type Takings = { gaming: number; fnb: number; total: number; bills: number; sessions: number; hours_played: number; average_session_minutes: number; average_bill: number; players: number };

export const BOOKING_TEXT: Record<Booking['status'], string> = { BOOKED: 'Waiting', SEATED: 'Playing', CANCELLED: 'Cancelled', NO_SHOW: 'Did not come' };
export const TOURNAMENT_TEXT: Record<Tournament['status'], string> = { PLANNED: 'Planned', OPEN: 'Taking entries', RUNNING: 'Under way', DONE: 'Finished', CANCELLED: 'Cancelled' };
export const WALLET_METHODS: { id: string; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'OTHER', label: 'Other' }];
export const DURATIONS: { id: string; label: string }[] = [{ id: '30', label: '30 min' }, { id: '60', label: '1 hour' }, { id: '90', label: '1.5 hours' }, { id: '120', label: '2 hours' }, { id: '180', label: '3 hours' }];

export const dateISO = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Start times for a day in half-hour steps, 10:00 to 23:30, leaving out the ones already gone when the day is today. Each id is the real moment (ISO). */
export const slotsFor = (day: Date, now = new Date()): { id: string; label: string }[] => {
  const out: { id: string; label: string }[] = [];
  for (let h = 10; h <= 23; h++) for (const m of [0, 30]) {
    const d = new Date(day); d.setHours(h, m, 0, 0);
    if (d.getTime() < now.getTime() - 5 * 60000) continue;
    out.push({ id: d.toISOString(), label: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
  }
  return out;
};

export const bookingProblem = (stationId: number | null, startsAt: string, name: string): string => (!stationId ? 'Choose the station.' : !startsAt ? 'Choose the start time.' : name.trim().length < 2 ? 'Type who it is for.' : '');
export const bookingBody = (stationId: number, startsAt: string, minutes: number, players: number, name: string, phone: string, note = '') => ({
  station_id: stationId, starts_at: startsAt, minutes, players, guest_name: name.trim(),
  ...(phone.replace(/\D/g, '').length >= 7 ? { guest_phone: phone.replace(/\D/g, '').slice(-10) } : {}), ...(note.trim() ? { note: note.trim() } : {})
});

export const newPlayerProblem = (name: string, phone: string): string => (name.trim().length < 2 ? 'Type the player’s name.' : phone && phone.replace(/\D/g, '').length < 10 ? 'Type the 10-digit mobile number, or leave it empty.' : '');
export const newPlayerBody = (name: string, phone: string, tag: string) => ({ name: name.trim(), ...(phone.replace(/\D/g, '').length >= 10 ? { phone: phone.replace(/\D/g, '').slice(-10) } : {}), ...(tag.trim() ? { gamer_tag: tag.trim() } : {}) });
export const topupProblem = (amount: number): string => (!(amount >= 1) ? 'Type the amount.' : amount > 500000 ? 'One top-up can be at most ₹5,00,000.' : '');
export const topupBody = (amount: number, method: string, requestId: string) => ({ amount, method, request_id: requestId });

export const entryBody = (p: { customer_id?: number | null; name?: string; phone?: string }, payNow: boolean, method: string) => ({
  customer_id: p.customer_id ?? null, ...(p.customer_id ? {} : { player_name: (p.name ?? '').trim(), ...(p.phone && p.phone.replace(/\D/g, '').length >= 7 ? { phone: p.phone.replace(/\D/g, '').slice(-10) } : {}) }),
  ...(payNow ? { payment: { method, amount: 'FULL' } } : {})
});

/** The window for the takings: today, the last 7 days, or the last 30 (the end is today). */
export const windowFor = (id: 'today' | 'week' | 'month', today = new Date()): { from: string; to: string } => ({ from: dateISO(addDays(today, id === 'today' ? 0 : id === 'week' ? -6 : -29)), to: dateISO(today) });
export const inr = (n: number): string => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
