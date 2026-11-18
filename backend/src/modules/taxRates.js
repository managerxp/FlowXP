/*
 * Named GST rates (migration 0139): the business's own list, made from a default the first time it is read.
 * A product picks one; products.tax_rate keeps the number in step, so every tax calculation stays as it was.
 */
export const KINDS = ['TAXABLE', 'NIL', 'EXEMPT', 'NON_GST'];

/* [name, rate, kind]: the slabs a shop meets, plus the three kinds of 0% supply the returns report apart */
export const DEFAULT_RATES = [
  ['GST 0%', 0, 'TAXABLE'], ['GST 3%', 3, 'TAXABLE'], ['GST 5%', 5, 'TAXABLE'], ['GST 12%', 12, 'TAXABLE'], ['GST 18%', 18, 'TAXABLE'],
  ['GST 28%', 28, 'TAXABLE'], ['GST 40%', 40, 'TAXABLE'], ['Nil rated', 0, 'NIL'], ['Exempt', 0, 'EXEMPT'], ['Non-GST', 0, 'NON_GST']
];

export const asRate = (r) => ({ tax_rate_id: r.tax_rate_id, name: r.name, rate: Number(r.rate), kind: r.kind, is_active: r.is_active, sort_order: r.sort_order });

/** The business's list, made from the defaults the first time. */
export const listRates = async (db, businessId) => {
  let { rows } = await db.query(`SELECT * FROM tax_rates WHERE business_id = $1 ORDER BY sort_order, tax_rate_id`, [businessId]);
  if (!rows.length) {
    for (const [i, [name, rate, kind]] of DEFAULT_RATES.entries()) {
      await db.query(`INSERT INTO tax_rates (business_id, name, rate, kind, sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [businessId, name, rate, kind, i + 1]);
    }
    ({ rows } = await db.query(`SELECT * FROM tax_rates WHERE business_id = $1 ORDER BY sort_order, tax_rate_id`, [businessId]));
  }
  return rows.map(asRate);
};

/** Checks a rate typed by the owner; returns [clean, error]. */
export const cleanRate = (body) => {
  const name = String(body?.name ?? '').trim().slice(0, 60);
  if (!name) return [null, 'Give the rate a name'];
  const kind = String(body?.kind ?? 'TAXABLE').toUpperCase();
  if (!KINDS.includes(kind)) return [null, 'Choose taxable, nil rated, exempt or non-GST'];
  const rate = kind === 'TAXABLE' ? Number(body?.rate) : 0;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return [null, 'The rate must be from 0 to 100'];
  return [{ name, rate: Math.round(rate * 100) / 100, kind }, null];
};

/** The rate a product should carry, from a chosen tax_rate_id (must be this business's). Returns { id, rate } or null when none was chosen. */
export const pickRate = async (db, businessId, taxRateId) => {
  if (taxRateId == null || taxRateId === '') return null;
  const r = (await db.query(`SELECT tax_rate_id, rate FROM tax_rates WHERE tax_rate_id = $1 AND business_id = $2`, [Number(taxRateId), businessId])).rows[0];
  if (!r) throw Object.assign(new Error('That GST rate is not in your list'), { status: 400 });
  return { id: r.tax_rate_id, rate: Number(r.rate) };
};
