/*
 * Delivery platforms on the phone (owner and admin, for food businesses): connect Zomato, Swiggy, ONDC or Magicpin, sync the menu, send a test order,
 * and check the statement each platform pays against (settlement reconciliation). The same as the website's Delivery integrations and Settlements
 * pages. New orders from a platform wait for someone to accept them (the Incoming orders screen) before anything reaches the kitchen. Pure: types,
 * bodies, the statement parser and the wording.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));
export const PLATFORM_LABEL: Record<string, string> = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin' };
export const PLATFORMS = Object.keys(PLATFORM_LABEL);
export const canDelivery = (can: (perm: string) => boolean): boolean => can('settings');

export type Integration = { platform: string; is_enabled: boolean; last_synced_at: string | null };
/** The body of PATCH /integrations/:platform to connect: blank credentials are left out. */
export const connectBody = (apiKey: string, outletId: string): { is_enabled: true; credentials: { api_key?: string; outlet_id?: string } } => ({
  is_enabled: true, credentials: { api_key: apiKey.trim() || undefined, outlet_id: outletId.trim() || undefined }
});
export const disconnectBody = (): { is_enabled: false } => ({ is_enabled: false });
export const syncedText = (iso: string | null): string => (iso ? t('Menu last updated {when}', { when: new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) }) : '');
export const testOrderText = (orderNumber: string): string => t('Test order {number} arrived, awaiting acceptance. Check Orders.', { number: orderNumber });

/* ── settlement statements ───────────────────────────────────────────────── */
export const STATEMENT_EXAMPLE = 'Z1234,2026-09-20,500,100,,,,,400';
export const COLUMNS = ['Order ID', 'Date (YYYY-MM-DD)', 'Gross amount', 'Commission', 'Payment charges', 'Delivery charges', 'Tax', 'Other deductions', 'Net settled'];
export type Row = { external_order_id: string; settlement_date: string | undefined; gross_amount: string | number; commission: string | number; payment_charges: string | number; delivery_charges: string | number; tax: string | number; other_deductions: string | number; net_settled: string | number };
/** One line per settled order, comma separated, in COLUMNS' order, no header row. Blank charges are zero; a missing net is the gross. */
export const parseRows = (text: string): Row[] =>
  text.trim().split('\n').map((line) => line.split(',').map((c) => c.trim())).filter((cells) => cells[0]).map((cells) => ({
    external_order_id: cells[0], settlement_date: cells[1] || undefined, gross_amount: cells[2] || 0, commission: cells[3] || 0,
    payment_charges: cells[4] || 0, delivery_charges: cells[5] || 0, tax: cells[6] || 0, other_deductions: cells[7] || 0, net_settled: cells[8] ?? cells[2] ?? 0
  }));
export const statementProblem = (text: string): string => {
  const rows = parseRows(text);
  if (!rows.length) return 'Paste at least one row first.';
  const bad = rows.findIndex((r) => [r.gross_amount, r.commission, r.payment_charges, r.delivery_charges, r.tax, r.other_deductions, r.net_settled].some((v) => !Number.isFinite(Number(v))) || (r.settlement_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.settlement_date)));
  return bad >= 0 ? t('Line {n} has a number or date that does not look right.', { n: bad + 1 }) : '';
};
export type Line = { line_id: number; order_number: string | null; external_order_id: string; gross_amount: number; net_settled: number; expected_settlement: number; status: 'MATCHED' | 'VALUE_MISMATCH' | 'ARITHMETIC_ERROR' | 'ORDER_NOT_FOUND' };
export type Settlements = { lines: Line[]; summary: { count: number; matched: number; flagged: number; net_settled_total: number } };
export type Missing = { total_owed: number; orders: { order_id: number; order_number: string; external_order_number: string | null; external_order_id: string; total: number }[] };
export const STATUS_LABEL: Record<Line['status'], string> = { MATCHED: 'Matched', VALUE_MISMATCH: 'Value mismatch', ARITHMETIC_ERROR: "Doesn't add up", ORDER_NOT_FOUND: 'No FlowXP order' };
export const lineSub = (l: Line): string => [t('Gross {value}', { value: money(l.gross_amount) }), t('Net settled {value}', { value: money(l.net_settled) }), t('Expected {value}', { value: money(l.expected_settlement) })].join(' · ');
export const summaryText = (s: Settlements['summary']): string => t('{matched} matched, {flagged} flagged, out of {count}: {total} settled in total.', { matched: s.matched, flagged: s.flagged, count: s.count, total: money(s.net_settled_total) });
export const missingText = (m: Missing): string => t('{total} across {n} orders', { total: money(m.total_owed), n: m.orders.length });

export const DELIVERY_TEXTS: string[] = [
  'Delivery integrations', 'Zomato, Swiggy and other delivery platforms: new orders wait for you to accept or reject before anything reaches the kitchen.', 'Connected', 'Not connected', 'Menu last updated {when}', 'API key', 'Partner API key', 'Outlet / store ID', 'Connect', 'Connecting…',
  'Update the menu', 'Updating…', 'Menu updated.', 'Send test order', 'Sending…', 'Disconnect', 'Test order {number} arrived, awaiting acceptance. Check Orders.', 'You do not have access to delivery settings.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back',
  'Settlements', 'Check the statement each delivery platform pays against what was billed here.', 'Import a statement', 'One settled order per line, comma separated, in this order: {columns}. Leave charges blank if the platform does not break them out.', 'Paste the statement lines here', 'Import', 'Importing…',
  'Imported {n} rows', 'Imported 1 row', 'Paste at least one row first.', 'Line {n} has a number or date that does not look right.', 'Never settled', 'Billed orders with no matching statement line at all yet: money that should have been paid.',
  'Nothing unpaid, as far as an imported statement can tell.', '{total} across {n} orders', 'Imported lines', 'Nothing imported for this platform yet.', '{matched} matched, {flagged} flagged, out of {count}: {total} settled in total.',
  'Gross {value}', 'Net settled {value}', 'Expected {value}', 'Matched', 'Value mismatch', "Doesn't add up", 'No FlowXP order',
  'Order ID', 'Date (YYYY-MM-DD)', 'Gross amount', 'Commission', 'Payment charges', 'Delivery charges', 'Tax', 'Other deductions', 'Net settled',
  'Delivery platforms and settlements', 'Connect Zomato, Swiggy and others, and check what they paid'
];
