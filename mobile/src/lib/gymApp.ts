/* Shapes and small helpers for the gym phone app (Members | Dashboard | Reports | Gym). The server works everything out; these only name what comes back. */

export type Renewals = { today: number; d3: number; d4_7: number; d8_15: number; d7: number; d15: number; d30: number; list: { member_id: number; member_code: string; name: string; phone: string | null; plan_name: string; ends_on: string; days_left: number }[] };
export type Birthday = { member_id: number; member_code: string; name: string; phone: string | null };
export type GymHome = {
  today: string; members: Record<string, number>;
  visits: { today: number; today_unique: number; open_now: number; last_7_days: number };
  joined_this_month: number; last_7_days: { date: string; visits: number }[];
  birthdays?: Birthday[]; renewals?: Renewals;
  money?: { received_today_paise: number; received_month_paise: number; owed_paise: number; owed_bills: number; billed_month: { membership_paise: number; training_paise: number; shop_paise: number; other_paise: number } };
};
export type Trends = { months: { month: string; collected_paise: number; new_members: number; memberships_started: number }[] };

export const n = (v: number | string | null | undefined): number => Number(v ?? 0) || 0;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11" or "2026-11-01" -> "Nov 26". */
export const monthLabel = (m: string): string => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(2, 4)}`;
/** Bar heights (0..1) so the tallest bar fills the chart. */
export const scaleBars = (v: number[]): number[] => { const top = Math.max(1, ...v); return v.map((x) => x / top); };
/** A phone number as the digits wa.me wants (India by default). */
export const waNumber = (phone: string): string => { const d = phone.replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };
