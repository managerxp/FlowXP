/* Moving guests around the floor (move, merge, split a table), booking tables, and the waiting list: the choices a screen offers and the bodies it sends. The server decides; these only shape. */
import type { Order, OrderItem, TableRow } from './orders.ts';

export type Waiter = { user_id: number; name: string; role: string };
export type Reservation = {
  reservation_id: number; table_id: number | null; table_name: string | null; guest_name: string; phone: string | null; party_size: number;
  reserved_at: string; duration_min: number; status: 'BOOKED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED'; notes: string | null;
};
export type WaitEntry = { entry_id: number; guest_name: string; phone: string | null; party_size: number; quoted_wait_min: number | null; waited_min: number; status: 'WAITING' | 'NOTIFIED' };

/** Tables nobody is at and nothing holds: where a party can be moved or part of it split off to. */
export const freeTables = (tables: TableRow[], exceptId?: number | null): TableRow[] =>
  tables.filter((t) => !t.open_order_id && t.status === 'FREE' && t.table_id !== exceptId);

/** Other running dine-in orders this one can be merged into, or part of it moved to. */
export const otherOrders = (orders: Order[], currentId: number): Order[] =>
  orders.filter((o) => o.order_id !== currentId && o.table_id != null && o.order_type === 'DINE_IN' && !['BILLED', 'CANCELLED', 'MERGED'].includes(o.status));

/** What a split sends: the chosen lines (a part-quantity only when fewer than all), and where they go. */
export const splitBody = (items: OrderItem[], chosen: Record<number, number>, to: { table_id: number } | { to_order_id: number }) => ({
  items: items.filter((i) => (chosen[i.order_item_id] ?? 0) > 0).map((i) => {
    const q = Math.min(chosen[i.order_item_id], i.quantity);
    return q < i.quantity ? { order_item_id: i.order_item_id, quantity: q } : { order_item_id: i.order_item_id };
  }),
  ...to
});

/** A time typed as 19:30 (or 7:30) becomes today at that time as an ISO string; null when it is not a time or has already passed by more than 15 minutes. */
export const clockToday = (text: string, now: Date = new Date()): string | null => {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const at = new Date(now); at.setHours(h, min, 0, 0);
  return at.getTime() < now.getTime() - 15 * 60000 ? null : at.toISOString();
};

/** "in 30 minutes" as an ISO time, for the quick buttons. */
export const inMinutes = (n: number, now: Date = new Date()): string => new Date(now.getTime() + n * 60000).toISOString();

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const RESERVATION_LABEL: Record<Reservation['status'], string> = { BOOKED: 'Booked', SEATED: 'Seated', CANCELLED: 'Cancelled', NO_SHOW: 'Did not come', COMPLETED: 'Done' };

/** A guest's party and phone checked the way the server will (so the cashier hears it before the round trip). */
export const guestProblem = (name: string, party: string, phone: string): string => {
  if (!name.trim()) return 'Enter the guest name';
  const n = Number(party);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 'Party size must be a whole number from 1 to 100';
  if (phone.trim() && phone.replace(/\D/g, '').slice(-10).length !== 10) return 'Enter a 10-digit mobile number, or leave it blank';
  return '';
};
