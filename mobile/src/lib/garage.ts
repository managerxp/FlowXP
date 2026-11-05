/* The mechanic garage on the phone: its home figures, Money In and Money Out, the vehicle list to pick from, and the garage-only steps of a job card. The server decides every
   figure; these only shape what a screen shows and sends. Same words and same rules as the website. */
import { t } from './i18n.ts';
import { rupees } from './money.ts';

export const isGarage = (type?: string | null): boolean => type === 'MECHANIC';

export type GarageKind = 'BIKE' | 'CAR' | 'BOTH' | null | undefined;
/** The kinds of vehicle this garage repairs, as chips: a bike garage only bikes, a car garage only cars, both gets both. */
export const garageTypes = (kind: GarageKind): { id: string; label: string }[] => {
  const all = [{ id: 'CAR', label: 'Car' }, { id: 'BIKE', label: 'Bike' }];
  return kind === 'BIKE' ? all.filter((x) => x.id === 'BIKE') : kind === 'CAR' ? all.filter((x) => x.id === 'CAR') : all;
};

/* ── the home ────────────────────────────────────────────────────────────── */
export type GarageWork = { job_id: number; job_no: string; status: string; vehicle_reg: string | null; make: string | null; model: string | null; promised_on: string | null; customer_name: string | null };
export type GarageToday = {
  day: string; received_today: number; in_progress: number; ready: number; delivered_today: number; collected_paise: number; cash_collected_paise: number; spent_paise: number; cash_in_hand_paise: number;
  customer_due_paise: number; customers_owing: number; work: GarageWork[];
};
export const workLine = (w: GarageWork): string => [[w.make, w.model].filter(Boolean).join(' '), w.customer_name, w.job_no].filter(Boolean).join(' · ');

/* ── Money In and Money Out ──────────────────────────────────────────────── */
export const OUT_KINDS = ['Tea and food', 'Spare parts bought', 'Tools', 'Rent', 'Electricity', 'Salary', 'Staff advance', 'Transport', 'Other'];
export const IN_KINDS = ['Scrap sale', 'Commission', 'Other'];
export const MONEY_METHODS = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'BANK_TRANSFER', label: 'Bank' }];
export type MoneyKind = 'CUSTOMER' | 'OTHER_IN' | 'EXPENSE';
export type MoneyForm = { kind: MoneyKind; customer_id: number | null; customer_name: string; category: string; amount: string; method: string; note: string };
export const emptyMoney = (dir: 'in' | 'out'): MoneyForm => ({ kind: dir === 'in' ? 'CUSTOMER' : 'EXPENSE', customer_id: null, customer_name: '', category: dir === 'in' ? IN_KINDS[0] : OUT_KINDS[0], amount: '', method: 'CASH', note: '' });
export const moneyProblem = (f: MoneyForm): string => {
  if (f.kind === 'CUSTOMER' && !f.customer_id) return 'Choose a customer';
  return Number.isFinite(Number(f.amount)) && Number(f.amount) > 0 && f.amount.trim() !== '' ? '' : 'Enter an amount above zero';
};
/** Where an entry is saved: a customer payment, other income or an expense, through the records the rest of FlowXP already keeps. */
export const moneyRequest = (f: MoneyForm): { path: string; body: Record<string, unknown> } => {
  const note = f.note.trim() || undefined;
  if (f.kind === 'CUSTOMER') return { path: '/payments', body: { customer_id: f.customer_id, amount: Number(f.amount), method: f.method, ...(note ? { notes: note } : {}) } };
  const body = { category: t(f.category), amount: Number(f.amount), payment_method: f.method, ...(note ? { description: note } : {}) };
  return { path: f.kind === 'OTHER_IN' ? '/other-income' : '/expenses', body };
};
export type MoneyEntry = { kind: 'CUSTOMER' | 'OTHER_IN' | 'EXPENSE' | 'SUPPLIER'; ref_id: string; day: string; method: string; amount_paise: number; who: string; note: string | null };
export type MoneyBook = { from: string; to: string; in: { total_paise: number; entries: MoneyEntry[] }; out: { total_paise: number; entries: MoneyEntry[] }; net_paise: number; cash_net_paise: number };
export const ENTRY_LABEL: Record<string, string> = { CUSTOMER: 'Customer payment', OTHER_IN: 'Other money in', EXPENSE: 'Spent', SUPPLIER: 'Paid to supplier' };
export const entrySub = (e: MoneyEntry): string => [t(ENTRY_LABEL[e.kind] ?? e.kind), e.day, e.method === 'BANK_TRANSFER' ? t('Bank') : e.method, e.note].filter(Boolean).join(' · ');
export const entryAmount = (e: MoneyEntry): string => rupees(e.amount_paise);

