/*
 * Which price does this customer pay for this product, in this unit, at this quantity, today?
 *
 * Prices are always worked out PER SELLING UNIT of the line (a carton's price for a carton line). The order of
 * precedence — first match wins — is:
 *
 *   1. A price negotiated with THIS customer (wholesale_customer_prices): a product rule beats a category rule; of
 *      the quantity breaks that apply, the one with the highest minimum quantity wins. Fixed price or % off the tier price.
 *   2. Otherwise the better (lower) of
 *        a. the customer's list: the list assigned to them, else the list for their territory (nearest first), else the list for their customer type, else the
 *           business's default list (a rule with a price replaces the tier price; a rule with a % takes it off), and
 *        b. a running promotion (a PROMOTION list valid today), and
 *      starting from the tier price for their customer type when no list rule applies:
 *        distributor → distributor price, retailer → retailer price, anyone else → wholesale price,
 *        falling back to the wholesale price, then the product's selling price, then the MRP.
 *   3. The customer's standing discount % comes off whatever (2) gave — but not off a negotiated price (1).
 *
 * The result says where the price came from, so an order line can show it and a person can see why.
 */
import { loadUnits, unitFor } from './units.js';
import { today as businessToday } from './common.js';

const TIER = { DISTRIBUTOR: 'distributor_price_paise', RETAILER: 'retailer_price_paise' };

const specificity = (r) => (r.product_id != null ? 2 : 1);
const inWindow = (r, on) => (!r.starts_on || String(r.starts_on).slice(0, 10) <= on) && (!r.ends_on || String(r.ends_on).slice(0, 10) >= on);

/**
 * Price many lines in one go (a handful of queries, however long the order).
 * lines: [{ product_id, unit_name?, quantity }]  →  Map(index → { price_paise, per_base_paise, source, factor, unit_name, discount_pct, moq, below_moq })
 */
