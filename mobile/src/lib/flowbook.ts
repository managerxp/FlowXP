/* FlowBook on the phone: the books at a glance (who owes you, what you owe, the year's profit, the latest invoices). Entering invoices and the GST returns stay on the website.
   The app calls FlowBook through the same sign-in as everything else: /api/books/v1/... Money in its answers is rupees as text. */
import { rupees, toPaise } from './money.ts';
import type { Business } from './session.ts';
import { hasFeature } from './access.ts';

export type BooksMe = { organizations: { id: string; name: string }[] };
export type Ageing = { total: string; rows: { days_1_30: string; days_31_60: string; days_61_90: string; days_over_90: string }[] };
export type Pnl = { netProfit: string };
export type Reconcile = { issues: string[] };
export type BookInvoice = { id: string; number: string | null; party_name: string | null; issue_date: string; status: string; total_minor: string };
export type InvoiceList = { documents: BookInvoice[] };

/** The Indian financial year (April to March) that a date falls in. */
export const financialYear = (iso: string): { from: string; to: string; label: string } => {
  const y = Number(iso.slice(0, 4)); const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
};
/** What is past its due date: everything in the 1+ day columns of the receivables ageing. */
export const overdueOf = (a: Ageing | null | undefined): number => (a ? a.rows.reduce((n, r) => n + Number(r.days_1_30) + Number(r.days_31_60) + Number(r.days_61_90) + Number(r.days_over_90), 0) : 0);
export const money = (v: string | number | null | undefined): string => rupees(toPaise(Number(v ?? 0)));
/** Is FlowBook open to this business? (The server still decides; this only hides the menu entry.) */
export const hasBooks = (b: Pick<Business, 'subscription' | 'business_type'> | null | undefined): boolean => hasFeature(b, 'flowbook_app') && (b?.business_type === 'FLOWBOOK' || hasFeature(b, 'flowbook'));
export const todayISO = (now = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export const BOOKS = '/books/v1';
export const checkLine = (r: Reconcile | null): string => (!r ? '' : r.issues.length ? `${r.issues.slice(0, 3).join(' · ')}${r.issues.length > 3 ? ` (+${r.issues.length - 3})` : ''}` : '');

export const FLOWBOOK_TEXTS = [
  'FlowBook', 'Your accounts at a glance', 'Your accounts at a glance. Make invoices and file GST on the website.', 'Customers owe you', 'of which overdue', 'You owe vendors', 'Profit this year', 'Latest invoices',
  'No invoices yet. Create your first one on the website.', 'Draft', 'Your books need a look:', 'Books check: every figure agrees with its documents.', 'FlowBook is not switched on for this business.',
  'Could not load.'
];
