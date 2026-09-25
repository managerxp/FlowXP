/*
 * What the assistant can look at. Every tool is READ-ONLY and reuses an engine
 * the app already has (profitability, forecast, leakage, kitchen), so the
 * assistant can never see or say something the person asking couldn't open on
 * their own screens:
 *   - a tool is offered to the model, and run, only if the asker's role holds
 *     its permission (checked twice: when listing tools and again when running one)
 *   - group-wide tools are refused for someone pinned to one outlet
 *   - outlet-aware tools follow the outlet being viewed
 *   - results are aggregates in rupees; no customer names or phone numbers
 *     leave the server (staff names appear only in leakage findings, as they do
 *     on the Leakage screen)
 */
import pool from '../../config/database.js';
import { hasPermission } from '../../middleware/auth.js';
import { addDaysISO, businessToday } from '../../utils/dates.js';
import { periodCosts, profitability } from '../profitability.js';
import { addDays, buildInventoryForecast, loadDaily, predictDay } from '../forecast.js';
import { performance as kitchenPerformance } from '../kitchen.js';
import { currentFindings } from '../leakage.js';

const rupees = (paise) => Math.round(Number(paise) || 0) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ToolError extends Error {}

/** A validated range; defaults to the last `days` days ending today. */
const rangeOf = async (tenant, args, days = 7) => {
  const today = await businessToday(tenant.businessId);
  const to = args.to ?? today;
  const from = args.from ?? addDaysISO(to, -(days - 1));
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new ToolError('Dates must look like 2026-09-25');
  if (from > to) throw new ToolError('The start date is after the end date');
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (span > 366) throw new ToolError('Ask for at most a year at a time');
  return { from, to, days: span, today };
};

const scope = (tenant) => tenant.scopeBranchId ?? null;
const pct = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);

const totalsView = (t) => ({
  orders: t.invoices, net_revenue: rupees(t.net_revenue), average_order: t.invoices ? rupees(t.net_revenue / t.invoices) : null,
  food_cost_pct: t.food_cost_pct, contribution: rupees(t.contribution), contribution_margin_pct: t.contribution_margin_pct,
  discounts: rupees(t.discount), refunds: rupees(t.refunded)
});

