/*
 * Profitability endpoints. The maths lives in modules/profitability.js; this
 * file picks the date range, adds the previous period for comparison, and
 * converts paise to rupees at the edge like every other controller here.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { loadSettings, periodCosts, profitability } from '../modules/profitability.js';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'OTHER'];
const PLATFORMS = ['ZOMATO', 'SWIGGY', 'ONDC', 'MAGICPIN'];

const MONEY = new Set(['net_revenue', 'cogs', 'payment_fees', 'commission', 'packaging', 'contribution', 'discount', 'refunded',
  'revenue', 'food_cost', 'variable_cost', 'contribution_per_unit', 'amount', 'expenses_total', 'wastage', 'estimated_net']);
const moneyDeep = (value) => {
  if (Array.isArray(value)) return value.map(moneyDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, MONEY.has(k) && typeof v === 'number' ? toRupees(v) : moneyDeep(v)]));
  }
  return value;
};

const pct = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);

/* GET /api/profitability?from=&to= */
export const summary = async (req, res) => {
  const to = req.query.to || await businessToday(req.tenant.businessId);
  const from = req.query.from || addDaysISO(to, -29);
  const days = Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  if (!(days >= 1 && days <= 366)) return res.status(400).json({ success: false, message: 'Choose a range of 1 to 366 days' });
  const prevTo = iso(new Date(new Date(from).getTime() - DAY));
  const prevFrom = iso(new Date(new Date(from).getTime() - days * DAY));
  const id = req.tenant.businessId;
  const scope = req.tenant.scopeBranchId ?? null;

  const [current, previous, costs, prevCosts] = await Promise.all([
    profitability(id, from, to, pool, scope), profitability(id, prevFrom, prevTo, pool, scope), periodCosts(id, from, to, pool, scope), periodCosts(id, prevFrom, prevTo, pool, scope)
  ]);
  const net = (t, c) => t.contribution - c.expenses_total - c.wastage;
  const estimatedNet = net(current.totals, costs);
  const prevNet = net(previous.totals, prevCosts);

  res.json({
    success: true,
    data: moneyDeep({
      period: { from, to, days },
      previous_period: { from: prevFrom, to: prevTo },
      totals: { ...current.totals, estimated_net: estimatedNet },
      previous_totals: { ...previous.totals, estimated_net: prevNet },
      change_pct: {
        net_revenue_pct: pct(current.totals.net_revenue, previous.totals.net_revenue),
        contribution_pct: pct(current.totals.contribution, previous.totals.contribution),
        estimated_net_pct: pct(estimatedNet, prevNet),
        food_cost_pct_points: current.totals.food_cost_pct != null && previous.totals.food_cost_pct != null
          ? Math.round((current.totals.food_cost_pct - previous.totals.food_cost_pct) * 10) / 10 : null
      },
      period_costs: costs,
      channels: current.channels,
      trend: current.days,
      items: current.items,
      settings: { ...current.settings, packaging_per_order: toRupees(current.settings.packaging_per_order_paise) },
      is_estimate: true
    })
  });
};

/* GET /api/profitability/settings */
export const getSettings = async (req, res) => {
  const s = await loadSettings(req.tenant.businessId);
  res.json({ success: true, data: { payment_fee_pct: s.payment_fee_pct, platform_commission_pct: s.platform_commission_pct, packaging_per_order: toRupees(s.packaging_per_order_paise) } });
};

const cleanPct = (obj, allowed, label) => {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${label}: ${key}`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${key} must be a percentage between 0 and 100`);
    if (n > 0) out[key] = n;
  }
  return out;
};

/* PUT /api/profitability/settings */
export const putSettings = async (req, res) => {
  const body = req.body || {};
  let fees, commissions, packaging;
  try {
    fees = cleanPct(body.payment_fee_pct, PAYMENT_METHODS, 'payment method');
    commissions = cleanPct(body.platform_commission_pct, PLATFORMS, 'platform');
    packaging = toPaise(body.packaging_per_order ?? 0);
    if (packaging < 0) throw new Error('Packaging cost cannot be negative');
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  await pool.query(
    `INSERT INTO cost_settings (business_id, payment_fee_pct, platform_commission_pct, packaging_per_order_paise, updated_at)
     VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
     ON CONFLICT (business_id) DO UPDATE SET payment_fee_pct = EXCLUDED.payment_fee_pct,
       platform_commission_pct = EXCLUDED.platform_commission_pct, packaging_per_order_paise = EXCLUDED.packaging_per_order_paise, updated_at = CURRENT_TIMESTAMP`,
    [req.tenant.businessId, JSON.stringify(fees), JSON.stringify(commissions), packaging]
  );
  recordAudit(req, { action: 'settings.costs_updated', resource_type: 'cost_settings', resource_id: req.tenant.businessId, metadata: { payment_fee_pct: fees, platform_commission_pct: commissions, packaging_per_order: toRupees(packaging) } });
  res.json({ success: true, data: { payment_fee_pct: fees, platform_commission_pct: commissions, packaging_per_order: toRupees(packaging) } });
};
