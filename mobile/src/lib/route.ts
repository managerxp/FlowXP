/* Planning a field rep's day: which day, in what order, who needs a follow-up. Pure logic; the order the rep chooses is kept on the phone for that day. */
import type { Outcome, RouteShop } from './field.ts';

export type Stop = RouteShop & { beat_id: number; beat: string };

/** The days a rep can look at: today, tomorrow and the five days after, as YYYY-MM-DD from the phone's own calendar, with a word for each. */
export const planDays = (now: Date = new Date()): { id: string; label: string }[] => {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return { id: iso(d), label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }) };
  });
};

const has = (s: Stop, done: Set<number>) => s.visited || done.has(s.customer_id);

/** A suggested order: shops not yet visited first; those who owe the most overdue money before the rest; then those who have not ordered for longest; ties keep the beat's own order. */
export const suggest = (stops: Stop[], done: Set<number> = new Set()): Stop[] =>
  [...stops].sort((a, b) =>
    Number(has(a, done)) - Number(has(b, done)) ||
    b.overdue - a.overdue ||
    (a.last_order ?? '').localeCompare(b.last_order ?? '') ||
    a.seq - b.seq);

/** Put the stops in the order the rep chose (a list of customer ids); shops added to the beat since come last in their own order. */
export const applyOrder = (stops: Stop[], order: number[] | null): Stop[] => {
  if (!order?.length) return stops;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...stops].sort((a, b) => (rank.get(a.customer_id) ?? 1e6 + a.seq) - (rank.get(b.customer_id) ?? 1e6 + b.seq));
};

/** Move one stop up or down by one place. */
export const move = (ids: number[], id: number, by: -1 | 1): number[] => {
  const i = ids.indexOf(id); const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; return next;
};

export const orderKey = (business: number | null, date: string): string => `route-order:${business}:${date}`;
export const parseOrder = (raw: string | null): number[] | null => { try { const v = JSON.parse(raw || 'null') as unknown; return Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? (v as number[]) : null; } catch { return null; } };

/* ── follow-ups: a shop the rep said to visit again on or before this day, and has not visited since ── */
export type PastVisit = { customer_id: number; customer: string; visit_date: string; outcome: Outcome; next_visit_date: string | null };

export const followUps = (visits: PastVisit[], date: string, onRoute: Set<number>, visitedSince: Map<number, string> = new Map()): PastVisit[] => {
  const latest = new Map<number, PastVisit>();
  for (const v of visits) { const cur = latest.get(v.customer_id); if (!cur || v.visit_date > cur.visit_date) latest.set(v.customer_id, v); }
  return [...latest.values()]
    .filter((v) => v.next_visit_date && v.next_visit_date <= date && !onRoute.has(v.customer_id) && !((visitedSince.get(v.customer_id) ?? '') > v.visit_date))
    .sort((a, b) => (a.next_visit_date as string).localeCompare(b.next_visit_date as string) || a.customer.localeCompare(b.customer));
};

/** "due today", "1 day late", "5 days late". */
export const dueText = (next: string, date: string): string => {
  const days = Math.round((Date.parse(date) - Date.parse(next)) / 86400000);
  return days <= 0 ? 'due today' : `${days} day${days === 1 ? '' : 's'} late`;
};
