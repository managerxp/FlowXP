/*
 * FlowXP database — connection pool and schema.
 *
 * The schema is versioned: see config/migrate.js and backend/migrations/.
 * Starting the server applies any migration not yet recorded in
 * schema_migrations; 0001_baseline holds the original tables.
 *
 * ── The tenancy model ──────────────────────────────────────────────────────
 *
 *     user            a person who signs in
 *       ↓ business_users (role)
 *     business        the tenant — owns every product, invoice, customer
 *       ↓
 *     branch          a location within that business
 *
 * Every business-owned table carries business_id NOT NULL. That column, not
 * application logic, is what makes cross-tenant leakage a query bug rather
 * than a silent data breach: a query that forgets it fails to compile against
 * the foreign key, and one that forges it is caught in middleware/tenant.js.
 */
import pg from 'pg';
import config from './env.js';
import { runMigrations } from './migrate.js';

/*
 * DATE columns (invoice_date, expense_date, po_date...) come back from `pg`
 * as JS Date objects by default, parsed at UTC midnight. Every response goes
 * through JSON.stringify, which then renders that as a full UTC timestamp —
 * so a business in IST (UTC+5:30) sees its own invoice dated the previous
 * evening. There is no timezone-correct way to turn "2026-09-05" into a JS
 * Date without picking a timezone to assume, so the fix is to never make
 * that conversion: oid 1082 is DATE, and returning the raw string keeps
 * exactly what Postgres sent — "2026-09-05", nothing to misinterpret.
 */
pg.types.setTypeParser(1082, (value) => value);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Managed Postgres (Render, Neon, RDS) terminates TLS with its own CA.
  ssl: config.isProduction ? { rejectUnauthorized: false } : false
});

pool.on('error', (error) => {
  console.error('[db] idle client error:', error.message);
});

export const initializeDatabase = () => runMigrations(pool);

export default pool;
