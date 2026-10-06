/*
 * Offers the till applies by itself (retail). Pure pricing here, so the server (when it makes a bill) and the till's
 * preview (before it is charged) run exactly the same rules:
 *
 *   PERCENT_OFF   X% off, from a minimum quantity, optionally only when the bill has a customer on it
 *   BUY_X_GET_Y   buy X, get Y free: every (X + Y) units, Y are free
 *   BUNDLE_PRICE  N units for one price: every N units cost the bundle price instead of N × the shelf price
 *
 * An offer is for one product or one whole category and sits inside an optional date window. When several offers could
 * cut the same product, only the one that saves the most is used (offers never stack on top of each other). The saving
 * is spread over that product's lines on the bill in proportion to what each line costs, to the paisa, and is taken off
 * as a line discount BEFORE tax, so GST follows the price actually charged.
 */
export const KINDS = ['PERCENT_OFF', 'BUY_X_GET_Y', 'BUNDLE_PRICE'];

const round = Math.round;

/** What one offer would save on `qty` units priced `unit` each (paise), or 0 when it does not apply. */
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

/** The offers that are on today: active, inside their dates. `today` is the business's own calendar day (YYYY-MM-DD). */
export const activePromotions = async (db, businessId, today) => (await db.query(
  `SELECT * FROM promotions WHERE business_id = $1 AND is_active
     AND (starts_on IS NULL OR starts_on <= $2::date) AND (ends_on IS NULL OR ends_on >= $2::date)`, [businessId, today])).rows;

/**
 * @param promos   active offers
 * @param lines    [{ index, product_id, category_id, quantity, unitPricePaise, discountPaise }] the bill's product lines
 * @param ctx      { hasCustomer }
 * @returns Map(index -> { discountPaise, promo_id, name }) the extra line discount for each line an offer cut
 */
export const priceLines = (promos, lines, { hasCustomer = false } = {}) => {
  const out = new Map();
  const byProduct = new Map();
  for (const l of lines) {
    if (!l.product_id) continue;
    if (!byProduct.has(l.product_id)) byProduct.set(l.product_id, []);
    byProduct.get(l.product_id).push(l);
  }
  for (const [productId, group] of byProduct) {
    const qty = group.reduce((s, l) => s + Number(l.quantity), 0);
    const gross = group.reduce((s, l) => s + round(Number(l.quantity) * l.unitPricePaise) - Number(l.discountPaise || 0), 0);
    // offers price the unit the line is sold at; a product on the bill at two prices uses its first price
    const unit = group[0].unitPricePaise;
    let best = null;
    for (const p of promos) {
      if (p.members_only && !hasCustomer) continue;
      if (p.product_id ? p.product_id !== productId : p.category_id !== group[0].category_id) continue;
      const s = Math.min(saving(p, qty, unit), Math.max(0, gross));
      if (s > 0 && (!best || s > best.s)) best = { p, s };
    }
    if (!best) continue;
    // spread the saving over the lines by what each costs; the last one takes the remainder
    let left = best.s;
    group.forEach((l, i) => {
      const lineGross = Math.max(0, round(Number(l.quantity) * l.unitPricePaise) - Number(l.discountPaise || 0));
      const share = i === group.length - 1 ? Math.min(left, lineGross) : Math.min(left, round((best.s * lineGross) / Math.max(1, gross)));
      left -= share;
      if (share > 0) out.set(l.index, { discountPaise: share, promo_id: best.p.promo_id, name: best.p.name });
    });
  }
  return out;
};
