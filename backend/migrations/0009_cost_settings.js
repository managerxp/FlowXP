/*
 * Per-business assumptions the profitability engine needs but cannot know:
 * what a payment method costs, what each delivery platform takes, what a
 * takeaway/delivery box costs. Every default is zero — a made-up commission
 * rate presented as fact is worse than an honest "not set yet".
 */
export const up = async (client) => {
  await client.query(`
    CREATE TABLE cost_settings (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(business_id) ON DELETE CASCADE,
      -- {"CARD": 1.8, "UPI": 0}: percent of the amount collected, by payment method.
      payment_fee_pct JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- {"ZOMATO": 22, "SWIGGY": 20}: percent of the order's food value, by platform.
      platform_commission_pct JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- Per takeaway or delivery order (box, bag, cutlery).
      packaging_per_order_paise BIGINT NOT NULL DEFAULT 0 CHECK (packaging_per_order_paise >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};