export const priceLines = async (db, { businessId, customerId = null, lines, on = null }) => {
  const date = on || await businessToday(db, businessId);
  const ids = [...new Set(lines.map((l) => Number(l.product_id)))];
  const products = new Map((await db.query(
    `SELECT p.product_id, p.name, p.category_id, p.selling_price_paise, p.unit, d.subcategory_id, d.mrp_paise, d.distributor_price_paise, d.wholesale_price_paise,
            d.retailer_price_paise, COALESCE(d.moq, 1) AS moq
     FROM products p LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id
     WHERE p.business_id = $1 AND p.product_id = ANY($2::int[])`, [businessId, ids])).rows.map((r) => [r.product_id, r]));
  const units = await loadUnits(db, businessId, ids);
  const customer = customerId ? (await db.query(
    `SELECT c.customer_id, COALESCE(w.customer_type, 'RETAILER') AS type, w.price_list_id, w.territory_id, COALESCE(w.default_discount_pct, 0) AS discount
     FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 AND c.customer_id = $2`, [businessId, customerId])).rows[0] : null;

  const settings = (await db.query(`SELECT default_price_list_id FROM wholesale_settings WHERE business_id = $1`, [businessId])).rows[0];
  // the customer's territory and every one above it: a price list for a region reaches the areas inside it
  const chain = customer?.territory_id ? (await db.query(
    `WITH RECURSIVE up AS (SELECT territory_id, parent_id FROM dist_territories WHERE territory_id = $1 UNION ALL SELECT t.territory_id, t.parent_id FROM dist_territories t JOIN up ON t.territory_id = up.parent_id) SELECT territory_id FROM up`,
    [customer.territory_id])).rows.map((r) => r.territory_id) : [];
  const categoryIds = [...new Set([...products.values()].flatMap((p) => [p.category_id, p.subcategory_id]).filter(Boolean))];

  const special = customer ? (await db.query(
    `SELECT * FROM wholesale_customer_prices WHERE business_id = $1 AND customer_id = $2 AND (product_id = ANY($3::int[]) OR category_id = ANY($4::int[]))`,
    [businessId, customer.customer_id, ids, categoryIds])).rows.filter((r) => inWindow(r, date)) : [];

  // lists that can apply: the customer's own, the one for their type, the default, and any running promotion
  const lists = (await db.query(
    `SELECT list_id, kind, customer_type, territory_id, starts_on, ends_on FROM wholesale_price_lists
     WHERE business_id = $1 AND is_active AND (kind = 'PROMOTION' OR list_id = $2 OR list_id = $3 OR ($4::text IS NOT NULL AND customer_type = $4) OR territory_id = ANY($5::int[]))`,
    [businessId, customer?.price_list_id ?? null, settings?.default_price_list_id ?? null, customer?.type ?? null, chain])).rows.filter((l) => inWindow(l, date));
  const items = lists.length ? (await db.query(
    `SELECT * FROM wholesale_price_list_items WHERE list_id = ANY($1::int[]) AND (product_id = ANY($2::int[]) OR category_id = ANY($3::int[]))`,
    [lists.map((l) => l.list_id), ids, categoryIds])).rows : [];
  const byList = new Map(); for (const it of items) { if (!byList.has(it.list_id)) byList.set(it.list_id, []); byList.get(it.list_id).push(it); }
  const promoIds = lists.filter((l) => l.kind === 'PROMOTION').map((l) => l.list_id);
  // the list the customer is on: assigned, else by type, else default
  const own = lists.find((l) => l.kind === 'STANDARD' && l.list_id === customer?.price_list_id)
    || lists.filter((l) => l.kind === 'STANDARD' && l.territory_id != null && chain.includes(l.territory_id)).sort((a, b) => chain.indexOf(a.territory_id) - chain.indexOf(b.territory_id))[0]   // nearest territory first: area, then territory, then region
    || lists.find((l) => l.kind === 'STANDARD' && l.territory_id == null && customer && l.customer_type === customer.type)
    || lists.find((l) => l.kind === 'STANDARD' && l.list_id === settings?.default_price_list_id) || null;

  const out = new Map();
  lines.forEach((line, index) => {
    const product = products.get(Number(line.product_id));
    if (!product) return;
    const u = unitFor(units, product.product_id, line.unit_name, product.name);
    const qty = Number(line.quantity);
    const unitFactor = (name) => (name ? unitFor(units, product.product_id, name, product.name).factor : 1);

    // price per BASE unit from a rule (rules carry their own unit), or a % off a base price
    const fromRule = (rule, tierPerBase) => (rule.price_paise != null ? Number(rule.price_paise) / unitFactor(rule.unit_name) : tierPerBase * (1 - Number(rule.discount_pct) / 100));

    const tierPerBase = Number(product[TIER[customer?.type]] ?? product.wholesale_price_paise ?? product.selling_price_paise ?? product.mrp_paise ?? 0);

    let perBase = tierPerBase; let source = customer ? `TIER:${customer.type}` : 'TIER:WHOLESALE'; let discount = 0;
    // quantity breaks are written in the rule's own unit; compare like with like
    const negotiatedFit = customer ? bestRuleInUnit(special, product, qty, u, unitFactor) : null;
    if (negotiatedFit) { perBase = fromRule(negotiatedFit, tierPerBase); source = 'CUSTOMER'; }
    else {
      const candidates = [];
      if (own) { const r = bestRuleInUnit(byList.get(own.list_id) || [], product, qty, u, unitFactor); if (r) candidates.push({ per: fromRule(r, tierPerBase), source: 'LIST' }); }
      for (const id of promoIds) { const r = bestRuleInUnit(byList.get(id) || [], product, qty, u, unitFactor); if (r) candidates.push({ per: fromRule(r, tierPerBase), source: 'PROMOTION' }); }
      if (candidates.length) {
        // a list replaces the tier price; a promotion only wins when it is lower
        const list = candidates.find((c) => c.source === 'LIST');
        const promo = candidates.filter((c) => c.source === 'PROMOTION').sort((a, b) => a.per - b.per)[0];
        const chosen = list && promo ? (promo.per < list.per ? promo : list) : (list || promo);
        perBase = chosen.per; source = chosen.source;
      }
      if (customer && Number(customer.discount) > 0) { discount = Number(customer.discount); perBase *= 1 - discount / 100; source += `+DISC`; }
    }
    const baseMoq = Number(product.moq);
    out.set(index, {
      price_paise: Math.round(perBase * u.factor), per_base_paise: perBase, source, unit_name: u.name, factor: u.factor, discount_pct: discount,
      mrp_paise: product.mrp_paise != null ? Number(product.mrp_paise) : null, moq: baseMoq, below_moq: qty * u.factor < baseMoq - 1e-9
    });
  });
  return out;
};

/** bestRule, but a rule's minimum quantity is compared in the line's unit (a break of "10 cartons" is 10 cartons). */
const bestRuleInUnit = (rules, product, qty, unit, unitFactor) => {
  const fit = rules.filter((r) => (r.product_id === product.product_id || (r.product_id == null && r.category_id != null && [product.category_id, product.subcategory_id].includes(r.category_id))));
  const ok = fit.filter((r) => (qty * unit.factor) >= Number(r.min_qty) * (r.unit_name ? unitFactor(r.unit_name) : 1) - 1e-9);
  ok.sort((a, b) => specificity(b) - specificity(a) || Number(b.min_qty) * (b.unit_name ? unitFactor(b.unit_name) : 1) - Number(a.min_qty) * (a.unit_name ? unitFactor(a.unit_name) : 1));
  return ok[0] || null;
};

export const priceOne = async (db, args) => (await priceLines(db, { ...args, lines: [args.line] })).get(0);
