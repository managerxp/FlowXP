/*
 * The three public plans (Starter, Growth, Enterprise), their prices and what each industry gets at each step, plus the add-ons that
 * unlock the next step one feature at a time (owner's request, 2026-11-13).
 *
 *  - Prices are set only where the plan still costs 0, so a price already typed in the Super Admin is never overwritten.
 *    The change cuts a new plan version, like an edit from the Plans page would.
 *  - Plan flags (plans.feature_flags) hold the common ladder: Starter has the till, stock, estimates and basic reports; Growth adds buying,
 *    expenses, Flow AI, WhatsApp, loyalty, reviews, reservations and QR ordering; Enterprise adds advanced reports, delivery integrations,
 *    multiple brands and riders. FlowBook's own switches are left alone (it is a separate product).
 *  - Industry tools (salon, gym, gaming, parts and garage, wholesale) step up the same way, through business_type_features per (type, plan).
 *    Only the keys named here are touched; anything else an admin set stays.
 *  - Every feature held back from a lower step gets an add-on, priced only where the add-on is still at 0.
 *  - WhatsApp is not an add-on: it is the pay-per-use credit wallet (migration 0125).
 */
const COMMON = ['ai', 'loyalty', 'messaging', 'purchases', 'expenses', 'other_income', 'reviews', 'reservations', 'qr_ordering', 'advanced_reports', 'integrations', 'multi_brand', 'delivery_fleet'];
const STARTER_OFF = COMMON;
const GROWTH_OFF = ['advanced_reports', 'integrations', 'multi_brand', 'delivery_fleet'];

/* industry tools held back: [types, keys off on Starter, keys off on Growth] */
const MODULES = [
  [['SALON'], ['salon_memberships', 'salon_packages', 'salon_gift_cards', 'salon_commission', 'salon_automation'], ['salon_commission']],
  [['GYM'], ['gym_self_checkin', 'gym_classes', 'gym_rewards', 'gym_devices'], ['gym_devices']],
  [['GAMING_CAFE'], ['gaming_wallet', 'gaming_bookings', 'gaming_tournaments'], ['gaming_tournaments']],
  [['AUTO_PARTS', 'MECHANIC'], ['ap_racks', 'ap_transfers', 'ap_counts', 'ap_pricing', 'ap_intelligence', 'ap_staff'], ['ap_transfers', 'ap_intelligence']],
  [['WHOLESALE', 'DISTRIBUTOR'], ['wholesale_fulfilment', 'wholesale_pricing', 'wholesale_batches'], ['wholesale_fulfilment']]
];

/* industry defaults hide these; wholesalers do want them, from Growth (the plan's own switch keeps them off Starter) */
const FORCE_ON = { WHOLESALE: ['loyalty'], DISTRIBUTOR: ['loyalty'] };

const PLANS = {
  STARTER: {
    monthly: 49900, yearly: 499900, limits: { users: 2, outlets: 1, ai_queries: 100 },
    description: 'Everything to bill, track stock and run the day, for a small single-location business.',
    features: ['Billing and GST invoices', 'Inventory and stock', 'Estimates and quotations', 'Basic reports', "Your industry's core tools", '2 users, 1 outlet']
  },
  GROWTH: {
    monthly: 99900, yearly: 999900, limits: { users: 5, outlets: 1, ai_queries: 500 },
    description: 'Buying, expenses, AI, WhatsApp and loyalty, for a growing business with a team.',
    features: ['Everything in Starter', 'Purchases, suppliers and expenses', 'Flow AI, 500 questions a month', 'WhatsApp bills and loyalty, pay per use', 'Reviews, reservations and QR ordering', "More of your industry's tools", '5 users']
  },
  ENTERPRISE: {
    monthly: 0, yearly: 0, limits: { outlets: null },
    description: 'Every tool, many outlets and your own set-up. Priced for your business.',
    features: ['Everything in Growth', 'Advanced reports and delivery integrations', 'Multiple brands and delivery riders', "Every one of your industry's tools", 'Unlimited users and outlets', 'Priority support']
  }
};

