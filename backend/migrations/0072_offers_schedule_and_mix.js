/*
 * Offers grow up: they can be limited to days of the week and hours of the day (a happy hour, a weekend offer), and a new
 * kind, MIX_BUNDLE, covers a SET of products (any 3 of these biscuits for one price) instead of one product or category.
 *
 *   promotions.days_of_week   the weekdays it runs on, 0 = Sunday ... 6 = Saturday (null = every day)
 *   promotions.start_time/end_time   the hours it runs, in the business's own time (both or neither; an end before the start
 *                                    runs overnight)
 *   promotion_products        the products of a mix bundle
 *
 * The table's checks are rebuilt, because "one product XOR one category" no longer holds for a mix bundle.
 */
export const up = async (client) => {
  await client.query(`
    DO $$
    DECLARE c RECORD;
    BEGIN
      FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'promotions'::regclass AND contype = 'c' LOOP
        EXECUTE format('ALTER TABLE promotions DROP CONSTRAINT %I', c.conname);
      END LOOP;
    END $$
  `);
  await client.query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS days_of_week SMALLINT[]`);
  await client.query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS start_time TIME`);
  await client.query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS end_time TIME`);
  await client.query(`
    ALTER TABLE promotions
      ADD CONSTRAINT promotions_kind_check CHECK (kind IN ('PERCENT_OFF','BUY_X_GET_Y','BUNDLE_PRICE','MIX_BUNDLE')),
      ADD CONSTRAINT promotions_percent_check CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
      ADD CONSTRAINT promotions_min_qty_check CHECK (min_qty > 0),
      ADD CONSTRAINT promotions_buy_check CHECK (buy_qty IS NULL OR buy_qty >= 1),
      ADD CONSTRAINT promotions_get_check CHECK (get_qty IS NULL OR get_qty >= 1),
      ADD CONSTRAINT promotions_bundle_qty_check CHECK (bundle_qty IS NULL OR bundle_qty >= 2),
      ADD CONSTRAINT promotions_bundle_price_check CHECK (bundle_price_paise IS NULL OR bundle_price_paise >= 0),
      ADD CONSTRAINT promotions_target_check CHECK (
        CASE WHEN kind = 'MIX_BUNDLE' THEN product_id IS NULL AND category_id IS NULL ELSE (product_id IS NOT NULL) <> (category_id IS NOT NULL) END),
      ADD CONSTRAINT promotions_kind_fields_check CHECK (
        (kind <> 'PERCENT_OFF' OR percent IS NOT NULL)
        AND (kind <> 'BUY_X_GET_Y' OR (buy_qty IS NOT NULL AND get_qty IS NOT NULL))
        AND (kind NOT IN ('BUNDLE_PRICE','MIX_BUNDLE') OR (bundle_qty IS NOT NULL AND bundle_price_paise IS NOT NULL))),
      ADD CONSTRAINT promotions_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on),
      ADD CONSTRAINT promotions_hours_check CHECK ((start_time IS NULL) = (end_time IS NULL)),
      ADD CONSTRAINT promotions_days_check CHECK (days_of_week IS NULL OR (cardinality(days_of_week) BETWEEN 1 AND 7 AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]))
  `);
  await client.query(`
    CREATE TABLE promotion_products (
      promo_id INTEGER NOT NULL REFERENCES promotions(promo_id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
      PRIMARY KEY (promo_id, product_id)
    )
  `);
  await client.query(`CREATE INDEX idx_promotion_products_product ON promotion_products (product_id)`);
};
