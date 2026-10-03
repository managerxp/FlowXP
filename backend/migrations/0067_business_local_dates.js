/*
 * A row stamped "today" must carry the business's today, not the database server's. CURRENT_DATE is UTC, so for an
 * Indian business anything written between 00:00 and 05:30 IST (a late-night payment, an early opening) landed on the
 * previous day and then fell out of that day's reports and the date-range filters the app builds from businessToday().
 *
 * A column DEFAULT cannot look up the business, so the default is dropped and a BEFORE INSERT trigger fills the column
 * only when the caller left it empty. Every writer is covered at once, including the ones that never name the date, and
 * an explicit date (a back-dated entry) is kept as given.
 */
const COLUMNS = [
  ['invoices', 'invoice_date'], ['payments', 'payment_date'], ['purchase_orders', 'po_date'], ['expenses', 'expense_date'],
  ['credit_notes', 'cn_date'], ['debit_notes', 'dn_date'], ['salon_stock_batches', 'received_on'], ['wholesale_batches', 'received_on']
];

export const up = async (client) => {
  await client.query(`
    CREATE OR REPLACE FUNCTION business_today(bid INTEGER) RETURNS DATE LANGUAGE sql STABLE AS $$
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = bid), 'Asia/Kolkata'))::date
    $$`);
  await client.query(`
    CREATE OR REPLACE FUNCTION stamp_business_date() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF to_jsonb(NEW) ->> TG_ARGV[0] IS NULL THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], business_today(NEW.business_id)));
      END IF;
      RETURN NEW;
    END $$`);
  for (const [table, column] of COLUMNS) {
    await client.query(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`);
    await client.query(`DROP TRIGGER IF EXISTS trg_${table}_${column} ON ${table}`);
    await client.query(`CREATE TRIGGER trg_${table}_${column} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION stamp_business_date('${column}')`);
  }
};
