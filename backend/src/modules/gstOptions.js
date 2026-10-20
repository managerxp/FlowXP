/*
 * The GST options a business can switch on or off (Settings > Business > GST options), stored in businesses.gst_settings:
 *   composite       composite scheme: bills are Bills of Supply with no tax charged; the business pays `composite_rate` % of turnover
 *   cess            compensation cess: each product can carry a cess rate, charged on top of GST
 *   tcs             tax collected at source: `tcs_rate` % of the bill's taxable value, added to the bill when the till asks for it
 *   tds             tax deducted by the customer: `tds_rate` % of the taxable value, taken off what the customer pays when the till asks for it
 *   reverse_charge  a bill can be marked "tax payable on reverse charge"
 * Every option is off until the owner enables it. Composite and cess only make sense for a GST-registered business, so callers also check gst_enabled.
 */
export const GST_DEFAULTS = { composite: false, composite_rate: 1, cess: false, tcs: false, tcs_rate: 1, tds: false, tds_rate: 2, reverse_charge: false };

export const withGstDefaults = (stored) => ({ ...GST_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) });

const RATES = { composite_rate: 'The composite rate', tcs_rate: 'The TCS rate', tds_rate: 'The TDS rate' };

/** Check a (partial) settings object; unknown keys are dropped. Returns { settings } or { error }. */
export const cleanGstSettings = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'GST options must be an object' };
  const out = {};
  for (const key of ['composite', 'cess', 'tcs', 'tds', 'reverse_charge']) if (key in input) out[key] = input[key] === true;
  for (const [key, what] of Object.entries(RATES)) {
    if (!(key in input)) continue;
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < 0 || n > 30) return { error: `${what} must be from 0 to 30 per cent` };
    out[key] = Math.round(n * 100) / 100;
  }
  return { settings: out };
};

/** Compensation cess on one line: `rate` % of the taxable value, in paise. Zero unless the option is on. */
export const cessOn = (taxablePaise, rate, on) => (on && Number(rate) > 0 ? Math.round(taxablePaise * Number(rate) / 100) : 0);

/** TCS / TDS on a bill: `rate` % of its taxable value (after the bill's own discount), in paise. */
export const levyOn = (taxablePaise, rate) => (Number(rate) > 0 ? Math.round(Math.max(0, taxablePaise) * Number(rate) / 100) : 0);

/**
 * What a purchase on reverse charge owes its supplier: the taxable value only. The tax is the buyer's own to pay to the government (and claim back as input credit),
 * so it stays on the purchase as `tax_paise` but is not part of the supplier's total. An ordinary purchase owes taxable value plus tax, as always.
 */
export const purchaseTotal = (subtotalPaise, taxPaise, reverseCharge) => Number(subtotalPaise) + (reverseCharge ? 0 : Number(taxPaise));

/**
 * Whether a purchase being written is on reverse charge: { on, problem }. `wanted` is what the request asked for. Asking while the business has the option off
 * (or is not registered for GST) gives a `problem` for the caller to refuse with, rather than being quietly ignored: a wrong tax treatment is worse than an error.
 */
export const purchaseReverseCharge = async (db, businessId, wanted) => {
  if (wanted !== true) return { on: false, problem: null };
  const b = (await db.query('SELECT gst_enabled, gst_settings FROM businesses WHERE business_id = $1', [businessId])).rows[0];
  if (!b?.gst_enabled) return { on: false, problem: 'Reverse charge needs GST switched on for this business.' };
  if (!withGstDefaults(b.gst_settings).reverse_charge) return { on: false, problem: 'Switch on "Reverse charge" in the GST options first.' };
  return { on: true, problem: null };
};