const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const PERIODS = [{ id: 'today', label: 'Today' }, { id: 'week', label: 'Last 7 days' }, { id: 'month', label: 'This month' }];
export const rangeFor = (key: string, now: Date = new Date()): { from: string; to: string } => {
  const to = iso(now);
  if (key === 'week') return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to };
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  return { from: to, to };
};

/* ── the vehicle list ────────────────────────────────────────────────────── */
export type MasterBrands = { brands: { brand: string; vehicle_type: string; models: number }[] };
export type MasterModels = { models: { model: string }[] };
/** The vehicle master and the garage's own list, joined, each name once. */
export const mergeNames = (...lists: string[][]): string[] => [...new Map(lists.flat().filter(Boolean).reverse().map((n) => [n.toLowerCase(), n])).values()].reverse();
/** Names that match what is typed, best matches first. A name already typed in full is not suggested again, and nothing is forced: anything can be typed. */
export const suggestNames = (names: string[], typed: string, limit = 8): string[] => {
  const q = typed.trim().toLowerCase();
  if (q && names.some((n) => n.toLowerCase() === q)) return [];
  return names.filter((n) => !q || n.toLowerCase().includes(q)).sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)) || a.localeCompare(b)).slice(0, limit);
};

/* ── the garage steps of a job card ──────────────────────────────────────── */
export const FUEL_LEVELS = [{ id: 'EMPTY', label: '0' }, { id: 'QUARTER', label: '¼' }, { id: 'HALF', label: '½' }, { id: 'THREE_Q', label: '¾' }, { id: 'FULL', label: 'Full' }];

/** Words the garage screens use, so they can be checked against every language. */
export const GARAGE_TEXTS: string[] = [
  'Your garage', 'What is in the garage and what came in today.', 'New job card', 'Add customer', 'Buy spare parts', 'Money In', 'Money Out', 'Vehicles received today', 'Work in progress', 'Ready for delivery',
  'Delivered today', "Today's collection", '{cash} in cash', "Today's expenses", 'Cash in hand', 'Cash taken less cash spent today', 'Customer payments due', 'From {n} customers', "Today's work",
  'No vehicles in the garage right now.', 'Promised for {date}', 'Open job card', 'Money In and Out', 'Every rupee that came in and went out.', 'Today', 'Last 7 days', 'This month', 'Left over', 'Cash left over',
  'Nothing yet.', 'What came in?', 'What went out?', 'Customer payment', 'Other money in', 'Spent', 'Paid to supplier', 'Tea and food', 'Spare parts bought', 'Tools', 'Rent', 'Electricity', 'Salary', 'Staff advance',
  'Transport', 'Other', 'Scrap sale', 'Commission', 'For what?', 'How was it paid?', 'Note (if you like)', 'Choose a customer', 'Amount', 'Save', 'Bank', 'Cash', 'UPI', 'Card', 'Customer', 'Customer name or phone',
  'Enter an amount above zero', 'Checking', 'Start checking', 'Delivered', 'Hand over the vehicle', 'Fuel in the tank', 'Not noted', 'Full', 'Things left in the vehicle', 'Estimate approved',
  'Customer approved the estimate', 'WhatsApp messages come with an extra plan.',
  'With it, customers get a message by themselves when their vehicle is received, when it is ready and before the next service. You can also send them offers.',
  'Until then, the WhatsApp buttons on a job card open WhatsApp with the message ready, and you press send.', 'See the plans'
];
