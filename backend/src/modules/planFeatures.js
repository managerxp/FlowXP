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
  ['delivery_fleet', 'Delivery riders', 'Assign your own delivery staff to orders and track pickup, out-for-delivery and delivered'],
  ['tables', 'Tables & floor', 'The floor plan, table status and dine-in orders by table'],
  ['kitchen', 'Kitchen display', 'The kitchen screen: tickets by station, timing and the order board'],
  // Salon module. Each is its own switch so a plan (or a paid add-on) can include, say, appointments
  // without memberships. Missing key = on, like every feature above.
  ['salon_appointments', 'Appointments', 'Calendar, staff availability, walk-ins and double-booking protection'],
  ['salon_memberships', 'Memberships', 'Membership plans with discounts and free services, renewals and expiry reminders'],
  ['salon_packages', 'Service packages', 'Bundles of services sold at one price and used visit by visit'],
  ['salon_gift_cards', 'Gift cards', 'Sell and redeem stored-value gift cards'],
  ['salon_commission', 'Staff commission', 'Commission rules, approval and payouts for stylists and therapists'],
  ['salon_automation', 'Salon reminders', 'Appointment, birthday, membership, points and revisit reminders'],
  // Wholesale module — separate switches so a plan can include orders without the warehouse tools, and so on.
  ['wholesale_orders', 'Sales orders', 'B2B sales orders with stock reservation, partial fulfilment and back-orders'],
  ['wholesale_fulfilment', 'Warehouse fulfilment', 'Pick lists, packing, delivery challans and in-transit transfers'],
  ['wholesale_pricing', 'Wholesale pricing', 'Price lists, customer-specific prices, quantity breaks and promotions'],
  ['wholesale_batches', 'Batches and expiry', 'Batch and serial tracking with first-expiry-first-out and expiry alerts'],
  // Supermarket / retail. Missing key = on.
  ['auto_sku', 'Automatic SKU', 'FlowXP makes each new product\'s SKU (MILK-00001), so nobody has to invent one']
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
/*
 * Which features each kind of business has no use for. This is the starting point per industry, so a salon is not
 * offered Reservations or QR table ordering, a pharmacy is not offered the kitchen display, and so on, without an admin
 * having to switch each one off by hand for every business type and plan.
 *
 * It is a default, not a lock: the business-type switch for that (type, plan) in the admin console can turn any of
 * these back ON with an explicit `true`, and a per-business override still wins over everything. Types not listed
 * (OTHER) have no defaults, so everything stays on for them.
 */
const SALON_KEYS = PLAN_FEATURE_KEYS.filter((k) => k.startsWith('salon_'));
const WHOLESALE_KEYS = PLAN_FEATURE_KEYS.filter((k) => k.startsWith('wholesale_'));
const NOT_FOOD = ['reservations', 'integrations', 'qr_ordering', 'multi_brand', 'delivery_fleet', 'tables', 'kitchen'];
const SHOP_OFF = [...NOT_FOOD, ...SALON_KEYS, 'wholesale_orders', 'wholesale_fulfilment', 'wholesale_pricing'];
const FOOD_OFF = [...SALON_KEYS, ...WHOLESALE_KEYS];
export const INDUSTRY_OFF = {
  RESTAURANT: FOOD_OFF, CAFE: FOOD_OFF, GAMING_CAFE: FOOD_OFF, RACING: FOOD_OFF,
  CLOUD_KITCHEN: [...FOOD_OFF, 'reservations', 'qr_ordering', 'tables'],           // no dining room
  SALON: [...NOT_FOOD, ...WHOLESALE_KEYS],                                          // appointments, not table bookings
  RETAIL: SHOP_OFF, SUPERMARKET: SHOP_OFF, PHARMACY: SHOP_OFF,                      // these keep batches and expiry
  ELECTRONICS: [...SHOP_OFF, 'wholesale_batches'], CLOTHING: [...SHOP_OFF, 'wholesale_batches'], SERVICES: [...SHOP_OFF, 'wholesale_batches'],
  WHOLESALE: [...NOT_FOOD, ...SALON_KEYS, 'loyalty'], DISTRIBUTOR: [...NOT_FOOD, ...SALON_KEYS, 'loyalty']
};

/** What the industry's own defaults say for this business type, in the same shape as a feature_flags object: { key: false }. */
export const industryDefaults = (businessType) => Object.fromEntries((INDUSTRY_OFF[String(businessType || '').toUpperCase()] || []).map((key) => [key, false]));

/**
 * `sources` is [plan flags, business-type flags for this plan]; `businessType` adds that industry's defaults, which
 * the business-type flags can turn back on with an explicit `true`.
 */
export const effectiveFeatureFlags = (sources, overrides, businessType) => {
  overrides ??= {};
  const typeFlags = sources?.[1] || {};
  const off = new Set(Object.keys(industryDefaults(businessType)).filter((key) => typeFlags[key] !== true));
  const merged = {};
  for (const key of PLAN_FEATURE_KEYS) {
    if (overrides[key] === true) continue;   // forced on — skip the off-check below entirely
    if (overrides[key] === false || off.has(key) || sources.some((flags) => flags?.[key] === false)) merged[key] = false;
  }
  return merged;
};
