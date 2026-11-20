/* Card results on the phone: GET /api/loyalty/analytics (owner only). The server reads the ledger and does every sum; the phone only chooses the period and words it.
   Loyalty endpoints return money as raw paise (strings), which is what rupees() wants. */
import { rupees } from './money.ts';

export type ResultCard = { programme_id: number; name: string; members: number; active: number; earned: number; used: number; claims: number; owed_paise: string };
export type Results = {
  days: number; active_share: number | null; cards: ResultCard[]; top_rewards: { reward_id: number; name: string; claims: number }[]; problems: { code: string; text: string; ids: number[] }[];
  totals: { members: number; joined: number; consented: number; bill_scans?: number; active: number; visits: number; spend_paise: string; claims: number; claim_paise: string; owed_paise: string; repeaters: number };
};

export const PERIODS = [{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }, { id: '365', label: 'Last year' }];
export const resultsPath = (days: string): string => `/loyalty/analytics?days=${PERIODS.some((p) => p.id === days) ? days : '30'}`;

/** Owners and admins only; the server enforces it too. */
export const canSeeResults = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

export const money = (paise: string | number): string => rupees(Number(paise) || 0);
/** A share of members, or a dash when there are none (never a made-up 0%). */
export const share = (v: number | null): string => (v === null ? '-' : `${v}%`);
/** How many things the server's health check found wrong, across all kinds. */
export const problemCount = (r: Pick<Results, 'problems'>): number => r.problems.reduce((n, p) => n + p.ids.length, 0);

export const RESULTS_TEXTS = [
  'Card results', 'How your loyalty cards are doing', 'You do not have access to the card results.', 'Last 7 days', 'Last 30 days', 'Last 90 days', 'Last year',
  'Members', '{n} joined in this period', 'Came in', '{n} members earned or used', 'Came back', 'Members with 2+ visits', 'Spend on cards', '{n} visits', 'Rewards claimed', 'Worth {value}',
  'Members are owed', 'Value of balances not yet used', 'Agreed to offers', 'Scanned the bill QR', 'stamped or earned by scanning the bill', 'By card', 'Given {given}, used {used}, claimed {n}', 'Most claimed rewards',
  'Something in the card books needs a look ({n} found). Nothing was changed. Ask support to check.', 'No cards yet. Make one on the web under Loyalty & coupons.'
];
