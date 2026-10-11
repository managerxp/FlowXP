/*
 * Offers the till applies by itself. Pure pricing here, so the server (when it makes a bill) and the till's preview (before
 * it is charged) run exactly the same rules:
 *
 *   PERCENT_OFF   X% off, from a minimum quantity
 *   BUY_X_GET_Y   buy X, get Y free: every (X + Y) units, Y are free
 *   BUNDLE_PRICE  N units of ONE product for one price
 *   MIX_BUNDLE    N units from a SET of products for one price (any 3 of these biscuits for ₹50)
 *
 * An offer is for one product, one whole category, or (a mix bundle) a set of products; it can sit inside a date window, on
 * certain weekdays, and between certain hours of the day, and can be for bills with a customer on them only. When several
 * offers could cut the same product, only the one that saves the most is used (offers never stack). A mix bundle is worked
 * out last, on the units no other offer has already cut, and is made from the CHEAPEST eligible units first, so the shop
 * never gives away more than the bundle says. The saving is spread over the lines it came from to the paisa and taken off as
 * a line discount BEFORE tax, so GST follows the price actually charged.
 */
import pool from '../config/database.js';
import { createCache } from '../utils/cache.js';

export const KINDS = ['PERCENT_OFF', 'BUY_X_GET_Y', 'BUNDLE_PRICE', 'MIX_BUNDLE'];

const round = Math.round;

/** What one offer would save on `qty` units priced `unit` each (paise), or 0 when it does not apply. (Not for a mix bundle.) */
export const saving = (promo, qty, unit) => {
  if (!(qty > 0) || !(unit > 0)) return 0;
  if (promo.kind === 'PERCENT_OFF') return qty + 1e-9 >= Number(promo.min_qty || 1) ? round(qty * unit * Number(promo.percent) / 100) : 0;
  if (promo.kind === 'BUY_X_GET_Y') {
    const set = Number(promo.buy_qty) + Number(promo.get_qty);
    return Math.floor(qty / set + 1e-9) * Number(promo.get_qty) * unit;
  }
  if (promo.kind === 'BUNDLE_PRICE') {
    const sets = Math.floor(qty / Number(promo.bundle_qty) + 1e-9);
    return sets * Math.max(0, round(Number(promo.bundle_qty) * unit) - Number(promo.bundle_price_paise));
  }
  return 0;
};

/** "10:30" or a Postgres TIME ("10:30:00") to minutes after midnight. */
export const minutesOf = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Is the offer running at this moment? `now` = { dow, minutes }; a start time after the end time runs overnight. */
export const runsNow = (promo, now) => {
  if (!now) return true;
  if (promo.days_of_week && now.dow != null && !promo.days_of_week.includes(now.dow)) return false;
  const from = minutesOf(promo.start_time); const to = minutesOf(promo.end_time);
  if (from == null || to == null || now.minutes == null) return true;
  return from <= to ? now.minutes >= from && now.minutes < to : now.minutes >= from || now.minutes < to;
};

/* Offers that fit a business and a day are read once and kept for a minute: the till asks for them on every change to the
   cart, and they change only when the owner edits one (which clears the business's entry). The hours and weekdays are
   checked on every call, so an offer starts and stops on time whatever is cached. */
const cache = createCache({ ttlMs: 60000, max: 500 });
export const dropPromotionCache = (businessId) => cache.drop(`${businessId}:`);

/**
 * The offers that are on right now: active, inside their dates, on today's weekday and at this hour.
 * @param now  { date, dow, minutes } from businessNow(); a bare 'YYYY-MM-DD' string checks the dates only
 */
export const activePromotions = async (db, businessId, now) => {
  const date = typeof now === 'string' ? now : now.date;
  const rows = await cache.wrap(`${businessId}:${date}`, async () => (await (db ?? pool).query(
    `SELECT pr.*, COALESCE((SELECT array_agg(pp.product_id) FROM promotion_products pp WHERE pp.promo_id = pr.promo_id), '{}') AS product_ids
     FROM promotions pr WHERE pr.business_id = $1 AND pr.is_active
       AND (pr.starts_on IS NULL OR pr.starts_on <= $2::date) AND (pr.ends_on IS NULL OR pr.ends_on >= $2::date)`, [businessId, date])).rows);
  return typeof now === 'string' ? rows : rows.filter((p) => runsNow(p, now));
};

