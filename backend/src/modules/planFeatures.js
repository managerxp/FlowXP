/*
 * Plan-level features an admin can turn on/off per plan, on top of the
 * numeric limits (users/outlets/ai_queries) already enforced elsewhere.
 *
 * Different axis from modules/permissions.js: a *permission* is per-user (can
 * this cashier see Reports); a *plan feature* is per-business (does this
 * business's plan include Reservations at all, whoever is signed in). Both
 * must say yes for a screen to work.
 *
 * Missing key = enabled. Only an explicit `false` in plans.feature_flags
 * turns a feature off, so TRIAL ("every feature on") needs no flags set, and
 * adding a new feature here later never silently locks out a plan nobody
 * has touched.
 */
export const PLAN_FEATURES = [
  ['loyalty', 'Loyalty & rewards', 'Visit card, points and tiers, coupons'],
  ['messaging', 'Messaging', 'WhatsApp/SMS bills, booking confirmations, offers'],
  ['reservations', 'Reservations & waitlist', 'Table bookings and the walk-in waitlist'],
  ['purchases', 'Purchasing & suppliers', 'Purchase orders, supplier price lists, debit notes'],
  ['expenses', 'Expenses', 'Recording and reporting business expenses'],
  ['ai', 'Flow AI', 'The AI manager chat, briefings and menu-photo import'],
  ['advanced_reports', 'Advanced reports', 'Profitability, revenue leakage and demand forecast'],
  ['integrations', 'Delivery integrations', 'Zomato/Swiggy/ONDC/Magicpin order sync and webhooks'],
  ['qr_ordering', 'QR table ordering', 'Customers order from their phone by scanning a table QR code'],
  ['reviews', 'Customer feedback & reviews', 'Post-bill star ratings, private feedback, AI reply drafts and a Google review prompt'],
  ['multi_brand', 'Multiple brands', 'Run several virtual brands from one kitchen — a brand tag on menu items and orders'],
  ['delivery_fleet', 'Delivery riders', 'Assign your own delivery staff to orders and track pickup, out-for-delivery and delivered']
];

export const PLAN_FEATURE_KEYS = PLAN_FEATURES.map(([key]) => key);

/** True unless this plan explicitly switched the feature off. */
export const hasPlanFeature = (tenant, feature) => tenant?.planFeatures?.[feature] !== false;

/*
 * Three gates decide whether a business actually has a feature, in
 * precedence order:
 *
 *  1. `overrides` (business_feature_overrides) — a super admin's explicit
 *     per-business decision. `true` forces the feature on no matter what the
 *     plan or business type say; `false` forces it off the same way. Wins
 *     outright, in either direction — this is the "Business X stays on Basic
 *     but also gets Advanced Reports" case.
 *  2. `sources` (plans.feature_flags — did they pay for this — and
 *     business_type_features.feature_flags for this exact (business type,
 *     plan) pair — does this apply to a Salon at all, on this plan) — any
 *     source saying `false` turns a key off; every source unset ({}) = on.
 *     Collapses to "just the plan's flags" when that (type, plan) pair
 *     hasn't been configured, the same as before that axis existed.
 *
 * Missing everywhere = on, so a plan, business type or business nobody has
 * touched here keeps working exactly as it did before each axis existed.
 */
export const effectiveFeatureFlags = (sources, overrides) => {
  overrides ??= {};
  const merged = {};
  for (const key of PLAN_FEATURE_KEYS) {
    if (overrides[key] === true) continue;   // forced on — skip the off-check below entirely
    if (overrides[key] === false || sources.some((flags) => flags?.[key] === false)) merged[key] = false;
  }
  return merged;
};