const FOOD = ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'];
const SHOPS = ['RETAIL', 'SUPERMARKET', 'PHARMACY', 'ELECTRONICS', 'CLOTHING', 'SERVICES', 'AUTO_PARTS', 'MECHANIC', 'WHOLESALE', 'DISTRIBUTOR', 'SALON', 'GYM', 'OTHER'];
/* [key, name, description, monthly rupees, business types] */
const ADDONS = [
  ['advanced_reports', 'Advanced reports', 'Profitability, revenue leakage and demand forecast', 299, [...FOOD, ...SHOPS]],
  ['purchases', 'Purchasing and suppliers', 'Purchase orders, supplier price lists, debit notes', 199, [...FOOD, ...SHOPS]],
  ['expenses', 'Expenses', 'Recording and reporting business expenses', 199, [...FOOD, ...SHOPS]],
  ['reviews', 'Customer feedback and reviews', 'Post-bill star ratings, private feedback and a Google review prompt', 199, [...FOOD, ...SHOPS]],
  ['multi_brand', 'Multiple brands', 'Run several virtual brands from one kitchen', 299, FOOD],
  ['delivery_fleet', 'Delivery riders', 'Assign your own delivery staff and track each order', 199, FOOD],
  ['salon_memberships', 'Salon memberships', 'Membership plans with discounts and free services', 199, ['SALON']],
  ['salon_packages', 'Service packages', 'Bundles of services sold at one price', 199, ['SALON']],
  ['salon_gift_cards', 'Gift cards', 'Sell and redeem stored-value gift cards', 199, ['SALON']],
  ['salon_commission', 'Staff commission', 'Commission rules, approval and payouts', 299, ['SALON']],
  ['salon_automation', 'Salon reminders', 'Appointment, birthday, membership and revisit reminders', 199, ['SALON']],
  ['gym_self_checkin', 'Member web check-in', 'Members check in and open their pass from their phone', 199, ['GYM']],
  ['gym_classes', 'Trainers and classes', 'Class timetable, booking, personal-training packs and workout plans', 299, ['GYM']],
  ['gym_rewards', 'Gym rewards and referrals', 'Points for visits, referral rewards, reward catalogue', 199, ['GYM']],
  ['gym_devices', 'Gate and reader devices', 'QR readers and turnstile controllers', 499, ['GYM']],
  ['gaming_wallet', 'Gaming wallet and packs', 'Prepaid wallet top-ups and hour packs', 299, ['GAMING_CAFE']],
  ['gaming_bookings', 'Station bookings', 'Reserve a station for a time, with a hold and no-show handling', 199, ['GAMING_CAFE']],
  ['gaming_tournaments', 'Tournaments', 'Events with entry fee, registrations, results and prizes', 299, ['GAMING_CAFE']],
  ['ap_racks', 'Racks and bins', 'Warehouse layout, bin quantities and put-away', 199, ['AUTO_PARTS', 'MECHANIC']],
  ['ap_transfers', 'Parts transfers', 'Transfers between bins, warehouses and branches', 299, ['AUTO_PARTS', 'MECHANIC']],
  ['ap_counts', 'Rack and bin counts', 'Count stock by bin with differences approved first', 199, ['AUTO_PARTS', 'MECHANIC']],
  ['ap_pricing', 'Trade pricing and credit', 'Price lists for garages, credit limits and reservations', 299, ['AUTO_PARTS', 'MECHANIC']],
  ['ap_intelligence', 'Parts intelligence', 'Fast, slow and dead stock, ageing and reorder suggestions', 299, ['AUTO_PARTS', 'MECHANIC']],
  ['ap_staff', 'Staff and payroll', 'Mechanics and counter staff: roster, attendance and payroll', 299, ['AUTO_PARTS', 'MECHANIC']],
  ['wholesale_fulfilment', 'Warehouse fulfilment', 'Pick lists, packing, challans and in-transit transfers', 299, ['WHOLESALE', 'DISTRIBUTOR']],
  ['wholesale_pricing', 'Wholesale pricing', 'Price lists, customer prices, quantity breaks and promotions', 299, ['WHOLESALE', 'DISTRIBUTOR']],
  ['wholesale_batches', 'Batches and expiry', 'Batch tracking with first-expiry-first-out and expiry alerts', 199, ['WHOLESALE', 'DISTRIBUTOR']],
  /* already in the catalogue for food businesses: only priced here if still 0 */
  ['ai', 'Flow AI', 'The AI manager chat, briefings and menu-photo import', 399, [...FOOD, ...SHOPS]],
  ['loyalty', 'Loyalty and rewards', 'Visit card, points and tiers, coupons', 299, [...FOOD, ...SHOPS]],
  ['reservations', 'Reservation link', 'Table bookings and the walk-in waitlist', 199, FOOD],
  ['qr_ordering', 'Table QR ordering', 'Customers order from their phone by scanning a table QR code', 299, FOOD]
];

