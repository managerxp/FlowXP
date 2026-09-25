/*
 * Baseline: the schema as it stood when migrations were introduced. It is the
 * old boot-time DDL moved verbatim, and every statement is idempotent, so it
 * is a no-op on a database that already has these tables and builds a fresh
 * one from zero. Never edit this file after it has been applied anywhere — add
 * a new numbered migration instead.
 */
import { initializeCommerceSchema } from '../src/config/schema.commerce.js';
import { initializeOrdersSchema } from '../src/config/schema.orders.js';

export const up = async (client) => {
    /* ====================================================================
       USERS — a person, independent of any business
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        -- Stored lower-cased by the application. A UNIQUE index on a
        -- case-sensitive column would happily accept Bob@x.com twice.
        email VARCHAR(160) NOT NULL UNIQUE,
        phone VARCHAR(32),
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    /* A platform operator, not a tenant. A super admin is a users row like any
       other (same password hashing, same JWT) with this one flag — a separate
       admin_users table would just be a second login system to keep in sync.
       Seeded from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD at boot; see
       config/seedSuperAdmin.js. */
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE`);

    /* ====================================================================
       BUSINESSES — the tenant
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        business_id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        business_type VARCHAR(40) NOT NULL DEFAULT 'OTHER',
        owner_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,

        -- Contact and tax identity, filled in during onboarding rather than at
        -- signup: the brief's target is signup to first invoice in 5 minutes,
        -- and a 12-field signup form does not get there.
        email VARCHAR(160),
        phone VARCHAR(32),
        address TEXT,
        city VARCHAR(80),
        state VARCHAR(80),
        country VARCHAR(80) NOT NULL DEFAULT 'India',
        postal_code VARCHAR(20),
        gstin VARCHAR(20),
        gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,

        currency VARCHAR(8) NOT NULL DEFAULT 'INR',
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
        -- Indian financial year runs April–March; stored as a month number so
        -- a business on a different cycle can change it.
        financial_year_start_month SMALLINT NOT NULL DEFAULT 4
          CHECK (financial_year_start_month BETWEEN 1 AND 12),

        invoice_prefix VARCHAR(12) NOT NULL DEFAULT 'INV',
        invoice_next_number INTEGER NOT NULL DEFAULT 1,

        -- Subscription state. TRIAL is the only status a new business can hold;
        -- everything else is reached through payment or expiry.
        subscription_status VARCHAR(16) NOT NULL DEFAULT 'TRIAL'
          CHECK (subscription_status IN ('TRIAL','ACTIVE','EXPIRED','CANCELLED','SUSPENDED')),
        plan_code VARCHAR(32) NOT NULL DEFAULT 'TRIAL',
        billing_cycle VARCHAR(16) CHECK (billing_cycle IN ('MONTHLY','YEARLY')),
        trial_started_at TIMESTAMPTZ,
        trial_ends_at TIMESTAMPTZ,
        subscription_id VARCHAR(120),
        next_billing_date TIMESTAMPTZ,

        -- 0 = not started, 10 = finished. Drives the onboarding wizard so a
        -- user who closes the tab resumes where they left off.
        onboarding_step SMALLINT NOT NULL DEFAULT 0,

        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses (owner_user_id)
    `);

    /* ====================================================================
       BRANCHES — a location inside a business

       Created now, with one "Main" branch per business, even though
       multi-branch is a later priority. The cost is this table; the cost of
       adding it later is a branch_id backfill across every record table.
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        branch_id SERIAL PRIMARY KEY,
        business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        address TEXT,
        phone VARCHAR(32),
        -- Exactly one branch per business is the default target for new
        -- records, so billing does not have to ask "which branch" on day one.
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','CLOSED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_branches_business ON branches (business_id)
    `);

    /* ====================================================================
       MEMBERSHIP — who may act on which business, and as what

       Role lives here rather than on users, because the same person can be
       OWNER of their own shop and CASHIER at a friend's.
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_users (
        business_id INTEGER NOT NULL REFERENCES businesses(business_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        role VARCHAR(16) NOT NULL DEFAULT 'STAFF'
          CHECK (role IN ('OWNER','ADMIN','MANAGER','CASHIER','STAFF')),
        -- NULL = every branch. A cashier is normally pinned to one.
        branch_id INTEGER REFERENCES branches(branch_id) ON DELETE SET NULL,
        -- Per-user overrides on top of the role's defaults. Empty means
        -- "whatever the role grants", which is the case for almost everyone.
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CHECK (status IN ('ACTIVE','INVITED','DISABLED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (business_id, user_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_business_users_user ON business_users (user_id)
    `);

    /* ====================================================================
       PASSWORD RESETS

       The raw token goes in the email and is never stored; only its SHA-256
       hash is kept. A leaked database therefore yields no usable reset links.
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash CHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)
    `);

    /* ====================================================================
       PLANS — pricing as data

       The brief is explicit that final prices are not confirmed. Rows, not
       constants: changing a price is an UPDATE, not a deploy. Amounts are
       stored in paise (integer) because floating-point money eventually
       bills someone ₹1,199.9999999.
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        plan_code VARCHAR(32) PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        description TEXT,
        price_monthly_paise BIGINT NOT NULL DEFAULT 0,
        price_yearly_paise BIGINT NOT NULL DEFAULT 0,
        -- e.g. {"users": 3, "invoices_per_month": 500, "ai_queries": 50}.
        -- NULL inside means unlimited.
        limits JSONB NOT NULL DEFAULT '{}'::jsonb,
        features JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        is_public BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    /* Seed the plan ladder with zero prices — deliberately. A wrong price on
       the public pricing page is worse than a blank one, so these stay at 0
       until the real numbers are set. ON CONFLICT DO NOTHING means editing a
       price in the database is not undone by the next restart. */
    await client.query(`
      INSERT INTO plans (plan_code, name, description, limits, features, sort_order, is_public)
      VALUES
        ('TRIAL',      'Free Trial', 'Full access for 7 days. No credit card required.',
         '{"users": 3, "ai_queries": 50}'::jsonb,
         '["Billing & invoicing","GST invoices","Inventory","Flow AI (limited)"]'::jsonb, 0, FALSE),
        ('STARTER',    'Starter',    'For a single shop finding its feet.',
         '{"users": 2, "ai_queries": 100}'::jsonb,
         '["Billing & invoicing","GST invoices","Inventory","Basic reports"]'::jsonb, 1, TRUE),
        ('GROWTH',     'Growth',     'For a busy shop that needs its numbers.',
         '{"users": 5, "ai_queries": 500}'::jsonb,
         '["Everything in Starter","Purchases & suppliers","Expenses","Flow AI"]'::jsonb, 2, TRUE),
        ('BUSINESS',   'Business',   'For multiple counters and locations.',
         '{"users": 15, "ai_queries": 2000}'::jsonb,
         '["Everything in Growth","Multi-branch","Advanced reports","Role permissions"]'::jsonb, 3, TRUE),
        ('ENTERPRISE', 'Enterprise', 'For groups running several businesses.',
         '{}'::jsonb,
         '["Everything in Business","Unlimited users","Priority support","Onboarding help"]'::jsonb, 4, TRUE)
      ON CONFLICT (plan_code) DO NOTHING
    `);

    /* ====================================================================
       AUDIT LOG — what happened, who did it, in which business
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        audit_id BIGSERIAL PRIMARY KEY,
        business_id INTEGER REFERENCES businesses(business_id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        action VARCHAR(64) NOT NULL,
        resource_type VARCHAR(40),
        resource_id VARCHAR(64),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_business_time
        ON audit_log (business_id, created_at DESC)
    `);

    /* ====================================================================
       ANALYTICS — internal activation funnel

       Separate from audit_log on purpose. Audit answers "who changed this
       invoice"; analytics answers "how many signups reach a first invoice".
       Mixing them means one of the two questions is always awkward to query.
       ==================================================================== */
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        event_id BIGSERIAL PRIMARY KEY,
        event VARCHAR(48) NOT NULL,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        business_id INTEGER REFERENCES businesses(business_id) ON DELETE CASCADE,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_event_time
        ON analytics_events (event, created_at DESC)
    `);

    await initializeCommerceSchema(client);
    await initializeOrdersSchema(client);
};
