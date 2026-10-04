/*
 * Sales commission, worked out from the sales facts and the commission rules.
 *
 * A rule says "this much, on this basis, for this scope": a % of sales value or of gross margin, or an amount per
 * unit, for everything / one brand / category / product / territory / customer, for every salesperson or one, with
 * dates and optionally a minimum target achievement. Each sold line earns under ONE rule — the most specific that
 * fits (product > brand > category > customer > territory > everything; a rule for this salesperson beats a general
 * one; then priority) — so a sale is never commissioned twice. A salesperson's own default percentage (set on their
 * profile) is the fallback for lines no rule covers.
 *
 * Commission on collections (a salesperson whose pay is on cash received, not sales invoiced) is worked out from the
 * receipts against their invoices.
 */
import { FACTS } from './facts.js';
import { actualFor, periodBounds } from './targets.js';
import { territoryScope } from './common.js';

const SPECIFICITY = { PRODUCT: 6, BRAND: 5, CATEGORY: 4, CUSTOMER: 3, TERRITORY: 2, ALL: 1 };

const matches = (rule, row, territoryUnder) => {
  switch (rule.scope_type) {
    case 'ALL': return true;
    case 'PRODUCT': return row.product_id === rule.scope_id;
    case 'BRAND': return row.brand_id === rule.scope_id;
    case 'CATEGORY': return row.category_id === rule.scope_id || row.subcategory_id === rule.scope_id;
    case 'CUSTOMER': return row.customer_id === rule.scope_id;
    case 'TERRITORY': return row.territory_id != null && (territoryUnder.get(rule.scope_id) || new Set()).has(row.territory_id);
    default: return false;
  }
};

const rank = (rule) => (rule.salesperson_id ? 1000 : 0) + SPECIFICITY[rule.scope_type] * 10;

/** The rep's overall achievement across their own targets that fall inside the window (null when they have none). */
const repAchievement = async (db, businessId, salespersonId, from, to) => {
  const targets = (await db.query(
    `SELECT * FROM dist_targets WHERE business_id = $1 AND scope_type = 'SALESPERSON' AND scope_id = $2 AND period_start <= $4::date AND period_end >= $3::date`, [businessId, salespersonId, from, to])).rows;
  if (!targets.length) return null;
  let goal = 0; let got = 0;
  for (const t of targets) {
    const a = await actualFor(db, { businessId, scopeType: 'SALESPERSON', scopeId: salespersonId, metric: t.metric, from: String(t.period_start).slice(0, 10), to: String(t.period_end).slice(0, 10) });
    goal += Number(t.target_amount); got += a.actual;
  }
  return goal > 0 ? (got / goal) * 100 : null;
};

/**
 * Commission for the period, per salesperson. Returns [{ salesperson_id, name, sales, units, margin, collections, lines: [{ rule, base, amount }], commission }]
 * (money in paise).
 */
