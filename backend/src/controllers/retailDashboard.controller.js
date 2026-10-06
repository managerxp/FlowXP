/*
 * What the retail dashboard adds to the usual day-at-a-glance, beyond the stock figures the stock center already has:
 * what offers took off today's bills, and what was returned today. Scoped to the outlet being viewed, like every report.
 *
 *   GET /api/retail/today  { offers: { lines, saving }, returns: { count, total } }
 */
import pool from '../config/database.js';
import { branchFilter } from '../utils/scope.js';
import { businessToday } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';

export const today = async (req, res) => {
  const { businessId } = req.tenant;
  const day = await businessToday(businessId);
  const offerValues = [businessId, day];
  const offerScope = branchFilter(req.tenant, 'i.branch_id', offerValues);
  const offers = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE ii.promo_discount_paise > 0) AS lines, COALESCE(SUM(ii.promo_discount_paise), 0) AS saving
     FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id
     WHERE i.business_id = $1 AND i.invoice_date = $2::date AND i.status <> 'CANCELLED'${offerScope}`, offerValues)).rows[0];
  const returnValues = [businessId, day];
  const returnScope = branchFilter(req.tenant, 'cn.branch_id', returnValues);
  const returns = (await pool.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(cn.total_paise), 0) AS total FROM credit_notes cn WHERE cn.business_id = $1 AND cn.cn_date = $2::date${returnScope}`, returnValues)).rows[0];
  res.json({ success: true, data: { offers: { lines: Number(offers.lines), saving: toRupees(offers.saving) }, returns: { count: Number(returns.n), total: toRupees(returns.total) } } });
};
