/* Estimates / quotations on the phone: the checks before saving and the words shared with the customer. No React here, so it can be tested. */
import { rupees, toPaise } from './money.ts';

export type EstimateLine = { description: string; quantity: number; unit_price: number };
export type Estimate = {
  estimate_id: number; estimate_number: string; customer_name: string | null; items: EstimateLine[]; discount: number; total: number;
  notes: string | null; valid_until: string | null; status: 'OPEN' | 'CONVERTED' | 'CANCELLED'; invoice_id: number | null;
};
export type DraftLine = { description: string; quantity: string; price: string };

export const blankLine = (): DraftLine => ({ description: '', quantity: '1', price: '' });

/** The lines that have anything in them, as the server wants them. */
export const filledLines = (lines: DraftLine[]): DraftLine[] => lines.filter((l) => l.description.trim() || l.price.trim());

export const estimateProblem = (lines: DraftLine[]): string | null => {
  const used = filledLines(lines);
  if (!used.length) return 'Add at least one item';
  for (const l of used) {
    if (!l.description.trim()) return 'Every line needs a name';
    if (!(Number(l.quantity) > 0)) return 'Enter a quantity above zero';
    if (l.price.trim() === '' || !(Number(l.price) >= 0)) return 'Enter a price';
  }
  return null;
};

export const estimateBody = (name: string, discount: string, lines: DraftLine[]) => ({
  ...(name.trim() ? { customer_name: name.trim() } : {}),
  ...(Number(discount) > 0 ? { discount: Number(discount) } : {}),
  items: filledLines(lines).map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unit_price: Number(l.price) }))
});

/** What the draft adds up to, in paise, before the server's own total. */
export const draftTotalPaise = (lines: DraftLine[], discount: string): number =>
  Math.max(0, filledLines(lines).reduce((a, l) => a + Math.round((Number(l.quantity) || 0) * toPaise(l.price || '0')), 0) - toPaise(discount || '0'));

/** The estimate as a WhatsApp / share-sheet message. */
export const estimateText = (e: Estimate, business: string): string => [
  `${business} - Estimate ${e.estimate_number}`,
  ...(e.customer_name ? [`For: ${e.customer_name}`] : []),
  '',
  ...e.items.map((i, n) => `${n + 1}. ${i.description}  ${i.quantity} x ${rupees(toPaise(i.unit_price))} = ${rupees(Math.round(i.quantity * toPaise(i.unit_price)))}`),
  ...(e.discount > 0 ? ['', `Discount: ${rupees(toPaise(e.discount))}`] : []),
  '',
  `Total: ${rupees(toPaise(e.total))}`,
  ...(e.valid_until ? [`Valid until: ${e.valid_until}`] : []),
  ...(e.notes ? [e.notes] : [])
].join('\n');
