/* Older test files were written against the plans as first seeded. Migration 0127 re-cut the ladder
 * (Starter/Growth/Enterprise, per-industry tools, priced add-ons); test/planLadder.test.js covers that.
 * Call this after runMigrations() to put one test database back on the first seed. */
const STARTER = ['loyalty', 'messaging', 'reservations', 'purchases', 'expenses', 'ai', 'advanced_reports'];
const GROWTH = ['loyalty', 'messaging', 'reservations', 'advanced_reports'];
const off = (keys) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, false])));
export async function restoreLegacyPlans(pool) {
  for (const [code, keys] of [['STARTER', STARTER], ['GROWTH', GROWTH], ['ENTERPRISE', []], ['BUSINESS', []]]) {
    await pool.query(`UPDATE plans SET feature_flags = $2 WHERE plan_code = $1`, [code, off(keys)]);
    await pool.query(`UPDATE plan_versions SET feature_flags = $2 WHERE plan_code = $1 AND effective_to IS NULL`, [code, off(keys)]);
  }
  await pool.query(`UPDATE plans SET price_monthly_paise = 0, price_yearly_paise = 0`);
  await pool.query(`UPDATE plan_versions SET price_monthly_paise = 0, price_yearly_paise = 0 WHERE effective_to IS NULL`);
  await pool.query(`DELETE FROM business_type_features`);
  await pool.query(`UPDATE addons SET price_monthly_paise = 0, price_yearly_paise = 0`);
}
