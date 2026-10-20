/*
 * Credit notes (to customers, for goods that came back) and debit notes (to suppliers, for goods sent back or a price correction): the lists, the
 * detail of one, and raising a debit note against an order that has arrived. The same as the website's Debit notes page and the notes on an order;
 * the server works out the tax, the stock and what comes off what you owe. A note is final: to correct one, raise another. Pure: types, wording,
 * the form, its checks and the body sent.
 */
import { t } from './i18n.ts';
import { rupees, toPaise, qty } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));

export type CreditNote = {
  cn_id: number; cn_number: string; date: string; invoice_id: number; invoice_number: string; customer_name: string | null; reason: string | null;
  subtotal: number; tax: number; total: number; settled_against_balance: number; refunded: number; credit_left: number;
  invoice_date?: string; items?: { description: string; quantity: number; tax_rate: number; tax: number; total: number; restocked: boolean }[];
};
export type DebitNote = {
  dn_id: number; dn_number: string; dn_date: string; kind: 'RETURN' | 'PRICE'; reason: string; po_id: number; po_number: string; supplier_name: string | null;
  subtotal: number; tax: number; total: number; applied: number; credit: number;
  items?: { description: string; quantity: number; unit_cost: number; tax_rate: number; tax: number; total: number }[];
};
export const day = (v: string): string => String(v).slice(0, 10);

/* ── wording ─────────────────────────────────────────────────────────────── */
export const creditLine = (c: CreditNote): string => [day(c.date), c.customer_name || t('Walk-in'), t('Bill {number}', { number: c.invoice_number }), c.refunded > 0 ? t('{value} paid back', { value: money(c.refunded) }) : '', c.credit_left > 0 ? t('{value} credit left', { value: money(c.credit_left) }) : ''].filter(Boolean).join(' · ');
export const debitKind = (k: DebitNote['kind']): string => (k === 'RETURN' ? t('Goods back') : t('Price'));
export const debitLine = (d: DebitNote): string => [day(d.dn_date), d.supplier_name || '', t('Order {number}', { number: d.po_number }), debitKind(d.kind), d.credit > 0 ? t('Credit from the supplier: {value}', { value: money(d.credit) }) : ''].filter(Boolean).join(' · ');
export const itemLine = (i: { quantity: number; tax_rate: number }): string => `${qty(i.quantity)} × ${i.tax_rate}% ${t('tax')}`;
export const debitEffect = (d: Pick<DebitNote, 'applied' | 'credit'>): string => [t('Taken off what you owed: {value}', { value: money(d.applied) }), d.credit > 0 ? t('Credit from the supplier: {value}', { value: money(d.credit) }) : ''].filter(Boolean).join(' · ');

/* ── raising a debit note ────────────────────────────────────────────────── */
export type DebitOptionLine = { item_id: number; description: string; received: number; returned: number; returnable: number; unit_cost: number; tax_rate: number; tracks_stock: boolean };
export type DebitOptions = { po_number: string; status: string; items: DebitOptionLine[] };
export type DebitKind = 'RETURN' | 'PRICE';
/** What the person types for each line: how many (goods back) or how many and the overcharge per unit (price). */
export type DebitEntry = { qty: string; unit_cost: string };
export type DebitForm = { kind: DebitKind; reason: string; entries: Record<number, DebitEntry> };
export const emptyDebit = (): DebitForm => ({ kind: 'RETURN', reason: '', entries: {} });
/** Only an order that has arrived can have a debit note. */
export const canRaise = (poStatus: string): boolean => poStatus === 'RECEIVED' || poStatus === 'PARTIAL';
export const maxFor = (kind: DebitKind, l: DebitOptionLine): number => (kind === 'RETURN' ? l.returnable : l.received);
const chosen = (f: DebitForm, lines: DebitOptionLine[]): { line: DebitOptionLine; e: DebitEntry }[] => lines.map((line) => ({ line, e: f.entries[line.item_id] ?? { qty: '', unit_cost: '' } })).filter((x) => Number(x.e.qty) > 0);
export const debitProblem = (f: DebitForm, lines: DebitOptionLine[]): string => {
  if (!f.reason.trim()) return 'Say why (the supplier will read it)';
  const picked = chosen(f, lines);
  if (picked.length === 0) return 'Choose at least one line';
  for (const { line, e } of picked) {
    if (Number(e.qty) > maxFor(f.kind, line)) return f.kind === 'RETURN' ? t('Only {n} of {name} can still be returned', { n: qty(line.returnable), name: line.description }) : t('Only {n} of {name} arrived', { n: qty(line.received), name: line.description });
    if (f.kind === 'PRICE') {
      const u = Number(e.unit_cost);
      if (!(u > 0)) return t('Enter the overcharge per unit for {name}', { name: line.description });
      if (u > line.unit_cost) return t('The overcharge cannot be more than the price paid for {name}', { name: line.description });
    }
  }
  return '';
};
export const debitBody = (f: DebitForm, lines: DebitOptionLine[]): { kind: DebitKind; reason: string; items: { item_id: number; quantity: number; unit_cost?: number }[] } => ({
  kind: f.kind, reason: f.reason.trim(),
  items: chosen(f, lines).map(({ line, e }) => ({ item_id: line.item_id, quantity: Number(e.qty), ...(f.kind === 'PRICE' ? { unit_cost: Number(e.unit_cost) } : {}) }))
});
/** A rough total before sending, so the person sees about what will come off. The server works out the exact tax. */
export const debitEstimate = (f: DebitForm, lines: DebitOptionLine[]): number =>
  chosen(f, lines).reduce((sum, { line, e }) => { const unit = f.kind === 'PRICE' ? Number(e.unit_cost) || 0 : line.unit_cost; return sum + Math.round(toPaise(unit) * Number(e.qty) * (1 + line.tax_rate / 100)); }, 0);

export const NOTES_TEXTS: string[] = [
  'Goods that came back, and goods sent back to suppliers', 'Raise a debit note', 'Items',
  'Credit and debit notes', 'Credit notes are for goods customers brought back. Debit notes are for goods sent back to a supplier, or a price correction.', 'Credit notes', 'Debit notes', 'No credit notes yet.', 'No debit notes yet.', 'Walk-in', 'Bill {number}', 'Order {number}',
  '{value} paid back', '{value} credit left', 'Goods back', 'Price', 'Credit from the supplier: {value}', 'Taken off what you owed: {value}', 'tax', 'Raise a debit note',
  'Reason', 'Subtotal', 'Tax', 'Total', 'Not found', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back', 'Cancel',
  'What is this for?', 'Goods sent back', 'A price correction', 'Why? (the supplier will read it)', 'Say why (the supplier will read it)', 'Choose at least one line', 'Arrived {n}, can still go back {left}', 'Arrived {n}', 'How many', 'Overcharge per unit (₹)',
  'About {value} will come off what you owe, tax included.', 'Issue the debit note', 'Only an order that has arrived can have a debit note.',
  'Only {n} of {name} can still be returned', 'Only {n} of {name} arrived', 'Enter the overcharge per unit for {name}', 'The overcharge cannot be more than the price paid for {name}', 'You do not have access to notes.'
];
