/*
 * Add-ons become fully admin-managed (owner's request, 2026-09-29): create a
 * brand new one (not just edit the 5 seeded ones), and scope it to specific
 * business types — "Add-ons for Restaurant" vs "Add-ons for Salon" — so the
 * catalog can grow per industry without a code change.
 *
 * NULL/empty business_types = applies to every business type, matching the
 * existing "missing = on" convention everywhere else in this feature system.
 * A newly created add-on's key does not have to match one of
 * modules/planFeatures.js's PLAN_FEATURE_KEYS — one that doesn't just has no
 * functional effect when paid (no feature to turn on), so it can be sold as
 * a plain billable line item (e.g. "Onboarding help") ahead of the feature
 * that delivers it being built.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE addons ADD COLUMN IF NOT EXISTS business_types TEXT[]`);

  // The 5 seeded add-ons are all restaurant-family things (reservations, table QR...) — scope them
  // rather than leave them showing under every industry, including a pharmacy or a salon.
  await client.query(`
    UPDATE addons SET business_types = ARRAY['RESTAURANT','CAFE','CLOUD_KITCHEN','GAMING_CAFE','RACING']
    WHERE business_types IS NULL
  `);
};
