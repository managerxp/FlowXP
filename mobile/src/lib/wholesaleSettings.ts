/* Wholesale settings on the phone: credit control, orders and pricing, stock rules, customer messages, the distributor options, and the salespeople. Pure helpers, no screens. */
import { t } from './i18n.ts';

const whole = (s: string): boolean => /^\d+$/.test(s.trim());
const amount = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0;

export const canWholesaleSettings = (can: (p: string) => boolean): boolean => can('settings');

export const CREDIT_CHOICES: { id: string; label: string }[] = [{ id: 'OFF', label: 'Allow it (no checks)' }, { id: 'WARN', label: 'Warn, but allow' }, { id: 'BLOCK', label: 'Block until a manager overrides' }];
export const STACKING_CHOICES: { id: string; label: string }[] = [{ id: 'BEST', label: 'Give the best one only' }, { id: 'ALL', label: 'Give all of them' }];
/** Customer messages: [key, label, hint, on unless switched off]. The two reminders are off until switched on. */
export const NOTIFY: [string, string, string, boolean][] = [
  ['order_confirmed', 'Order confirmed', 'Tell the customer when you confirm their order', true],
  ['order_dispatched', 'Order dispatched', 'Tell the customer when their goods leave, with the invoice and vehicle', true],
  ['invoice_issued', 'Invoice issued', 'Send the invoice link with its due date', true],
  ['payment_received', 'Payment received', 'Thank the customer and give the receipt number', true],
  ['payment_due', 'Payment due reminder', 'A reminder shortly before an invoice falls due (off unless you switch it on)', false],
  ['payment_overdue', 'Overdue reminder', 'A weekly reminder while an invoice is overdue (off unless you switch it on)', false]
];

export type WSettings = {
  credit_policy: string; block_when_overdue: boolean; overdue_grace_days: number; default_payment_terms_days: number; default_price_list_id: number | null; reserve_on_confirm: boolean; fefo: boolean; expiry_alert_days: number[];
  order_approval_over: number | null; slow_moving_days: number; dead_stock_days: number; order_prefix: string; invoice_footer: string | null; notifications: Record<string, boolean>;
  distributor_enabled: boolean; scheme_stacking: string; visit_location: boolean; field_collections: boolean; credit_manager_override: boolean;
};
export type WForm = {
  credit_policy: string; block_when_overdue: boolean; overdue_grace_days: string; default_payment_terms_days: string; default_price_list_id: string; reserve_on_confirm: boolean; fefo: boolean; expiry_alert_days: string;
  order_approval_over: string; slow_moving_days: string; dead_stock_days: string; order_prefix: string; invoice_footer: string; notifications: Record<string, boolean>;
  scheme_stacking: string; visit_location: boolean; field_collections: boolean; credit_manager_override: boolean;
};
export const wform = (s: WSettings): WForm => ({
  credit_policy: s.credit_policy, block_when_overdue: s.block_when_overdue, overdue_grace_days: String(s.overdue_grace_days), default_payment_terms_days: String(s.default_payment_terms_days), default_price_list_id: s.default_price_list_id ? String(s.default_price_list_id) : '',
  reserve_on_confirm: s.reserve_on_confirm, fefo: s.fefo, expiry_alert_days: (s.expiry_alert_days ?? []).join(', '), order_approval_over: s.order_approval_over == null ? '' : String(s.order_approval_over),
  slow_moving_days: String(s.slow_moving_days), dead_stock_days: String(s.dead_stock_days), order_prefix: s.order_prefix, invoice_footer: s.invoice_footer ?? '',
  notifications: Object.fromEntries(NOTIFY.map(([k, , , on]) => [k, on ? s.notifications?.[k] !== false : s.notifications?.[k] === true])),
  scheme_stacking: s.scheme_stacking || 'BEST', visit_location: s.visit_location, field_collections: s.field_collections, credit_manager_override: s.credit_manager_override
});
export const expiryDays = (s: string): number[] => s.split(/[,\s]+/).filter(Boolean).map(Number);
export const wproblem = (f: WForm): string => {
  if (!whole(f.overdue_grace_days) || Number(f.overdue_grace_days) > 365) return 'The grace period is 0 to 365 days';
  if (!whole(f.default_payment_terms_days) || Number(f.default_payment_terms_days) > 365) return 'Payment terms are 0 to 365 days';
  if (f.order_approval_over.trim() && (!amount(f.order_approval_over) || Number(f.order_approval_over) < 1)) return 'The approval limit is an amount in rupees';
  if (!/^[A-Za-z0-9]{1,8}$/.test(f.order_prefix.trim())) return 'The order prefix is 1 to 8 letters or digits';
  const days = expiryDays(f.expiry_alert_days);
  if (days.length > 6 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 730)) return 'Expiry alerts are up to 6 whole numbers of days, from 1 to 730';
  if (!whole(f.slow_moving_days) || Number(f.slow_moving_days) < 7 || Number(f.slow_moving_days) > 730) return 'Slow-moving is 7 to 730 days';
  if (!whole(f.dead_stock_days) || Number(f.dead_stock_days) < 30 || Number(f.dead_stock_days) > 1460) return 'Dead stock is 30 to 1460 days';
  return '';
};
export const wbody = (f: WForm) => ({
  credit_policy: f.credit_policy, block_when_overdue: f.block_when_overdue, overdue_grace_days: Number(f.overdue_grace_days), default_payment_terms_days: Number(f.default_payment_terms_days), default_price_list_id: f.default_price_list_id ? Number(f.default_price_list_id) : null,
  reserve_on_confirm: f.reserve_on_confirm, fefo: f.fefo, expiry_alert_days: expiryDays(f.expiry_alert_days), order_approval_over: f.order_approval_over.trim() === '' ? null : Number(f.order_approval_over),
  slow_moving_days: Number(f.slow_moving_days), dead_stock_days: Number(f.dead_stock_days), order_prefix: f.order_prefix.trim().toUpperCase(), invoice_footer: f.invoice_footer.trim() || null, notifications: f.notifications,
  scheme_stacking: f.scheme_stacking, visit_location: f.visit_location, field_collections: f.field_collections, credit_manager_override: f.credit_manager_override
});

