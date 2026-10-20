/*
 * The subscription (owner): the plan, the trial, the next billing date and any payment link sent for this account. The same as the website's
 * Subscription page. There is no self-serve upgrade: the FlowXP team agrees a price and sends a secure payment link, which shows here to pay.
 * Pure: types, wording and checks.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

export type Subscription = {
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED'; plan_code: string; plan?: { name: string } | null; trial_ends_at: string | null; trial_days_remaining: number | null;
  billing_cycle: string | null; next_billing_date: string | null; pending_payment?: { amount: number; billing_cycle: string; payment_link_url: string } | null;
};
export type Plan = { plan_code: string; name: string; description: string; price_monthly_paise: number | string };

export const canSubscription = (role: string | undefined): boolean => role === 'OWNER';
export const statusLabel = (s: Subscription['status']): string => t(({ TRIAL: 'Free trial', ACTIVE: 'Active', EXPIRED: 'Trial ended', CANCELLED: 'Cancelled', SUSPENDED: 'Suspended' } as const)[s] ?? s);
export const dateText = (v: string | null | undefined): string => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const planPrice = (p: Plan): string => (Number(p.price_monthly_paise) ? t('{price}/month', { price: rupees(Number(p.price_monthly_paise)) }) : t('Pricing on request'));
export const cycleText = (c: string | null | undefined): string => (c ? c.toLowerCase() : '');
export const payText = (p: { amount: number; billing_cycle: string }): string => t('{amount} / {cycle}', { amount: rupees(toPaise(p.amount)), cycle: cycleText(p.billing_cycle) });
/** Only a secure https payment link from the server is opened. */
export const safeLink = (url: string | null | undefined): string | null => (url && /^https:\/\//i.test(url) ? url : null);

export const SUBSCRIPTION_TEXTS: string[] = [
  'Your plan, trial and payment link',
  'Subscription', 'Status', 'Plan', 'Trial ends', 'Days remaining', 'Billing cycle', 'Next billing date', 'Free trial', 'Active', 'Trial ended', 'Cancelled', 'Suspended',
  'Your trial has ended. Everything you created is still here and still readable. Paying turns billing back on.', '{amount} / {cycle}', 'A payment link was sent for your account. Pay on Cashfree\'s secure page. We never see your card or UPI details.', 'Pay {amount} now',
  'Plans', '{price}/month', 'Pricing on request', 'Pricing is agreed with our team, not self-serve. Contact flowxp.manager@gmail.com and we will send a secure payment link for your plan.', 'Only the owner can see the subscription.', 'Could not load.', 'Back', 'Could not open the payment page.'
];
