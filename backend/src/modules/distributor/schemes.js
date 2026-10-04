/*
 * Schemes: which offers apply to this customer and this basket, and what they give.
 *
 *   BUY_X_GET_Y     buy N of a product / brand / category / principal, get M of a product free. "Buy 10 cartons, get 1
 *                   carton free" (repeats every 10 unless the scheme says once), "buy product A, get product B".
 *   QTY_DISCOUNT    buy N or more, get x% off those lines.
 *   VALUE_DISCOUNT  spend ₹V or more (on the matching lines, or the whole order), get ₹D or x% off.
 *
 * A scheme is eligible when it is active, inside its dates, and the customer qualifies: their type is allowed, they
 * are one of the named retailers (if any are named), and their territory — or one above it — is one of the named
 * territories (if any are named). Nothing is applied that is not eligible.
 *
 * When several schemes fit the same lines, only the best one of each kind applies — unless a scheme is marked
 * stackable, or the business set stacking to ALL. "Best" is the one with the larger benefit (priority first).
 *
 * Free goods come back as ordinary order lines at price 0 (is_free, with the scheme), so stock, picking, shipping
 * and cost all go through the existing paths. Quantities are always in base units underneath; a free "carton" is
 * 288 pieces of stock.
 */
import { loadUnits, unitFor } from '../wholesale/units.js';
import { q3 } from '../wholesale/common.js';

const KINDS = ['BUY_X_GET_Y', 'QTY_DISCOUNT', 'VALUE_DISCOUNT'];

/** Schemes a customer qualifies for on a date. */
export const eligibleSchemes = async (db, { businessId, customerId, on }) => {
  const schemes = (await db.query(
    `SELECT * FROM dist_schemes WHERE business_id = $1 AND is_active AND (starts_on IS NULL OR starts_on <= $2::date) AND (ends_on IS NULL OR ends_on >= $2::date) ORDER BY priority DESC, scheme_id`, [businessId, on])).rows;
  if (!schemes.length) return [];
  const ids = schemes.map((s) => s.scheme_id);
  const customer = customerId ? (await db.query(
    `SELECT COALESCE(w.customer_type, 'RETAILER') AS type, w.territory_id FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 AND c.customer_id = $2`, [businessId, customerId])).rows[0] : null;
  const named = new Map(); const places = new Map();
  for (const r of (await db.query(`SELECT scheme_id, customer_id FROM dist_scheme_customers WHERE scheme_id = ANY($1::int[])`, [ids])).rows) { if (!named.has(r.scheme_id)) named.set(r.scheme_id, new Set()); named.get(r.scheme_id).add(r.customer_id); }
  for (const r of (await db.query(`SELECT scheme_id, territory_id FROM dist_scheme_territories WHERE scheme_id = ANY($1::int[])`, [ids])).rows) { if (!places.has(r.scheme_id)) places.set(r.scheme_id, new Set()); places.get(r.scheme_id).add(r.territory_id); }
  // the customer's territory and every one above it
  const chain = new Set();
  if (customer?.territory_id) {
    for (const r of (await db.query(
      `WITH RECURSIVE up AS (SELECT territory_id, parent_id FROM dist_territories WHERE territory_id = $1 UNION ALL SELECT t.territory_id, t.parent_id FROM dist_territories t JOIN up ON t.territory_id = up.parent_id) SELECT territory_id FROM up`, [customer.territory_id])).rows) chain.add(r.territory_id);
  }
  return schemes.filter((s) => {
    if (s.customer_types?.length && (!customer || !s.customer_types.includes(customer.type))) return false;
    if (named.has(s.scheme_id) && !(customerId && named.get(s.scheme_id).has(customerId))) return false;
    if (places.has(s.scheme_id) && ![...places.get(s.scheme_id)].some((t) => chain.has(t))) return false;
    return true;
  });
};