const without = (flags, keys) => Object.fromEntries(Object.entries(flags || {}).filter(([k]) => !keys.includes(k)));
const off = (keys) => Object.fromEntries(keys.map((k) => [k, false]));

export const up = async (client) => {
  /* 1. plans: price (only where 0), limits, wording and the common ladder of switches, as a new version */
  for (const [code, p] of Object.entries(PLANS)) {
    const cur = (await client.query(`SELECT * FROM plans WHERE plan_code = $1`, [code])).rows[0];
    if (!cur) continue;
    const monthly = Number(cur.price_monthly_paise) || p.monthly;
    const yearly = Number(cur.price_yearly_paise) || p.yearly;
    const flags = { ...without(cur.feature_flags, COMMON), ...off(code === 'STARTER' ? STARTER_OFF : code === 'GROWTH' ? GROWTH_OFF : []) };
    await client.query(
      `UPDATE plans SET price_monthly_paise = $2, price_yearly_paise = $3, limits = $4, feature_flags = $5, description = $6, features = $7, is_public = true, is_active = true WHERE plan_code = $1`,
      [code, monthly, yearly, JSON.stringify(p.limits), JSON.stringify(flags), p.description, JSON.stringify(p.features)]
    );
    const live = (await client.query(`SELECT plan_version_id, version_number FROM plan_versions WHERE plan_code = $1 AND effective_to IS NULL FOR UPDATE`, [code])).rows[0];
    if (live) await client.query(`UPDATE plan_versions SET effective_to = CURRENT_TIMESTAMP WHERE plan_version_id = $1`, [live.plan_version_id]);
    await client.query(
      `INSERT INTO plan_versions (plan_code, version_number, price_monthly_paise, price_yearly_paise, limits, feature_flags) VALUES ($1,$2,$3,$4,$5,$6)`,
      [code, (live?.version_number ?? 0) + 1, monthly, yearly, JSON.stringify(p.limits), JSON.stringify(flags)]
    );
  }
  /* the older Business plan is replaced by this ladder: it stays hidden */
  await client.query(`UPDATE plans SET is_public = false, is_active = false WHERE plan_code = 'BUSINESS'`);

  /* 2. industry tools step up per (type, plan) */
  for (const [types, starterOff, growthOff] of MODULES) {
    const all = [...starterOff, ...growthOff];
    for (const type of types) {
      for (const [plan, keys] of [['STARTER', starterOff], ['GROWTH', growthOff], ['ENTERPRISE', []]]) {
        const cur = (await client.query(`SELECT feature_flags FROM business_type_features WHERE business_type = $1 AND plan_code = $2`, [type, plan])).rows[0];
        const flags = { ...without(cur?.feature_flags, [...all, ...(FORCE_ON[type] || [])]), ...off(keys), ...Object.fromEntries((FORCE_ON[type] || []).map((k) => [k, true])) };
        await client.query(
          `INSERT INTO business_type_features (business_type, plan_code, feature_flags) VALUES ($1,$2,$3) ON CONFLICT (business_type, plan_code) DO UPDATE SET feature_flags = EXCLUDED.feature_flags`,
          [type, plan, JSON.stringify(flags)]
        );
      }
    }
  }

  /* 3. add-ons: new ones are added; an existing one keeps everything the admin set except a price still at 0 */
  let order = 10;
  for (const [key, name, description, rupees, types] of ADDONS) {
    await client.query(
      `INSERT INTO addons (addon_key, name, description, price_monthly_paise, price_yearly_paise, is_active, sort_order, business_types)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7)
       ON CONFLICT (addon_key) DO UPDATE SET
         price_monthly_paise = CASE WHEN addons.price_monthly_paise = 0 THEN EXCLUDED.price_monthly_paise ELSE addons.price_monthly_paise END,
         price_yearly_paise = CASE WHEN addons.price_yearly_paise = 0 THEN EXCLUDED.price_yearly_paise ELSE addons.price_yearly_paise END,
         business_types = CASE WHEN addons.addon_key IN ('ai', 'loyalty') THEN EXCLUDED.business_types ELSE addons.business_types END`,
      [key, name, description, rupees * 100, rupees * 1000, order++, types]
    );
  }
};
