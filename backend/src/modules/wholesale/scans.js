/*
 * Wholesale background checks, run by the worker for every wholesale business (at most every 30 minutes each):
 *
 *   stock alerts       tell the team about low / out-of-stock, expiring and expired batches, once a day
 *   overdue summary    how much customers owe past their due date, once a day
 *   payables due       supplier invoices falling due in the next 3 days, once a day
 *   customer reminders payment-due and overdue reminders through messaging (opt-in per business; each invoice
 *                      is reminded at most once a week)
 *
 * Internal notices go through notifications.notify (deduped per day); customer messages go through messaging's send(),
 * so the channel, keys and opt-outs are the business's own. A failure in one business or one check is logged and
 * skipped; nothing here can touch a request.
 */
import pool from '../../config/database.js';
import { registerScan } from '../jobs.js';
import { claim } from '../scans.js';
import { notify as notifyTeam } from '../notifications.js';
import { toRupees } from '../../utils/money.js';
import { getSettings, today as businessToday } from './common.js';
import { stockAlertCounts } from './alerts.js';
import { deliver, day, inr } from './notify.js';

const REMIND_EVERY_DAYS = 7;
const MAX_REMINDERS = 200;

export const runForBusiness = async (db, businessId) => {
  const settings = await getSettings(db, businessId);
  const date = await businessToday(db, businessId);
  const branchIds = (await db.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND status = 'ACTIVE'`, [businessId])).rows.map((r) => r.branch_id);
  const out = {};

  try {
    const c = await stockAlertCounts(db, { businessId, branchIds, settings });
    const parts = [c.out_of_stock && `${c.out_of_stock} out of stock`, c.low_stock && `${c.low_stock} running low`, c.expiring && `${c.expiring} batches expiring soon`, c.expired && `${c.expired} batches expired`].filter(Boolean);
    if (parts.length) {
      out.stock = await notifyTeam(businessId, {
        category: 'stock', type: 'wholesale_stock', severity: c.out_of_stock || c.expired ? 'critical' : 'warning', title: 'Warehouse stock needs attention', body: parts.join(', '),
        link: '/app/wholesale/inventory', dedupeKey: `ws-stock-${date}`
      }, db);
    }
  } catch (error) { console.error(`[wholesale] stock alert failed for ${businessId}:`, error.message); }

  try {
    const r = (await db.query(
      `SELECT COUNT(DISTINCT i.customer_id) AS customers, COALESCE(SUM(i.balance_due_paise), 0) AS amount FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
       WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND m.due_date + $3::int < $2::date`, [businessId, date, settings.overdue_grace_days])).rows[0];
    if (Number(r.customers) > 0) {
      out.overdue = await notifyTeam(businessId, {
        category: 'sales', type: 'wholesale_overdue', severity: 'warning', title: `${r.customers} customer${Number(r.customers) === 1 ? '' : 's'} overdue`, body: `${inr(Number(r.amount))} is past its due date.`,
        link: '/app/wholesale/receivables', dedupeKey: `ws-overdue-${date}`
      }, db);
    }
    const p = (await db.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(balance_due_paise), 0) AS amount FROM purchase_orders WHERE business_id = $1 AND status IN ('PARTIAL','RECEIVED') AND balance_due_paise > 0 AND due_date IS NOT NULL AND due_date <= $2::date + 3`, [businessId, date])).rows[0];
    if (Number(p.n) > 0) {
      out.payables = await notifyTeam(businessId, {
        category: 'sales', type: 'wholesale_payables', severity: 'informational', title: `${p.n} supplier bill${Number(p.n) === 1 ? '' : 's'} due soon`, body: `${inr(Number(p.amount))} falls due within 3 days.`,
        link: '/app/wholesale/payables', dedupeKey: `ws-payables-${date}`
      }, db);
    }
  } catch (error) { console.error(`[wholesale] dues alert failed for ${businessId}:`, error.message); }

  // customer reminders (messaging decides whether anything is actually sent)
  try {
    if (settings.notifications?.payment_due === true || settings.notifications?.payment_overdue === true) {
      const rows = (await db.query(
        `SELECT i.invoice_id, i.invoice_number, i.customer_id, i.balance_due_paise, m.due_date, ($2::date - m.due_date) AS days_overdue
         FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND i.customer_id IS NOT NULL AND m.due_date <= $2::date + 2
           AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.business_id = i.business_id AND x.related_type = 'invoice' AND x.related_id = i.invoice_id AND x.kind IN ('WS_PAYMENT_DUE','WS_PAYMENT_OVERDUE')
                           AND x.created_at > CURRENT_TIMESTAMP - make_interval(days => $3::int))
         ORDER BY m.due_date LIMIT ${MAX_REMINDERS}`, [businessId, date, REMIND_EVERY_DAYS])).rows;
      let sent = 0;
      for (const r of rows) {
        const late = Number(r.days_overdue) > 0;
        const res = await deliver(db, {
          businessId, event: late ? 'payment_overdue' : 'payment_due', customerId: r.customer_id, invoiceId: r.invoice_id,
          values: { amount: Number(r.balance_due_paise), number: r.invoice_number, due: day(r.due_date), days: String(Math.max(1, Number(r.days_overdue))) }
        });
        if (res && !res.skipped) sent++;
      }
      out.reminders = sent;
    }
  } catch (error) { console.error(`[wholesale] reminders failed for ${businessId}:`, error.message); }
  return out;
};

export const SCAN_EVERY_MINUTES = 30;

export const runScan = async () => {
  const { rows } = await pool.query(`SELECT business_id FROM businesses WHERE business_type IN ('WHOLESALE','DISTRIBUTOR') AND status = 'ACTIVE' AND subscription_status IN ('TRIAL','ACTIVE')`);
  for (const r of rows) {
    try {
      if (!(await claim(r.business_id, 'wholesale', SCAN_EVERY_MINUTES))) continue;
      await runForBusiness(pool, r.business_id);
    } catch (error) { console.error(`[wholesale] scan failed for ${r.business_id}:`, error.message); }
  }
};
registerScan(runScan);