const touches = (s, p) => {
  if (s.buy_product_id) return p.product_id === s.buy_product_id;
  if (s.buy_brand_id) return p.brand_id === s.buy_brand_id;
  if (s.buy_category_id) return p.category_id === s.buy_category_id || p.subcategory_id === s.buy_category_id;
  if (s.buy_principal_id) return p.principal_id === s.buy_principal_id;
  return true;   // no buy scope: the whole basket
};

const combine = (existingPct, schemePct) => Math.round((1 - (1 - Number(existingPct || 0) / 100) * (1 - schemePct / 100)) * 10000) / 100;

/**
 * lines: priced order lines [{ product_id, unit_name, unit_factor, quantity, base_qty, price_paise, discount_pct, ... }].
 * Returns { lines (discounts applied), free (new free lines), order_discount_paise, applications, hints }.
 */
export const evaluateSchemes = async (db, { businessId, customerId, lines, on, stacking = 'BEST' }) => {
  const none = { lines, free: [], order_discount_paise: 0, applications: [], hints: [] };
  if (!lines.length) return none;
  const schemes = await eligibleSchemes(db, { businessId, customerId, on });
  if (!schemes.length) return none;

  const productIds = [...new Set([...lines.map((l) => l.product_id), ...schemes.flatMap((s) => [s.free_product_id, s.buy_product_id]).filter(Boolean)])];
  const products = new Map((await db.query(
    `SELECT p.product_id, p.name, p.unit, p.brand_id, p.category_id, p.hsn_sac, p.track_inventory, p.tax_rate, p.selling_price_paise, p.purchase_price_paise, d.subcategory_id, d.principal_id
     FROM products p LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id WHERE p.business_id = $1 AND p.product_id = ANY($2::int[])`, [businessId, productIds])).rows.map((r) => [r.product_id, r]));
  const units = await loadUnits(db, businessId, productIds);
  const attrs = lines.map((l) => products.get(l.product_id) || { product_id: l.product_id });

  const factorOf = (productId, unitName) => { const p = products.get(productId); return p ? unitFor(units, productId, unitName, p.name).factor : 1; };
  const lineValue = (l) => Math.round(l.quantity * l.price_paise * (1 - Number(l.discount_pct || 0) / 100));

  const candidates = [];
  const hints = [];
  for (const s of schemes) {
    const idx = lines.map((_, i) => i).filter((i) => touches(s, attrs[i]));
    if (!idx.length) continue;
    const matchBase = idx.reduce((t, i) => t + Number(lines[i].base_qty), 0);
    const matchValue = idx.reduce((t, i) => t + lineValue(lines[i]), 0);
    // the threshold is in the scheme's unit when it names one (only product schemes can); otherwise base units
    const thrBase = s.buy_min_qty == null ? null : Number(s.buy_min_qty) * (s.buy_unit_name && s.buy_product_id ? factorOf(s.buy_product_id, s.buy_unit_name) : 1);
    const unitLabel = s.buy_unit_name || products.get(s.buy_product_id)?.unit || 'units';
    const perUnit = s.buy_unit_name && s.buy_product_id ? factorOf(s.buy_product_id, s.buy_unit_name) : 1;

    if (s.kind === 'BUY_X_GET_Y') {
      const mult = s.repeat ? Math.floor(matchBase / thrBase + 1e-9) : (matchBase >= thrBase - 1e-9 ? 1 : 0);
      if (mult < 1) { if (matchBase > 0) hints.push({ scheme_id: s.scheme_id, scheme: s.name, message: `Add ${q3((thrBase - matchBase) / perUnit)} more ${unitLabel} to get the free goods in ${s.name}` }); continue; }
      const freeId = s.free_product_id ?? s.buy_product_id;
      const freeProduct = products.get(freeId);
      if (!freeProduct || !units.has(freeId)) continue;
      const freeUnit = unitFor(units, freeId, s.free_unit_name || (s.free_product_id ? null : s.buy_unit_name), freeProduct.name);
      let freeQty = mult * Number(s.free_qty);
      if (s.max_free_qty != null) freeQty = Math.min(freeQty, Number(s.max_free_qty));
      const freeBase = q3(freeQty * freeUnit.factor);
      candidates.push({ s, kind: s.kind, idx, benefit: freeBase * Number(freeProduct.selling_price_paise || 0), free: { product: freeProduct, unit: freeUnit, quantity: q3(freeQty), base: freeBase } });
    } else if (s.kind === 'QTY_DISCOUNT') {
      if (matchBase < thrBase - 1e-9) { if (matchBase > 0) hints.push({ scheme_id: s.scheme_id, scheme: s.name, message: `Add ${q3((thrBase - matchBase) / perUnit)} more ${unitLabel} to get ${Number(s.discount_pct)}% off (${s.name})` }); continue; }
      candidates.push({ s, kind: s.kind, idx, benefit: Math.round(matchValue * Number(s.discount_pct) / 100), pct: Number(s.discount_pct) });
    } else {
      const amount = s.discount_paise != null ? Number(s.discount_paise) : Math.round(matchValue * Number(s.discount_pct) / 100);
      if (matchValue < Number(s.min_value_paise)) { if (matchValue > 0) hints.push({ scheme_id: s.scheme_id, scheme: s.name, message: `Add ₹${Math.ceil((Number(s.min_value_paise) - matchValue) / 100).toLocaleString('en-IN')} more to get ₹${Math.round(amount / 100).toLocaleString('en-IN')} off (${s.name})` }); continue; }
      candidates.push({ s, kind: s.kind, idx, benefit: amount, amount });
    }
  }

  // best of each kind per line, unless stackable / stacking is ALL
  candidates.sort((a, b) => b.s.priority - a.s.priority || b.benefit - a.benefit || a.s.scheme_id - b.s.scheme_id);
  const used = { BUY_X_GET_Y: new Set(), QTY_DISCOUNT: new Set(), VALUE_DISCOUNT: new Set() };
  const applied = [];
  for (const c of candidates) {
    const open = c.s.stackable || stacking === 'ALL' || !c.idx.some((i) => used[c.kind].has(i));
    if (!open) continue;
    if (!c.s.stackable) c.idx.forEach((i) => used[c.kind].add(i));
    applied.push(c);
  }

  const out = lines.map((l) => ({ ...l }));
  const free = []; const applications = []; let orderDiscount = 0;
  for (const c of applied) {
    if (c.kind === 'BUY_X_GET_Y') {
      const p = c.free.product;
      free.push({
        product_id: p.product_id, name: p.name, base_unit: p.unit, hsn_sac: p.hsn_sac, track_inventory: p.track_inventory, unit_name: c.free.unit.name, unit_factor: c.free.unit.factor,
        quantity: c.free.quantity, base_qty: c.free.base, price_paise: 0, price_source: 'SCHEME', discount_pct: 0, tax_rate: Number(p.tax_rate), notes: `Free with ${c.s.name}`, is_free: true, scheme_id: c.s.scheme_id, mrp_paise: null
      });
      applications.push({ scheme_id: c.s.scheme_id, scheme: c.s.name, kind: c.kind, free_product_id: p.product_id, free_base: c.free.base, discount_paise: 0, cost_paise: Math.round(c.free.base * Number(p.purchase_price_paise || 0)) });
    } else if (c.kind === 'QTY_DISCOUNT') {
      let given = 0;
      for (const i of c.idx) { const before = lineValue(out[i]); out[i].discount_pct = combine(out[i].discount_pct, c.pct); given += before - lineValue(out[i]); }
      applications.push({ scheme_id: c.s.scheme_id, scheme: c.s.name, kind: c.kind, free_product_id: null, free_base: 0, discount_paise: given, cost_paise: given });
    } else {
      orderDiscount += c.amount;
      applications.push({ scheme_id: c.s.scheme_id, scheme: c.s.name, kind: c.kind, free_product_id: null, free_base: 0, discount_paise: c.amount, cost_paise: c.amount });
    }
  }
  const appliedIds = new Set(applied.map((c) => c.s.scheme_id));
  return { lines: out, free, order_discount_paise: orderDiscount, applications, hints: hints.filter((h) => !appliedIds.has(h.scheme_id)) };
};

export { KINDS };
