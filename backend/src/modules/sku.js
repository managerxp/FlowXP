/*
 * FlowXP SKUs: a short, readable code the system makes, never something a shop owner has to invent.
 *
 *   MILK-00001   prefix from the product's category (else the first word of its name), then a counter
 *
 * The counter lives in sku_counters, one row per business and prefix, and only ever goes up. Each number is taken with a
 * single atomic upsert (the row lock makes two cashiers creating products at the same instant take different numbers),
 * and archived products keep their SKU, so a code that was once on a product is never given to another. A SKU someone
 * typed by hand can occupy a number we would have used; those are skipped.
 */
const PREFIX_LENGTH = 4;
const MAX_TRIES = 25;

const letters = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** MILK from "Milk & Dairy", else the first usable word of the product name, else ITEM. */
export const skuPrefix = ({ categoryName, name } = {}) => {
  const fromCategory = letters(String(categoryName ?? '').trim().split(/\s+/)[0]);
  if (fromCategory.length >= 2) return fromCategory.slice(0, PREFIX_LENGTH);
  const words = String(name ?? '').trim().split(/\s+/).map(letters);
  // a word of real letters ("Rice") beats a quantity or unit ("1", "Kg"); a short word is better than nothing
  const pick = words.find((w) => /[A-Z]{3,}/.test(w)) || words.find((w) => w.length >= 2);
  return pick ? pick.slice(0, PREFIX_LENGTH) : 'ITEM';
};

export const formatSku = (prefix, n) => `${prefix}-${String(n).padStart(5, '0')}`;

/** The next free SKU for this business. `db` is a pool or a client; call it inside the product's transaction when there is one. */
export const generateSku = async (db, { businessId, categoryName, name }) => {
  const prefix = skuPrefix({ categoryName, name });
  for (let i = 0; i < MAX_TRIES; i++) {
    const { rows } = await db.query(
      `INSERT INTO sku_counters (business_id, prefix, next_number) VALUES ($1, $2, 2)
       ON CONFLICT (business_id, prefix) DO UPDATE SET next_number = sku_counters.next_number + 1
       RETURNING next_number - 1 AS n`,
      [businessId, prefix]
    );
    const sku = formatSku(prefix, rows[0].n);
    const taken = await db.query(`SELECT 1 FROM products WHERE business_id = $1 AND sku IS NOT NULL AND sku <> '' AND lower(sku) = lower($2)`, [businessId, sku]);
    if (!taken.rows.length) return sku;
  }
  throw new Error('Could not find a free SKU');
};
