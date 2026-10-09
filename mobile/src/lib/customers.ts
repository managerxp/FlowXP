import type { Customer } from './types.ts';
import { toPaise } from './money.ts';

/* Customers in plain words: who owes, who spends most, and taking a payment against a bill. */

export type Show = 'all' | 'owing' | 'best';

export const owes = (c: Pick<Customer, 'outstanding_balance'>): boolean => toPaise(c.outstanding_balance) > 0;

/** "₹840 due" for someone who owes, else "₹1,250 spent", else nothing for a new customer. */
export const headline = (c: Pick<Customer, 'outstanding_balance' | 'total_purchases'>, money: (n: number) => string): { text: string; due: boolean } | null =>
  owes(c) ? { text: `${money(c.outstanding_balance)} due`, due: true } : c.total_purchases > 0 ? { text: `${money(c.total_purchases)} spent`, due: false } : null;

export const arrange = <T extends Pick<Customer, 'name' | 'outstanding_balance' | 'total_purchases'>>(rows: T[], show: Show): T[] => {
  if (show === 'owing') return rows.filter(owes).sort((a, b) => b.outstanding_balance - a.outstanding_balance);
  if (show === 'best') return rows.filter((c) => c.total_purchases > 0).sort((a, b) => b.total_purchases - a.total_purchases);
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
};

export const totalDuePaise = (rows: Pick<Customer, 'outstanding_balance'>[]): number => rows.reduce((a, c) => a + Math.max(0, toPaise(c.outstanding_balance)), 0);

/** When they last came: "today", "yesterday", "5 days ago", "3 months ago". */
export const since = (iso: string | null, now = Date.now()): string => {
  if (!iso) return '';
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : days < 365 ? `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago` : 'over a year ago';
};

export const sub = (c: Pick<Customer, 'phone' | 'bills' | 'last_bill_date'>): string =>
  [c.phone, c.bills ? `${c.bills} bill${c.bills === 1 ? '' : 's'}` : 'New', c.last_bill_date ? `last ${since(c.last_bill_date)}` : null].filter(Boolean).join(' · ');

/* ── taking a payment against a bill ── */
export type PayMethod = 'UPI' | 'CASH' | 'CARD';
export const paymentProblem = (amount: string, dueRupees: number): string => {
  const v = Number(amount);
  if (amount.trim() === '' || !Number.isFinite(v) || v <= 0) return 'Enter how much they paid';
  if (toPaise(amount) > toPaise(dueRupees)) return 'That is more than they owe on this bill';
  return '';
};
export const paymentBody = (amount: string, method: PayMethod, reference: string) => ({ amount: Number(amount), method, ...(reference.trim() ? { reference_number: reference.trim() } : {}) });
