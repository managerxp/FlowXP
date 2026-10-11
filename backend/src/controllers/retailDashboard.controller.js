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
import { createCache } from '../utils/cache.js';
import { stockCenter } from '../modules/retailStock.js';

/* The dashboard asks for these on every visit and refresh, and each is a scan over the day's lines or the whole catalogue, so they
   are kept for 30 seconds per business and outlet. A few seconds' lag on a dashboard figure is fine; the stock center itself is never cached. */
const cache = createCache({ ttlMs: 30000, max: 500 });
const keyOf = (req, what) => `${req.tenant.businessId}:${what}:${req.tenant.scopeBranchId ?? 'all'}`;

/** Forget the kept figures (tests, and anything that must show a change at once). */
export const dropDashboardCache = (businessId) => cache.drop(businessId == null ? '' : `${businessId}:`);

/* GET /api/retail/summary  the stock figures: value, out, low, expiring, expired */
export const summary = async (req, res) => {
  const data = await cache.wrap(keyOf(req, 'summary'), async () => {
    const { summary: s } = await stockCenter(pool, { tenant: req.tenant, limit: 1 });
    return { products: Number(s.products), units: Number(s.units), cost_value: toRupees(s.cost_value), retail_value: toRupees(s.retail_value), out: Number(s.out), low: Number(s.low), expiring: Number(s.expiring), expired: Number(s.expired) };
  });
  res.json({ success: true, data });
};

export const today = async (req, res) => {
  res.json({ success: true, data: await cache.wrap(keyOf(req, 'today'), () => todayFigures(req)) });
};

const todayFigures = async (req) => {
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
  return { offers: { lines: Number(offers.lines), saving: toRupees(offers.saving) }, returns: { count: Number(returns.n), total: toRupees(returns.total) } };
};
