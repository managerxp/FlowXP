import { taxOn } from './money.ts';
import type { LineInput, PostInput, Side } from './ledger.ts';

/* Posting rules, version 1 (accounting-rules.md section 3). A rule turns a business document into the journal that
   records it. Rules are pure: no database, no clock. Rates come from the caller (the tax table), never from here. */

export type Tender = 'CASH' | 'BANK' | 'UPI' | 'CARD';
const TENDER_ACCOUNT: Record<Tender, string> = { CASH: 'CASH', BANK: 'BANK', UPI: 'UPI_CLEARING', CARD: 'CARD_CLEARING' };
export type TaxedLine = { taxable: bigint; rateBp: number };
export const RULES_VERSION = 1;

/** Tax on each line, split into CGST + SGST (same state) or IGST (other state). CGST is half, SGST the rest, so they always add up. */
const taxSplit = (lines: TaxedLine[], interState: boolean) => {
  let cgst = 0n; let sgst = 0n; let igst = 0n; let rateBp = 0;
  for (const l of lines) {
    const tax = taxOn(l.taxable, l.rateBp);
    rateBp = Math.max(rateBp, l.rateBp);
    if (interState) igst += tax; else { const half = tax / 2n; cgst += half; sgst += tax - half; }
  }
  return { cgst, sgst, igst, rateBp, total: cgst + sgst + igst };
};

const merge = (lines: LineInput[]): LineInput[] => {
  const out: LineInput[] = [];
  for (const l of lines) {
    if (l.amount === 0n) continue;
    const same = out.find((o) => o.account === l.account && o.side === l.side && o.partyId === l.partyId);
    if (same) same.amount += l.amount; else out.push({ ...l });
  }
  return out;
};

const taxLines = (t: ReturnType<typeof taxSplit>, side: Side, prefix: 'OUTPUT' | 'INPUT'): LineInput[] => [
  { account: `${prefix}_CGST`, side, amount: t.cgst, taxRateBp: t.rateBp },
  { account: `${prefix}_SGST`, side, amount: t.sgst, taxRateBp: t.rateBp },
  { account: `${prefix}_IGST`, side, amount: t.igst, taxRateBp: t.rateBp }
];

export type SaleDoc = { date: string; invoiceId: string; partyId?: bigint; lines: TaxedLine[]; interState: boolean; tenders?: { mode: Tender; amount: bigint }[]; roundOff?: bigint; sourceSystem?: string };

/** Sale: money received goes to its tender account, the unpaid part to receivables, revenue and tax are credited. Examples 1 and 2. */
export const saleJournal = (d: SaleDoc): PostInput => {
  const net = d.lines.reduce((a, l) => a + l.taxable, 0n);
  const tax = taxSplit(d.lines, d.interState);
  const roundOff = d.roundOff ?? 0n;
  const total = net + tax.total + roundOff;
  const paid = (d.tenders ?? []).reduce((a, t) => a + t.amount, 0n);
  if (paid > total) throw new RangeError('payments exceed the invoice total');
  const lines: LineInput[] = [
    ...(d.tenders ?? []).map((t) => ({ account: TENDER_ACCOUNT[t.mode], side: 'D' as Side, amount: t.amount })),
    { account: 'AR', side: 'D', amount: total - paid, partyId: d.partyId },
    { account: 'SALES', side: 'C', amount: net },
    ...taxLines(tax, 'C', 'OUTPUT'),
    { account: 'ROUND_OFF', side: roundOff >= 0n ? 'C' : 'D', amount: roundOff >= 0n ? roundOff : -roundOff }
  ];
  return { date: d.date, sourceType: 'invoice', sourceId: d.invoiceId, kind: 'SALE', sourceSystem: d.sourceSystem, rulesVersion: RULES_VERSION, memo: `Sale ${d.invoiceId}`, lines: merge(lines) };
};

/** Credit note: reverses the sale's revenue and tax into Sales returns and the output tax accounts, and reduces what the customer owes. Example 6. */
export const creditNoteJournal = (d: { date: string; noteId: string; partyId?: bigint; lines: TaxedLine[]; interState: boolean; sourceSystem?: string }): PostInput => {
  const net = d.lines.reduce((a, l) => a + l.taxable, 0n);
  const tax = taxSplit(d.lines, d.interState);
  return { date: d.date, sourceType: 'credit_note', sourceId: d.noteId, kind: 'CREDIT_NOTE', sourceSystem: d.sourceSystem, rulesVersion: RULES_VERSION, memo: `Credit note ${d.noteId}`,
    lines: merge([{ account: 'SALES_RETURNS', side: 'D', amount: net }, ...taxLines(tax, 'D', 'OUTPUT'), { account: 'AR', side: 'C', amount: net + tax.total, partyId: d.partyId }]) };
};

/** Customer pays (or is refunded) against what they owe. Examples 3 and 14. */
export const customerPaymentJournal = (d: { date: string; paymentId: string; partyId?: bigint; mode: Tender; amount: bigint; refund?: boolean }): PostInput => ({
  date: d.date, sourceType: d.refund ? 'refund' : 'payment_in', sourceId: d.paymentId, kind: d.refund ? 'REFUND' : 'PAYMENT_IN', rulesVersion: RULES_VERSION,
  memo: `${d.refund ? 'Refund' : 'Payment'} ${d.paymentId}`,
  lines: d.refund
    ? [{ account: 'AR', side: 'D', amount: d.amount, partyId: d.partyId }, { account: TENDER_ACCOUNT[d.mode], side: 'C', amount: d.amount }]
    : [{ account: TENDER_ACCOUNT[d.mode], side: 'D', amount: d.amount }, { account: 'AR', side: 'C', amount: d.amount, partyId: d.partyId }]
});

/** Supplier bill: the cost (or stock) and the input tax are debited, payables credited. Example 4. */
export const supplierBillJournal = (d: { date: string; billId: string; partyId?: bigint; lines: TaxedLine[]; interState: boolean; stock?: boolean; sourceSystem?: string }): PostInput => {
  const net = d.lines.reduce((a, l) => a + l.taxable, 0n);
  const tax = taxSplit(d.lines, d.interState);
  return { date: d.date, sourceType: 'bill', sourceId: d.billId, kind: 'BILL', sourceSystem: d.sourceSystem, rulesVersion: RULES_VERSION, memo: `Bill ${d.billId}`,
    lines: merge([{ account: d.stock ? 'INVENTORY' : 'PURCHASES', side: 'D', amount: net }, ...taxLines(tax, 'D', 'INPUT'), { account: 'AP', side: 'C', amount: net + tax.total, partyId: d.partyId }]) };
};

/** Supplier payment. Example 5. */
export const supplierPaymentJournal = (d: { date: string; paymentId: string; partyId?: bigint; mode: Tender; amount: bigint }): PostInput => ({
  date: d.date, sourceType: 'payment_out', sourceId: d.paymentId, kind: 'PAYMENT_OUT', rulesVersion: RULES_VERSION, memo: `Payment ${d.paymentId}`,
  lines: [{ account: 'AP', side: 'D', amount: d.amount, partyId: d.partyId }, { account: TENDER_ACCOUNT[d.mode], side: 'C', amount: d.amount }]
});