/**
 * @param promos   active offers
 * @param lines    [{ index, product_id, category_id, quantity, unitPricePaise, discountPaise }] the bill's product lines
 * @param ctx      { hasCustomer }
 * @returns Map(index -> { discountPaise, promo_id, name }) the extra line discount for each line an offer cut
 */
export const priceLines = (promos, lines, { hasCustomer = false } = {}) => {
  const out = new Map();
  const usable = promos.filter((p) => !(p.members_only && !hasCustomer));
  const byProduct = new Map();
  for (const l of lines) {
    if (!l.product_id) continue;
    if (!byProduct.has(l.product_id)) byProduct.set(l.product_id, []);
    byProduct.get(l.product_id).push(l);
  }
  const lineGross = (l) => Math.max(0, round(Number(l.quantity) * l.unitPricePaise) - Number(l.discountPaise || 0));
  const add = (index, discountPaise, promo) => {
    const prev = out.get(index);
    out.set(index, { discountPaise: (prev?.discountPaise || 0) + discountPaise, promo_id: prev?.promo_id ?? promo.promo_id, name: prev?.name ?? promo.name });
  };

  // 1. the best single-product, category or percentage offer on each product
  for (const [productId, group] of byProduct) {
    const qty = group.reduce((s, l) => s + Number(l.quantity), 0);
    const gross = group.reduce((s, l) => s + lineGross(l), 0);
    const unit = group[0].unitPricePaise;       // a product on the bill at two prices is priced at its first
    let best = null;
    for (const p of usable) {
      if (p.kind === 'MIX_BUNDLE') continue;
      if (p.product_id ? p.product_id !== productId : p.category_id !== group[0].category_id) continue;
      const s = Math.min(saving(p, qty, unit), Math.max(0, gross));
      if (s > 0 && (!best || s > best.s)) best = { p, s };
    }
    if (!best) continue;
    let left = best.s;
    group.forEach((l, i) => {
      const g = lineGross(l);
      const share = i === group.length - 1 ? Math.min(left, g) : Math.min(left, round((best.s * g) / Math.max(1, gross)));
      left -= share;
      if (share > 0) add(l.index, share, best.p);
    });
  }

  // 2. mix bundles, on the units nothing else has cut (cheapest units first)
  for (const p of usable.filter((x) => x.kind === 'MIX_BUNDLE')) {
    const set = new Set((p.product_ids || []).map(Number));
    const n = Number(p.bundle_qty);
    const units = [];
    for (const l of lines) {
      if (!l.product_id || !set.has(l.product_id) || out.has(l.index)) continue;
      const whole = Math.floor(Number(l.quantity) + 1e-9);
      for (let k = 0; k < whole; k++) units.push({ index: l.index, price: l.unitPricePaise });
    }
    units.sort((a, b) => a.price - b.price);
    const bundles = Math.floor(units.length / n);
    const perLine = new Map();
    for (let b = 0; b < bundles; b++) {
      const chosen = units.slice(b * n, b * n + n);
      const sum = chosen.reduce((s, u) => s + u.price, 0);
      const cut = sum - Number(p.bundle_price_paise);
      if (cut <= 0) continue;
      let left = cut;
      chosen.forEach((u, i) => {
        const part = i === chosen.length - 1 ? left : Math.min(left, round((cut * u.price) / sum));
        left -= part;
        perLine.set(u.index, (perLine.get(u.index) || 0) + part);
      });
    }
    for (const [index, d] of perLine) {
      const l = lines.find((x) => x.index === index);
      const capped = Math.min(d, lineGross(l));
      if (capped > 0) add(index, capped, p);
    }
  }
  return out;
};
