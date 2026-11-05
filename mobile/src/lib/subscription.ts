/*
 * The subscription (owner): the plan, the trial and the date it runs to. Information only. The phone shows no prices, no payment button and no link
 * or instruction to pay: Google Play requires in-app payments for features to use Play Billing, so paying happens only outside the app.
 * Pure: types, wording and checks.
 */
import { t } from './i18n.ts';

export type Subscription = {
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED'; plan_code: string; plan?: { name: string } | null; trial_ends_at: string | null; trial_days_remaining: number | null;
  next_billing_date: string | null;
};

export const canSubscription = (role: string | undefined): boolean => role === 'OWNER';
export const statusLabel = (s: Subscription['status']): string => t(({ TRIAL: 'Free trial', ACTIVE: 'Active', EXPIRED: 'Trial ended', CANCELLED: 'Cancelled', SUSPENDED: 'Suspended' } as const)[s] ?? s);
export const dateText = (v: string | null | undefined): string => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const SUBSCRIPTION_TEXTS: string[] = [
  'Your plan and trial',
  'Subscription', 'Status', 'Plan', 'Trial ends', 'Days remaining', 'Next billing date', 'Free trial', 'Active', 'Trial ended', 'Cancelled', 'Suspended',
  'Your trial has ended. Everything you created is still here and still readable.', 'Only the owner can see the subscription.', 'Could not load.', 'Back'
];
