/*
 * Payment reminders for customers who owe money (Messaging > "Remind customers who owe money"). Off until the owner switches it on.
 * A shop's credit sale has no due date, so "due" means: an unpaid bill 7 or more days old. A customer is reminded at most once a week, with
 * the same message as the Remind button (sendBalance: all unpaid bills and the total). Wholesale and distributor businesses have due dates
 * and their own reminders (modules/wholesale), so they are left out. The weekly gap is read from the message log, so a restart or a second
 * process cannot send twice in a row.
 */
import pool from '../../config/database.js';
import { registerScan } from '../jobs.js';
import { sendBalance } from './index.js';

export const OVERDUE_AFTER_DAYS = 7;
export const REMIND_EVERY_DAYS = 7;
const MAX_PER_BUSINESS = 50;     // per run: a big backlog goes out over a few runs, not in one burst
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

export const runDueReminders = async (db = pool) => {
  const shops = (await db.query(
    `SELECT business_id FROM businesses
     WHERE status = 'ACTIVE' AND subscription_status IN ('TRIAL','ACTIVE') AND business_type NOT IN ('WHOLESALE','DISTRIBUTOR')
       AND messaging_settings->>'channel' IN ('WHATSAPP','SMS') AND messaging_settings->>'due_reminders' = 'true'`)).rows;
  let sent = 0;
  for (const { business_id: businessId } of shops) {
    try {
      const { rows } = await db.query(
        `SELECT DISTINCT i.customer_id FROM invoices i JOIN customers c ON c.customer_id = i.customer_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND i.customer_id IS NOT NULL AND c.phone IS NOT NULL
           AND i.invoice_date <= CURRENT_DATE - $2::int
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.business_id = i.business_id AND m.customer_id = i.customer_id AND m.kind = 'BALANCE_DUE'
                           AND m.created_at > CURRENT_TIMESTAMP - make_interval(days => $3::int))
         LIMIT ${MAX_PER_BUSINESS}`, [businessId, OVERDUE_AFTER_DAYS, REMIND_EVERY_DAYS]);
      for (const r of rows) {
        const res = await sendBalance(db, { businessId, customerId: r.customer_id });
        if (res && !res.problem && !res.skipped) sent++;
      }
    } catch (error) { console.error(`[messaging] due reminders failed for ${businessId}:`, error.message); }
  }
  return sent;
};

let last = 0;
registerScan(async () => {
  if (Date.now() - last < RUN_EVERY_MS) return;
  last = Date.now();
  await runDueReminders().catch((error) => console.error('[messaging] due reminders failed:', error.message));
});