/* ── salespeople ─────────────────────────────────────────────────────────── */
export type Salesperson = { salesperson_id: number; name: string; phone: string | null; email: string | null; territory: string | null; commission_pct: number; commission_on: string; status: string; user_id: number | null; customers: number };
export type SpForm = { name: string; phone: string; email: string; territory: string; commission_pct: string; commission_on: string; status: string };
export const emptySp = (): SpForm => ({ name: '', phone: '', email: '', territory: '', commission_pct: '', commission_on: 'SALES', status: 'ACTIVE' });
export const spForm = (p: Salesperson): SpForm => ({ name: p.name, phone: p.phone ?? '', email: p.email ?? '', territory: p.territory ?? '', commission_pct: String(p.commission_pct ?? ''), commission_on: p.commission_on || 'SALES', status: p.status });
export const spProblem = (f: SpForm): string =>
  f.name.trim().length < 2 ? 'Give the person a name' : f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? 'That email does not look right' : f.commission_pct.trim() && (!amount(f.commission_pct) || Number(f.commission_pct) > 100) ? 'The commission is a percentage from 0 to 100' : '';
export const spBody = (f: SpForm, editing: boolean) => ({
  name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, territory: f.territory.trim() || null, commission_pct: Number(f.commission_pct) || 0, commission_on: f.commission_on, ...(editing ? { status: f.status } : {})
});
export const spSub = (p: Salesperson): string => [
  p.territory || '', t('{n} customers', { n: p.customers }), p.commission_on === 'COLLECTIONS' ? t('{pct}% of collections', { pct: p.commission_pct }) : t('{pct}% of sales', { pct: p.commission_pct }), p.status === 'INACTIVE' ? t('Inactive') : ''
].filter(Boolean).join(' · ');

export const WHOLESALE_SETTINGS_TEXTS: string[] = [
  'Wholesale settings', 'Credit rules, stock rules, approvals, messages and your salespeople', 'You do not have access to wholesale settings.', 'Rules and messages', 'Salespeople',
  'Allow it (no checks)', 'Warn, but allow', 'Block until a manager overrides', 'Give the best one only', 'Give all of them',
  'Order confirmed', 'Tell the customer when you confirm their order', 'Order dispatched', 'Tell the customer when their goods leave, with the invoice and vehicle', 'Invoice issued', 'Send the invoice link with its due date',
  'Payment received', 'Thank the customer and give the receipt number', 'Payment due reminder', 'A reminder shortly before an invoice falls due (off unless you switch it on)', 'Overdue reminder', 'A weekly reminder while an invoice is overdue (off unless you switch it on)',
  'The grace period is 0 to 365 days', 'Payment terms are 0 to 365 days', 'The approval limit is an amount in rupees', 'The order prefix is 1 to 8 letters or digits', 'Expiry alerts are up to 6 whole numbers of days, from 1 to 730',
  'Slow-moving is 7 to 730 days', 'Dead stock is 30 to 1460 days', 'Give the person a name', 'That email does not look right', 'The commission is a percentage from 0 to 100',
  '{n} customers', '{pct}% of collections', '{pct}% of sales', 'Inactive',
  'Credit control', "What happens when a customer's order would take them past their credit limit", 'When over the limit', 'A customer can have their own rule on their profile', 'Grace period for overdue (days)',
  'Invoices count as overdue this many days after their due date', 'Hold orders from customers with overdue invoices', 'Even if they are inside their credit limit', 'Orders and pricing', 'Default payment terms (days)', 'Default price list',
  'For customers with no list of their own', 'None', 'Orders over this need manager approval', 'Blank for no limit', 'Order number prefix', 'Letters and digits, up to 8', 'Invoice footer note', 'Stock rules',
  'Reserve stock when an order is confirmed', 'Reserved stock cannot be sold to someone else', 'Pick the soonest expiry first', 'Otherwise the oldest received batch goes first', 'Expiry alerts, days before', 'Up to six numbers, like 30, 60, 90',
  'Slow-moving after (days)', 'Dead stock after (days)', 'Customer messages', 'Sent through the channel you set up under Messaging. If messaging is off, nothing is sent.',
  'Distributor tools', 'On for this business. FlowXP support sets this; ask them if you need it changed.', 'When several schemes fit an order', 'Field reps may collect payments', 'Off: only the office records receipts',
  'A manager may override a credit block', 'Off: a blocked order stays blocked until the customer pays', 'Keep the location of a visit', 'Only the place a rep records a visit is stored, and only when they choose to share it', 'Save settings',
  'Add a salesperson', 'Add the people who sell for you to assign customers and track commission.', 'Active', 'Name', 'Phone', 'Email', 'Territory', 'Commission (%)', 'Commission on', 'Sales invoiced', 'Payments collected', 'Save', 'Cancel',
  'Linking a sign-in account is done on the web.'
];
