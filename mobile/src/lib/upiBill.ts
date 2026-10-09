/* A bill to print before the customer has paid by UPI, with a QR code for exactly what they owe. They scan the printed code, their UPI app opens with the shop's UPI ID and the
   amount already filled in, and they only confirm. The code is not shown on the phone's screen: it is on the paper. */
import { qty, rupees } from './money.ts';
import { two, WIDTH } from './receipt.ts';
import { upiLink } from './cart.ts';
import type { Summary } from './billing.ts';

/** The UPI payment link for this amount. Its text is what the printer turns into the QR code. */
export const upiPayLink = (vpa: string, businessName: string, totalPaise: number): string => upiLink(vpa, businessName || 'FlowXP', totalPaise, 'Bill');

/** The bill so far, with what to pay and how. `title` is the table or order it belongs to. */
/** `payNowPaise`: when only part of the bill is being paid now, the QR and the "scan to pay" line are for that, and the rest is shown as owed. */
export const payRequestLines = (a: { businessName: string; title?: string | null; customer?: string | null; summary: Summary; totalPaise: number; payNowPaise?: number | null }): string[] => {
  const now = a.payNowPaise && a.payNowPaise > 0 && a.payNowPaise < a.totalPaise ? a.payNowPaise : a.totalPaise;
  const out: string[] = [a.businessName];
  if (a.title) out.push(a.title);
  if (a.customer) out.push(a.customer);
  out.push('-'.repeat(WIDTH));
  for (const r of a.summary.rows) { out.push(r.name); out.push(two(`  ${qty(r.qty)}`, rupees(r.paise))); }
  out.push('-'.repeat(WIDTH));
  out.push(two('Subtotal', rupees(a.summary.subtotalPaise)));
  if (a.summary.offersPaise > 0) out.push(two('Offer', `-${rupees(a.summary.offersPaise)}`));
  if (a.summary.taxPaise > 0) out.push(two('GST', rupees(a.summary.taxPaise)));
  out.push(two('TOTAL', rupees(a.totalPaise)));
  if (now < a.totalPaise) { out.push(two('TO PAY NOW', rupees(now))); out.push(two('BALANCE LATER', rupees(a.totalPaise - now))); }
  else out.push(two('TO PAY', rupees(a.totalPaise)));
  out.push('-'.repeat(WIDTH));
  out.push(`Scan to pay ${rupees(now)} by UPI`);
  return out;
};
