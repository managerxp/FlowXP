import type { SalesReport } from './types.ts';

/* Reports in plain words: the average bill, a sentence or two about what happened, and what the estimated profit means. */

export type Profit = { net_revenue: number; contribution: number; estimated_net: number; food_cost_pct: number | null };

export const averageBill = (r: Pick<SalesReport, 'total_sales' | 'invoice_count'>): number => (r.invoice_count > 0 ? r.total_sales / r.invoice_count : 0);

const clock = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
export const hourWords = (h: number): string => `${clock(h)} to ${clock((h + 1) % 24)}`;

/** Up to three plain sentences: the best seller, the busiest hour, how most people paid. Nothing when there were no sales. */
export const insights = (r: SalesReport, money: (n: number) => string): string[] => {
  if (!r.invoice_count) return [];
  const out: string[] = [];
  const top = r.top_products[0];
  if (top) out.push(`${top.name} sold the most: ${Math.round(top.quantity * 100) / 100} for ${money(top.revenue)}.`);
  const hour = [...r.by_hour].sort((a, b) => b.total - a.total)[0];
  if (hour && r.by_hour.length > 1) out.push(`Busiest time was ${hourWords(hour.hour)}.`);
  const pay = [...r.by_payment_method].sort((a, b) => b.amount - a.amount)[0];
  if (pay && r.total_sales > 0 && r.by_payment_method.length > 1) out.push(`Most people paid by ${pay.method === 'UPI' ? 'UPI' : pay.method.toLowerCase().replace(/_/g, ' ')} (${Math.round((pay.amount / r.total_sales) * 100)}%).`);
  return out;
};

/** What the profit figure is, in one line: an estimate after what the items cost, expenses and wastage. */
export const profitNote = (p: Profit): string => `An estimate after what the items cost${p.food_cost_pct != null ? ` (${p.food_cost_pct}% of sales)` : ''}, expenses and wastage.`;
