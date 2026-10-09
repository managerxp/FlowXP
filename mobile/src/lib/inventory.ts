import type { StockRow } from './types.ts';

/* Stock in plain words: is it out, low or fine; a count to add or correct; and what is sent to the server. */

export type Status = 'out' | 'low' | 'in';
export const statusOf = (r: Pick<StockRow, 'current_stock' | 'low_stock'>): Status => (r.current_stock <= 0 ? 'out' : r.low_stock ? 'low' : 'in');
export const STATUS_LABEL: Record<Status, string> = { out: 'Out of stock', low: 'Low stock', in: 'In stock' };

export type Filter = 'all' | Status;
export const counts = (rows: Pick<StockRow, 'current_stock' | 'low_stock'>[]): Record<Filter, number> => {
  const c = { all: rows.length, out: 0, low: 0, in: 0 };
  for (const r of rows) c[statusOf(r)]++;
  return c;
};
export const visible = <T extends Pick<StockRow, 'current_stock' | 'low_stock' | 'name'>>(rows: T[], filter: Filter, q: string): T[] => {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => (filter === 'all' || statusOf(r) === filter) && (!needle || r.name.toLowerCase().includes(needle)));
};

/** Worst first (out, then low, then fine), each group by name, so what needs buying is at the top. */
export const urgent = <T extends Pick<StockRow, 'current_stock' | 'low_stock' | 'name'>>(rows: T[]): T[] => {
  const rank: Record<Status, number> = { out: 0, low: 1, in: 2 };
  return [...rows].sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || a.name.localeCompare(b.name));
};

export type Mode = 'add' | 'adjust';
export const REASONS = ['Counted', 'Damaged', 'Expired', 'Used in the kitchen', 'Gift or sample'];

/** "10" or "-3" (adjust), or "10" (add: never negative). The reason is asked for on adjust and filled in on add. */
export const adjustProblem = (mode: Mode, amount: string, reason: string): string => {
  const v = Number(amount);
  if (amount.trim() === '' || !Number.isFinite(v) || v === 0) return mode === 'add' ? 'Enter how many came in' : 'Enter how many to add (like 10) or take away (like -3)';
  if (mode === 'add' && v < 0) return 'To take stock away, use Adjust stock';
  if (mode === 'adjust' && !reason.trim()) return 'Say why you are changing the stock';
  return '';
};
export const adjustBody = (productId: number, mode: Mode, amount: string, reason: string) => ({ product_id: productId, quantity: Number(amount), reason: (mode === 'add' ? reason.trim() || 'Stock received' : reason.trim()) });

/** What the shelf will show after the change, said in words. */
export const afterText = (current: number, amount: string, unit: string | null): string => {
  const v = Number(amount);
  if (!Number.isFinite(v) || v === 0) return '';
  const next = Math.round((current + v) * 1000) / 1000;
  return `${next < 0 ? 'Below zero' : 'Will be'}: ${next} ${unit ?? ''}`.trim();
};