export const computeCommission = async (db, { businessId, from, to, salespersonId = null }) => {
  const reps = (await db.query(
    `SELECT salesperson_id, name, commission_pct, commission_on FROM wholesale_salespeople WHERE business_id = $1 ${salespersonId ? 'AND salesperson_id = $2' : ''} ORDER BY lower(name)`,
    salespersonId ? [businessId, salespersonId] : [businessId])).rows;
  if (!reps.length) return [];
  const rules = (await db.query(
    `SELECT * FROM dist_commission_rules WHERE business_id = $1 AND is_active AND (starts_on IS NULL OR starts_on <= $3::date) AND (ends_on IS NULL OR ends_on >= $2::date)`, [businessId, from, to])).rows;
  const territoryUnder = new Map();
  for (const r of rules.filter((x) => x.scope_type === 'TERRITORY')) territoryUnder.set(r.scope_id, new Set(await territoryScope(db, businessId, r.scope_id)));

  const facts = (await db.query(
    `SELECT f.salesperson_id, f.product_id, f.brand_id, f.category_id, f.subcategory_id, f.customer_id, f.territory_id,
            SUM(f.revenue) AS revenue, SUM(f.cost) AS cost, SUM(f.units) FILTER (WHERE f.paid) AS units
     FROM ${FACTS} WHERE f.business_id = $1 AND f.invoice_date >= $2::date AND f.invoice_date <= $3::date AND f.salesperson_id = ANY($4::int[])
     GROUP BY f.salesperson_id, f.product_id, f.brand_id, f.category_id, f.subcategory_id, f.customer_id, f.territory_id`, [businessId, from, to, reps.map((r) => r.salesperson_id)])).rows;
  const collected = new Map((await db.query(
    `SELECT m.salesperson_id, SUM(p.amount_paise) AS collected FROM payments p JOIN wholesale_invoice_meta m ON m.invoice_id = p.invoice_id
     WHERE p.business_id = $1 AND p.payment_date >= $2::date AND p.payment_date <= $3::date AND m.salesperson_id = ANY($4::int[]) GROUP BY m.salesperson_id`, [businessId, from, to, reps.map((r) => r.salesperson_id)])).rows.map((r) => [r.salesperson_id, Number(r.collected)]));

  const out = [];
  for (const rep of reps) {
    const mine = facts.filter((f) => f.salesperson_id === rep.salesperson_id);
    const achievement = rules.some((r) => r.min_achievement_pct != null && (!r.salesperson_id || r.salesperson_id === rep.salesperson_id)) ? await repAchievement(db, businessId, rep.salesperson_id, from, to) : null;
    const usable = rules.filter((r) => (!r.salesperson_id || r.salesperson_id === rep.salesperson_id) && (r.min_achievement_pct == null || (achievement != null && achievement >= Number(r.min_achievement_pct))));
    const byRule = new Map(); let fallbackBase = 0;
    let sales = 0; let units = 0; let margin = 0;
    for (const row of mine) {
      const revenue = Number(row.revenue); const cost = Number(row.cost); const qty = Number(row.units || 0);
      sales += revenue; units += qty; margin += revenue - cost;
      const rule = usable.filter((r) => matches(r, row, territoryUnder)).sort((a, b) => rank(b) - rank(a) || b.priority - a.priority || b.rule_id - a.rule_id)[0];
      if (!rule) { fallbackBase += revenue; continue; }
      const base = rule.basis === 'QTY' ? qty : rule.basis === 'MARGIN' ? revenue - cost : revenue;
      const amount = rule.basis === 'QTY' ? Math.round(qty * Number(rule.per_unit_paise)) : Math.round(Math.max(0, base) * Number(rule.rate_pct) / 100);
      const acc = byRule.get(rule.rule_id) || { rule: rule.name, rule_id: rule.rule_id, basis: rule.basis, base: 0, amount: 0 };
      acc.base += base; acc.amount += amount; byRule.set(rule.rule_id, acc);
    }
    const lines = [...byRule.values()];
    const cash = collected.get(rep.salesperson_id) || 0;
    if (rep.commission_on === 'COLLECTIONS' && Number(rep.commission_pct) > 0) {
      lines.push({ rule: `Default ${rep.commission_pct}% on collections`, rule_id: null, basis: 'COLLECTIONS', base: cash, amount: Math.round(cash * Number(rep.commission_pct) / 100) });
    } else if (fallbackBase > 0 && Number(rep.commission_pct) > 0) {
      lines.push({ rule: `Default ${rep.commission_pct}% on sales`, rule_id: null, basis: 'VALUE', base: fallbackBase, amount: Math.round(Math.max(0, fallbackBase) * Number(rep.commission_pct) / 100) });
    }
    out.push({ salesperson_id: rep.salesperson_id, name: rep.name, sales, units, margin, collections: cash, achievement_pct: achievement == null ? null : Math.round(achievement * 10) / 10, lines, commission: lines.reduce((s, l) => s + l.amount, 0) });
  }
  return out;
};

export { periodBounds };
