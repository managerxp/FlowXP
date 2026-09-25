/*
 * Trial and subscription state.
 *
 * The brief asks that the backend "automatically determine whether the trial
 * is active". There are two ways to do that: a scheduled job that sweeps every
 * business every night, or a derivation on read.
 *
 * This does it on read. A cron job means a business whose trial ended at 02:00
 * still has access until the sweep runs, and it means one more moving part to
 * deploy, monitor and page someone about. Deriving from trial_ends_at is
 * correct the instant the clock passes it, needs nothing scheduled, and cannot
 * drift. The row is then written back once, so reports and the admin view see
 * EXPIRED too — but the write is an optimisation, not the source of truth.
 */
import pool from '../config/database.js';
import config from '../config/env.js';

/** Whole days remaining, floored at 0. Used for "5 days left in your trial". */
export const trialDaysRemaining = (trialEndsAt, now = new Date()) => {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - now.getTime();
  if (ms <= 0) return 0;
  /* Ceil, not floor: with 18 hours left a user has "1 day", not "0 days".
     Telling someone they have 0 days left while the product still works is
     the kind of small wrongness that generates support tickets. */
  return Math.ceil(ms / 86400000);
};

/**
 * The status this business actually has right now, regardless of what the
 * stored column says.
 *
 * Only TRIAL expires here. An ACTIVE paid subscription that lapses is decided
 * by the payment provider's webhook, not by a timestamp — a card that fails
 * at 03:00 may well succeed on retry at 04:00, and locking the owner out in
 * between would be wrong.
 */
export const effectiveStatus = (business, now = new Date()) => {
  if (business.subscription_status !== 'TRIAL') return business.subscription_status;
  if (!business.trial_ends_at) return 'TRIAL';
  return new Date(business.trial_ends_at).getTime() <= now.getTime() ? 'EXPIRED' : 'TRIAL';
};

/** Everything the UI needs to render trial banners and gate features. */
export const subscriptionSummary = (business, now = new Date()) => {
  const status = effectiveStatus(business, now);
  return {
    status,
    plan_code: business.plan_code,
    billing_cycle: business.billing_cycle || null,
    trial_ends_at: business.trial_ends_at || null,
    trial_days_remaining: status === 'TRIAL' ? trialDaysRemaining(business.trial_ends_at, now) : 0,
    next_billing_date: business.next_billing_date || null,
    /* The single flag the frontend gates on. Read-only access after expiry is
       deliberate: the brief says never delete data, and an owner locked out of
       their own sales history will not come back to pay. */
    can_write: status === 'TRIAL' || status === 'ACTIVE'
  };
};

/**
 * Persist an expiry that has already happened.
 *
 * Fire-and-forget by design — a failed write here must never fail the request
 * that noticed it, because effectiveStatus() has already returned the correct
 * answer and the next read will try again.
 */
export const persistExpiryIfNeeded = (business, status) => {
  if (status !== 'EXPIRED' || business.subscription_status === 'EXPIRED') return;
  pool.query(
    `UPDATE businesses SET subscription_status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND subscription_status = 'TRIAL'`,
    [business.business_id]
  ).catch((error) => console.error('[subscription] expiry write failed:', error.message));
};

/** Trial window for a business created now. */
export const newTrialWindow = (now = new Date()) => {
  const ends = new Date(now.getTime() + config.trialDays * 86400000);
  return { trial_started_at: now, trial_ends_at: ends };
};
