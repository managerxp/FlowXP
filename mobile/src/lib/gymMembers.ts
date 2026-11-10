/* The gym's members on a phone: find one, see their membership, sell or renew it, freeze it, add a new member, and today's visits and classes. The server decides every rule (price, dates,
   whether a plan can be frozen); these are the shapes and the small sums the screens need. */

export type Freeze = { from_date?: string; to_date?: string; from?: string; to?: string };
export type MembershipView = {
  membership_id: number; plan_id: number; plan_name: string; start_date: string; end_date: string; status: string;
  state: 'ACTIVE' | 'GRACE' | 'FROZEN' | 'UPCOMING' | 'EXPIRED' | 'CANCELLED' | 'TRANSFERRED';
  payment: string; payment_ok: boolean; days_left: number | null; price: number; amount_due: number; freeze_allowed: boolean; max_freeze_days: number; freezes: Freeze[];
};
export type Visit = { attendance_id: number; check_in_at: string; check_out_at: string | null; status?: string };
export type MemberFull = {
  member_id: number; member_code: string; name: string; phone: string | null; email: string | null; status: string;
  memberships: MembershipView[]; recent_visits: Visit[]; stats: { visits: number; visits_30d: number; last_visit: string | null };
};
export type DayVisit = { attendance_id: number; member_id: number; member_code: string; member_name: string; check_in_at: string; check_out_at: string | null; status: string };
export type ClassSession = {
  session_id: number; starts_at: string; ends_at: string; capacity: number; room: string | null; status: string; class_name: string; trainer_name: string | null; booked: number; waitlisted: number; seats_left: number;
};
export type Booking = { booking_id: number; member_id: number; status: 'BOOKED' | 'ATTENDED' | 'NO_SHOW' | 'WAITLISTED' | 'CANCELLED'; member_code: string; member_name: string };

const LIVE = ['ACTIVE', 'GRACE', 'FROZEN', 'UPCOMING'];
/** The membership that matters now: the newest one that is running, in grace, frozen or about to start; null when there is none (the server sends the newest first). */
export const currentMembership = (m: Pick<MemberFull, 'memberships'>): MembershipView | null => m.memberships.find((x) => LIVE.includes(x.state)) ?? null;
/** The one to renew: the current one, else the newest that has ended. */
export const renewable = (m: Pick<MemberFull, 'memberships'>): MembershipView | null => currentMembership(m) ?? m.memberships.find((x) => x.state === 'EXPIRED') ?? null;

export const STATE_TEXT: Record<MembershipView['state'], string> = { ACTIVE: 'Active', GRACE: 'Just ended (grace days)', FROZEN: 'Frozen', UPCOMING: 'Starts soon', EXPIRED: 'Ended', CANCELLED: 'Cancelled', TRANSFERRED: 'Moved to someone else' };
export const daysLeftText = (m: Pick<MembershipView, 'state' | 'days_left' | 'end_date'>): string =>
  m.state === 'ACTIVE' && m.days_left != null ? (m.days_left <= 0 ? 'Ends today' : m.days_left === 1 ? '1 day left' : `${m.days_left} days left`) : '';

export type Pay = 'FULL' | 'PART' | 'LATER';
export const METHODS: { id: string; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'BANK_TRANSFER', label: 'Bank transfer' }, { id: 'OTHER', label: 'Other' }];

/** Selling and renewing share one body: the plan, and how it is paid for (all now, part now, or nothing yet). */
export const sellBody = (planId: number, pay: Pay, method: string, partRupees = 0) => ({
  plan_id: planId,
  ...(pay === 'FULL' ? { payment: { method, amount: 'FULL' } } : pay === 'PART' && partRupees > 0 ? { payment: { method, amount: partRupees } } : {})
});
export const sellProblem = (planId: number | null, pay: Pay, partRupees: number): string => {
  if (!planId) return 'Choose a plan.';
  if (pay === 'PART' && !(partRupees > 0)) return 'Type how much was paid now.';
  return '';
};

const addDaysISO = (iso: string, days: number): string => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
/** A freeze of `days` days starting today. */
export const freezeBody = (days: number, todayISO: string) => ({ from: todayISO, to: addDaysISO(todayISO, Math.max(1, Math.round(days)) - 1) });
export const freezeProblem = (days: number, max: number): string => (!(days >= 1) ? 'Type how many days.' : days > max ? `This plan allows up to ${max} days.` : '');

export const newMemberProblem = (name: string, phone: string): string => (name.trim().length < 2 ? 'Type the member’s name.' : phone.replace(/\D/g, '').length < 10 ? 'Type the 10-digit mobile number.' : '');
export const newMemberBody = (name: string, phone: string, email: string, confirmDuplicate = false) => ({
  name: name.trim(), phone: phone.replace(/\D/g, '').slice(-10), ...(email.trim() ? { email: email.trim() } : {}), ...(confirmDuplicate ? { confirm_duplicate: true } : {})
});

/** Today's date on this phone as YYYY-MM-DD, and a list from either a plain array or a { rows } page. */
export const todayISO = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const rowsOf = <T,>(r: T[] | { rows?: T[] } | null | undefined): T[] => (Array.isArray(r) ? r : r?.rows ?? []);

export const timeOf =(iso: string): string => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const BOOKING_TEXT: Record<Booking['status'], string> = { BOOKED: 'Booked', ATTENDED: 'Came', NO_SHOW: 'Did not come', WAITLISTED: 'Waiting list', CANCELLED: 'Cancelled' };
