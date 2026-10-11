/*
 * The Reports screen's calls against a running FlowXP server and the demo café, with the app's own code: the day's sales, the average bill, the plain sentences,
 * and the estimated profit (shown only where the plan has it).
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:reports
 */
import { createApi, type Session } from '../src/lib/api.ts';
import { ranges } from '../src/lib/ranges.ts';
import { averageBill, insights, profitNote, type Profit } from '../src/lib/reportsView.ts';
import type { SalesReport } from '../src/lib/types.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'cafe@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const money = (n: number) => `₹${Math.round(n * 100) / 100}`;

for (const id of ['today', '7d'] as const) {
  const range = ranges().find((r) => r.id === id)!;
  const r = await api.get<SalesReport>(`/reports/sales?from=${range.from}&to=${range.to}`);
  ok(r.invoice_count > 0, `${range.label}: ${money(r.total_sales)} from ${r.invoice_count} bills, average ${money(averageBill(r))}`);
  const say = insights(r, money);
  ok(say.length > 0 && say.every((x) => x.endsWith('.')), `what happened: ${say.join(' ')}`);
  const p = await api.get<{ totals: Profit }>(`/profitability?from=${range.from}&to=${range.to}`).catch(() => null);
  ok(p === null || typeof p.totals.estimated_net === 'number', p ? `estimated profit ${money(p.totals.estimated_net)}. ${profitNote(p.totals)}` : 'no profit figure on this plan: the screen leaves it out');
}
console.log('All good.');
