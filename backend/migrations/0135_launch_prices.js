/*
 * Launch prices (owner, 2026-11-16). Prices are GST-exclusive; 18% GST is added on the invoice.
 *  - Plans: Starter 9,999 / Growth 16,999 a year; Enterprise starts at 25,999. A month is a tenth of the year.
 *  - Add-ons are priced per year; the month is a tenth of that.
 *  - Barcode labels becomes a real add-on: off on Starter and Growth, included on Enterprise.
 *  Unlike 0127 this overwrites prices, because these are the numbers the owner has now fixed. Each plan change cuts a new plan version.
 */
const PLANS = { STARTER: 9999, GROWTH: 16999, ENTERPRISE: 25999 };
const ADDONS = { ai: 499, loyalty: 999, advanced_reports: 999, delivery_fleet: 499, purchases: 199, expenses: 199, reviews: 199, reservations: 199, multi_brand: 3000, barcode_labels: 1499, qr_ordering: 1299 };

export const up = async (client) => {
  for (const [code, rupees] of Object.entries(PLANS)) {
    const cur = (await client.query(`SELECT feature_flags, limits FROM plans WHERE plan_code = $1`, [code])).rows[0];
    if (!cur) continue;
    const yearly = rupees * 100; const monthly = Math.floor(rupees / 10) * 100;   // 9,999 a year is 999 a month
    const flags = { ...(cur.feature_flags || {}) };
    if (code !== 'ENTERPRISE') flags.barcode_labels = false; else delete flags.barcode_labels;
    await client.query(`UPDATE plans SET price_monthly_paise = $2, price_yearly_paise = $3, feature_flags = $4 WHERE plan_code = $1`, [code, monthly, yearly, JSON.stringify(flags)]);
    const live = (await client.query(`SELECT plan_version_id, version_number FROM plan_versions WHERE plan_code = $1 AND effective_to IS NULL FOR UPDATE`, [code])).rows[0];
    if (live) await client.query(`UPDATE plan_versions SET effective_to = CURRENT_TIMESTAMP WHERE plan_version_id = $1`, [live.plan_version_id]);
    await client.query(
      `INSERT INTO plan_versions (plan_code, version_number, price_monthly_paise, price_yearly_paise, limits, feature_flags) VALUES ($1,$2,$3,$4,$5,$6)`,
      [code, (live?.version_number ?? 0) + 1, monthly, yearly, JSON.stringify(cur.limits), JSON.stringify(flags)]
    );
  }
  const retail = ['RETAIL', 'SUPERMARKET', 'PHARMACY', 'ELECTRONICS', 'CLOTHING', 'SERVICES', 'AUTO_PARTS', 'MECHANIC', 'WHOLESALE', 'DISTRIBUTOR', 'SALON', 'GYM', 'OTHER'];
  await client.query(
    `INSERT INTO addons (addon_key, name, description, price_monthly_paise, price_yearly_paise, is_active, sort_order, business_types)
     VALUES ('barcode_labels', 'Barcode labels and linking', 'Print barcode price tags, make barcodes for goods without one, and link a maker''s barcode to an item', 0, 0, true, 5, $1)
     ON CONFLICT (addon_key) DO NOTHING`, [retail]);
  for (const [key, rupees] of Object.entries(ADDONS)) {
    const yearly = rupees * 100;
    await client.query(`UPDATE addons SET price_yearly_paise = $2, price_monthly_paise = $3 WHERE addon_key = $1`, [key, yearly, yearly / 10]);
  }
};
