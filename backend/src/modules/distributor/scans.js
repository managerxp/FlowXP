/*
 * Distributor background checks, run by the worker for every distributor business (at most every 30 minutes each):
 *
 *   scheme expiry       a scheme that ends within three days, so the offer can be extended or the team warned
 *   target shortfall    salespeople behind this month's pace (from the 8th, so the pace means something)
 *   collection chase    retailers past their due date and how much is outstanding, once a day
 *
 * They go through the same internal notifications as the wholesale checks (deduplicated per day, delivered in-app and by
 * email to the people whose permissions allow them to see the thing), so nothing here reaches a person who could not
 * open the screen it points to. A failure in one business or one check is logged and skipped.
 */
import pool from '../../config/database.js';
import { registerScan } from '../jobs.js';
import { claim } from '../scans.js';
import { notify as notifyTeam } from '../notifications.js';
import { today as businessToday, getSettings } from '../wholesale/common.js';
import { inr } from '../wholesale/notify.js';
import { periodBounds, progress, actualFor } from './targets.js';

export const runForBusiness = async (db, businessId) => {
  const settings = await getSettings(db, businessId);
  const date = await businessToday(db, businessId);
  const out = {};

  try {
    const ending = (await db.query(`SELECT scheme_id, name, ends_on::text AS ends_on, (ends_on - $2::date) AS days FROM dist_schemes WHERE business_id = $1 AND is_active AND ends_on >= $2::date AND ends_on <= $2::date + 3`, [businessId, date])).rows;
    out.schemes = 0;
    for (const s of ending) {
      out.schemes += await notifyTeam(businessId, {
        category: 'sales', type: 'distributor_scheme_expiry', severity: 'warning', title: `Scheme “${s.name}” ends ${Number(s.days) === 0 ? 'today' : `in ${s.days} day${Number(s.days) === 1 ? '' : 's'}`}`,
        body: 'Extend it if the offer should carry on; retailers will stop getting it after the end date.', link: '/app/distributor/schemes', dedupeKey: `dist-scheme-${s.scheme_id}-${s.ends_on}`
      }, db);
    }
  } catch (error) { console.error(`[distributor] scheme expiry check failed for ${businessId}:`, error.message); }

  try {
    if (Number(date.slice(8, 10)) >= 8) {
      const [from, to] = periodBounds('MONTHLY', date);
      const targets = (await db.query(
        `SELECT t.*, s.name FROM dist_targets t JOIN wholesale_salespeople s ON s.salesperson_id = t.scope_id WHERE t.business_id = $1 AND t.scope_type = 'SALESPERSON' AND t.period_type = 'MONTHLY' AND t.period_start = $2::date AND t.metric = 'VALUE' AND s.status = 'ACTIVE'`, [businessId, from])).rows;
      const behind = [];
      for (const t of targets) {
        const a = await actualFor(db, { businessId, scopeType: 'SALESPERSON', scopeId: t.scope_id, from, to });
        const p = progress({ target_amount: t.target_amount, period_start: from, period_end: to }, a.revenue, date);
        if (p.status === 'BEHIND') behind.push({ name: t.name, pct: p.achievement_pct });
      }
      if (behind.length) {
        behind.sort((a, b) => a.pct - b.pct);
        out.targets = await notifyTeam(businessId, {
          category: 'sales', type: 'distributor_target_shortfall', severity: 'warning', title: `${behind.length} salesperson${behind.length === 1 ? ' is' : 's are'} behind this month’s target`,
          body: behind.slice(0, 3).map((b) => `${b.name} ${b.pct}%`).join(', '), link: '/app/distributor/targets', dedupeKey: `dist-target-${date}`
        }, db);
      }
    }
  } catch (error) { console.error(`[distributor] target check failed for ${businessId}:`, error.message); }

  try {
    const r = (await db.query(
      `SELECT COUNT(DISTINCT i.customer_id) AS retailers, COALESCE(SUM(i.balance_due_paise), 0) AS amount FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
       WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND m.due_date + $3::int < $2::date`, [businessId, date, settings.overdue_grace_days])).rows[0];
    if (Number(r.retailers) > 0) {
      const worst = (await db.query(
        `SELECT c.name, SUM(i.balance_due_paise) AS owed FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id JOIN customers c ON c.customer_id = i.customer_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 AND m.due_date + $3::int < $2::date GROUP BY c.name ORDER BY owed DESC LIMIT 3`, [businessId, date, settings.overdue_grace_days])).rows;
      out.collections = await notifyTeam(businessId, {
        category: 'sales', type: 'distributor_collection_chase', severity: 'warning', title: `Collect from ${r.retailers} retailer${Number(r.retailers) === 1 ? '' : 's'} today`,
        body: `${inr(Number(r.amount))} is past due. Largest: ${worst.map((w) => `${w.name} ${inr(Number(w.owed))}`).join(', ')}.`, link: '/app/wholesale/money', dedupeKey: `dist-collect-${date}`
      }, db);
    }
  } catch (error) { console.error(`[distributor] collection check failed for ${businessId}:`, error.message); }
  return out;
};

export const SCAN_EVERY_MINUTES = 30;

export const runScan = async () => {
  const { rows } = await pool.query(
    `SELECT b.business_id FROM businesses b LEFT JOIN wholesale_settings s ON s.business_id = b.business_id
     WHERE b.status = 'ACTIVE' AND b.subscription_status IN ('TRIAL','ACTIVE') AND (b.business_type = 'DISTRIBUTOR' OR (b.business_type = 'WHOLESALE' AND COALESCE(s.distributor_enabled, FALSE)))`);
  for (const r of rows) {
    try {
      if (!(await claim(r.business_id, 'distributor', SCAN_EVERY_MINUTES))) continue;
      await runForBusiness(pool, r.business_id);
    } catch (error) { console.error(`[distributor] scan failed for ${r.business_id}:`, error.message); }
  }
};
registerScan(runScan);
