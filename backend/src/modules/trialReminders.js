/*
 * Trial emails to the owner: once when 2 days are left, once when the trial has ended. The stage is claimed in the same
 * statement that finds the business, so two API processes cannot both send it. Mail goes through the job queue, so a mail
 * outage retries instead of failing the scan. A business that already paid (ACTIVE) is never mailed.
 */
import pool from '../config/database.js';
import { enqueue, registerScan } from './jobs.js';

const SOON_DAYS = 2;

/** The reminder stage a trial is due for, given its end and the stage already sent: 1, 2, or 0 for none. */
export const stageFor = (trialEndsAt, sent, now = new Date()) => {
  const left = new Date(trialEndsAt).getTime() - now.getTime();
  if (left <= 0) return sent < 2 ? 2 : 0;
  return left <= SOON_DAYS * 86400000 && sent < 1 ? 1 : 0;
};

const TEXT = {
  1: (n) => ({ subject: 'Your FlowXP free trial ends soon', title: `Your free trial ends in ${n} day${n === 1 ? '' : 's'}.`, body: 'Pick a plan under Settings, Subscription to keep adding sales and entries. Your data stays safe either way.' }),
  2: () => ({ subject: 'Your FlowXP free trial has ended', title: 'Your free trial has ended.', body: 'Everything you created is still here and can be read. Pick a plan under Settings, Subscription to turn billing and entries back on.' })
};

export const runTrialReminders = async (db = pool, now = new Date()) => {
  const { rows } = await db.query(
    `SELECT b.business_id, b.trial_ends_at, b.trial_reminder, u.email, u.name FROM businesses b JOIN users u ON u.user_id = b.owner_user_id
     WHERE b.subscription_status = 'TRIAL' AND b.trial_ends_at IS NOT NULL AND b.trial_ends_at <= $1::timestamptz + interval '${SOON_DAYS} days'`, [now]);
  let sent = 0;
  for (const r of rows) {
    const stage = stageFor(r.trial_ends_at, r.trial_reminder, now);
    if (!stage || !r.email) continue;
    const claimed = await db.query(`UPDATE businesses SET trial_reminder = $2 WHERE business_id = $1 AND trial_reminder < $2 RETURNING business_id`, [r.business_id, stage]);
    if (!claimed.rowCount) continue;
    const days = Math.max(1, Math.ceil((new Date(r.trial_ends_at) - now) / 86400000));
    await enqueue('email', { to: r.email, name: r.name, link: '/app/settings/subscription', ...TEXT[stage](days) }, { db });
    sent++;
  }
  return sent;
};

registerScan(() => runTrialReminders().catch((error) => console.error('[trial] reminders failed:', error.message)));