const dateArgs = {
  from: { type: 'string', description: 'First day, YYYY-MM-DD (business local time)' },
  to: { type: 'string', description: 'Last day, YYYY-MM-DD. Defaults to today.' }
};
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: 'sales_summary', label: 'Sales', permission: 'reports',
    description: 'Sales for a period: orders, net revenue (after discounts and refunds, before tax), average order, food cost %, contribution, discounts, refunds, operating expenses and wastage, by sales channel, compared with the equal period just before. Use for "how were sales", "how did we do last week".',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => {
      const { from, to, days } = await rangeOf(tenant, args, 7);
      const id = tenant.businessId; const branch = scope(tenant);
      const prevTo = addDaysISO(from, -1); const prevFrom = addDaysISO(from, -days);
      const [cur, prev, costs] = await Promise.all([profitability(id, from, to, pool, branch), profitability(id, prevFrom, prevTo, pool, branch), periodCosts(id, from, to, pool, branch)]);
      return {
        period: { from, to, days }, previous_period: { from: prevFrom, to: prevTo },
        ...totalsView(cur.totals),
        operating_expenses: rupees(costs.expenses_total), wastage: rupees(costs.wastage),
        estimated_net_after_expenses: rupees(cur.totals.contribution - costs.expenses_total - costs.wastage),
        change_vs_previous: { net_revenue_pct: pct(cur.totals.net_revenue, prev.totals.net_revenue), orders_pct: pct(cur.totals.invoices, prev.totals.invoices), contribution_pct: pct(cur.totals.contribution, prev.totals.contribution) },
        previous: totalsView(prev.totals),
        by_channel: cur.channels.map((c) => ({ channel: c.channel, orders: c.invoices, net_revenue: rupees(c.net_revenue), food_cost_pct: c.food_cost_pct })),
        note: 'Estimates from recorded sales and the cost assumptions in Profitability; not accounting-grade profit.'
      };
    }
  },
  {
    name: 'daily_trend', label: 'Daily trend', permission: 'reports',
    description: 'Net revenue and orders for each day in a period (up to 31 days). Use for "which day was best", weekday patterns, spotting a dip.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => {
      const { from, to, days } = await rangeOf(tenant, args, 14);
      if (days > 31) throw new ToolError('Daily detail is for up to 31 days; use sales_summary for longer periods');
      const p = await profitability(tenant.businessId, from, to, pool, scope(tenant));
      return { period: { from, to }, days: p.days.map((d) => ({ date: d.day, weekday: new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), orders: d.invoices, net_revenue: rupees(d.net_revenue), contribution: rupees(d.contribution) })) };
    }
  },
  {
    name: 'menu_performance', label: 'Menu performance', permission: 'reports',
    description: 'Dishes ranked for a period by quantity sold, revenue or contribution (what is left after food cost and fees), with margins. Use for best sellers, worst margins, what to promote or reprice.',
    input_schema: schema({ ...dateArgs, sort_by: { type: 'string', enum: ['quantity', 'revenue', 'contribution', 'margin'], description: 'Default contribution' }, order: { type: 'string', enum: ['best', 'worst'], description: 'Default best' }, limit: { type: 'integer', minimum: 1, maximum: 15 } }),
    run: async (tenant, args) => {
      const { from, to } = await rangeOf(tenant, args, 30);
      const p = await profitability(tenant.businessId, from, to, pool, scope(tenant));
      const key = { quantity: 'quantity', revenue: 'revenue', contribution: 'contribution', margin: 'contribution_margin_pct' }[args.sort_by || 'contribution'] ?? 'contribution';
      const dir = args.order === 'worst' ? 1 : -1;
      const items = p.items.filter((i) => i[key] != null && (key !== 'contribution_margin_pct' || i.revenue > 0))
        .sort((a, b) => dir * (a[key] - b[key])).slice(0, Math.min(15, Number(args.limit) || 8));
      return { period: { from, to }, sorted_by: args.sort_by || 'contribution', order: args.order || 'best', items: items.map((i) => ({ name: i.name, quantity: i.quantity, revenue: rupees(i.revenue), food_cost_pct: i.food_cost_pct, contribution: rupees(i.contribution), contribution_margin_pct: i.contribution_margin_pct })) };
    }
  },
  {
    name: 'stock_status', label: 'Stock forecast', permission: 'inventory',
    description: 'Items that will run short or need ordering soon, with stock now, expected use, days of cover, suggested order quantity and cost, grouped by supplier. Predictions are estimates from recent usage. Use for "what should I order", "are we running out of anything".',
    input_schema: schema({}),
    run: async (tenant) => {
      const f = await buildInventoryForecast(tenant.businessId, pool, scope(tenant));
      const flagged = f.items.filter((i) => i.status !== 'OK').slice(0, 15);
      return {
        as_of: f.as_of, summary: f.summary, is_prediction: true,
        items: flagged.map((i) => ({ name: i.name, unit: i.unit, status: i.status, stock_now: i.current_stock, needed_tomorrow: i.tomorrow_need, days_of_cover: i.days_of_cover, suggested_order: i.recommended_qty, estimated_cost: i.estimated_cost, supplier: i.supplier_name })),
        by_supplier: f.by_supplier.map((s) => ({ supplier: s.supplier_name, total: s.total, items: s.items.map((i) => `${i.quantity} ${i.unit} ${i.name}`) }))
      };
    }
  },
  {
    name: 'demand_forecast', label: 'Demand forecast', permission: 'reports',
    description: 'Expected orders and revenue for each of the next 7 days, with a low-high range and confidence. Predictions from the same weekday over recent weeks; say they are estimates.',
    input_schema: schema({}),
    run: async (tenant) => {
      const asOf = await businessToday(tenant.businessId);
      const daily = await loadDaily(tenant.businessId, asOf, pool, scope(tenant));
      const days = [];
      for (let i = 1; i <= 7; i++) {
        const date = addDays(asOf, i);
        const orders = predictDay(daily.orders, date); const revenue = predictDay(daily.revenue, date);
        days.push(orders ? {
          date, weekday: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
          orders: { expected: Math.round(orders.predicted), low: Math.round(orders.low), high: Math.round(orders.high) },
          revenue: revenue ? { expected: rupees(revenue.predicted), low: rupees(revenue.low), high: rupees(revenue.high) } : null, confidence: orders.confidence
        } : { date, insufficient_history: true });
      }
      return { is_prediction: true, days };
    }
  },
  {
    name: 'kitchen_performance', label: 'Kitchen timing', permission: 'reports',
    description: 'How long dishes take from sent to ready: average, slowest 1-in-10, on-time %, by station and the dishes getting slower compared with the equal period before.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => {
      const { from, to, days } = await rangeOf(tenant, args, 14);
      if (days < 3) throw new ToolError('Ask for at least 3 days');
      const p = await kitchenPerformance(tenant.businessId, from, to, addDaysISO(from, -days), addDaysISO(from, -1), pool, scope(tenant));
      return {
        period: { from, to }, overall: p.overall, previous_period: p.previous,
        stations: p.stations.map((s) => ({ name: s.name, items: s.lines, avg_minutes: s.avg_minutes, p90_minutes: s.p90_minutes, on_time_pct: s.on_time_pct })),
        slowing_dishes: p.items.filter((i) => i.change_minutes != null && i.change_minutes >= 2).slice(0, 5).map((i) => ({ name: i.name, avg_minutes: i.avg_minutes, was: i.previous_avg_minutes, expected_minutes: i.expected_minutes }))
      };
    }
  },
  {
    name: 'wastage_summary', label: 'Wastage', permission: 'inventory',
    description: 'Stock thrown away in a period: total cost, by reason and the top items.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => {
      const { from, to } = await rangeOf(tenant, args, 30);
      const id = tenant.businessId; const branch = scope(tenant);
      const b = branch != null ? ' AND t.branch_id = $4' : '';
      const params = branch != null ? [id, from, to, branch] : [id, from, to];
      const [byReason, byItem] = await Promise.all([
        pool.query(`SELECT t.reason_code, SUM(-t.quantity * p.purchase_price_paise) AS cost FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
                    WHERE t.business_id = $1 AND t.transaction_type = 'WASTAGE' AND t.created_at >= $2::date AND t.created_at < ($3::date + 1)${b} GROUP BY 1 ORDER BY 2 DESC`, params),
        pool.query(`SELECT p.name, p.unit, SUM(-t.quantity) AS qty, SUM(-t.quantity * p.purchase_price_paise) AS cost FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
                    WHERE t.business_id = $1 AND t.transaction_type = 'WASTAGE' AND t.created_at >= $2::date AND t.created_at < ($3::date + 1)${b} GROUP BY 1,2 ORDER BY 4 DESC LIMIT 8`, params)
      ]);
      return {
        period: { from, to }, wastage_total: rupees(byReason.rows.reduce((sum, r) => sum + Number(r.cost), 0)),
        by_reason: byReason.rows.map((r) => ({ reason: r.reason_code, cost: rupees(r.cost) })),
        top_items: byItem.rows.map((r) => ({ name: r.name, quantity: Number(r.qty), unit: r.unit, cost: rupees(r.cost) }))
      };
    }
  },
  {
    name: 'expenses_summary', label: 'Expenses', permission: 'expenses',
    description: 'Operating expenses (rent, salaries, utilities...) by category for a period.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => {
      const { from, to } = await rangeOf(tenant, args, 30);
      const costs = await periodCosts(tenant.businessId, from, to, pool, scope(tenant));
      return { period: { from, to }, total: rupees(costs.expenses_total), by_category: costs.expenses.map((e) => ({ category: e.category, amount: rupees(e.amount) })) };
    }
  },
  {
    name: 'leakage_findings', label: 'Leakage check', permission: 'settings', groupOnly: true,
    description: 'Unusual activity found in the last 30 days: discount outliers, cancellations after payment, refunds, wastage rises, manual stock cuts. Neutral wording; findings are things worth a look, not accusations.',
    input_schema: schema({}),
    run: async (tenant) => {
      const today = await businessToday(tenant.businessId);
      const { findings } = await currentFindings(tenant.businessId, addDaysISO(today, -29), today);
      return { period_days: 30, findings: findings.filter((f) => f.status === 'OPEN').slice(0, 8).map((f) => ({ severity: f.severity, title: f.title, summary: f.summary, potential_amount: rupees(f.potential_paise), confidence: f.confidence, suggested_next_step: f.recommendation })) };
    }
  },
  {
    name: 'outlet_comparison', label: 'Outlet comparison', permission: 'reports', groupOnly: true,
    description: 'Each outlet side by side for a period: orders, net revenue, average order, food cost %, contribution, discount %. Only useful when the business has more than one outlet.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => {
      const { from, to } = await rangeOf(tenant, args, 30);
      const outlets = (await pool.query(`SELECT branch_id, name FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`, [tenant.businessId])).rows;
      const rows = [];
      for (const o of outlets) {
        const t = (await profitability(tenant.businessId, from, to, pool, o.branch_id)).totals;
        rows.push({ outlet: o.name, ...totalsView(t), discount_pct: t.net_revenue + t.discount > 0 ? Math.round((t.discount / (t.net_revenue + t.discount)) * 1000) / 10 : null });
      }
      return { period: { from, to }, outlets: rows };
    }
  },
  {
    name: 'loyalty_and_coupons', label: 'Loyalty & coupons', permission: 'settings', groupOnly: true,
    description: 'How the visit-card loyalty program and coupons are doing over the last 30 days: members, visits, rewards given, and each coupon\'s uses and discount. Counts only; no customer details.',
    input_schema: schema({}),
    run: async (tenant) => {
      const id = tenant.businessId;
      const [program, members, visits, rewards, coupons] = await Promise.all([
        pool.query(`SELECT lp.is_enabled, lp.visits_required, p.name AS reward FROM loyalty_programs lp LEFT JOIN products p ON p.product_id = lp.reward_product_id WHERE lp.business_id = $1`, [id]),
        pool.query(`SELECT COUNT(DISTINCT customer_id)::int AS n FROM loyalty_events WHERE business_id = $1 AND voided_at IS NULL`, [id]),
        pool.query(`SELECT COUNT(*)::int AS n FROM loyalty_events WHERE business_id = $1 AND kind = 'VISIT' AND voided_at IS NULL AND created_at > now() - interval '30 days'`, [id]),
        pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_paise),0) AS value FROM loyalty_events WHERE business_id = $1 AND kind = 'REDEEM' AND voided_at IS NULL AND created_at > now() - interval '30 days'`, [id]),
        pool.query(`SELECT c.code, c.is_active, COUNT(r.redemption_id) FILTER (WHERE r.voided_at IS NULL AND r.created_at > now() - interval '30 days')::int AS uses,
                           COALESCE(SUM(r.amount_paise) FILTER (WHERE r.voided_at IS NULL AND r.created_at > now() - interval '30 days'), 0) AS given
                    FROM coupons c LEFT JOIN coupon_redemptions r ON r.coupon_id = c.coupon_id WHERE c.business_id = $1 GROUP BY c.coupon_id ORDER BY 3 DESC LIMIT 10`, [id])
      ]);
      const p = program.rows[0];
      return {
        loyalty: p ? { enabled: p.is_enabled, free_on_visit_number: p.visits_required, reward_item: p.reward } : { enabled: false },
        members: members.rows[0].n, visits_30_days: visits.rows[0].n, rewards_given_30_days: rewards.rows[0].n, rewards_value_30_days: rupees(rewards.rows[0].value),
        coupons: coupons.rows.map((c) => ({ code: c.code, active: c.is_active, uses_30_days: c.uses, discount_given_30_days: rupees(c.given) }))
      };
    }
  }
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Whether this person may use a tool at all. */
export const allowed = (tenant, tool) => hasPermission(tenant, tool.permission) && !(tool.groupOnly && tenant.pinned);

/** Tool definitions for the model, limited to what this person may see. */
export const toolsFor = (tenant) => TOOLS.filter((t) => allowed(tenant, t)).map(({ name, description, input_schema }) => ({ name, description, input_schema }));

export const labelOf = (name) => byName.get(name)?.label ?? name;

/** Run a tool the model asked for. Errors come back as text for the model to explain, never as a crash. */
export const runTool = async (tenant, name, args) => {
  const tool = byName.get(name);
  if (!tool) throw new ToolError(`There is no tool called ${name}`);
  if (!allowed(tenant, tool)) throw new ToolError('This person does not have access to that information');
  return tool.run(tenant, args && typeof args === 'object' ? args : {});
};
