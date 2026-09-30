/*
 * Trim the public plan ladder to 3 (owner's request, 2026-09-29): Starter,
 * Growth, Enterprise. Business is retired rather than deleted — it keeps its
 * row (so plan_versions/audit_log history and any FK referencing it stay
 * intact) but is hidden from the public `/plans` ladder (`WHERE is_active AND
 * is_public`, routes/index.js) and the admin's "assign a plan" picker reads
 * from the same public set. Enterprise already carries every feature flag
 * and limit Business had (see modules/planFeatures.js — both are "everything
 * on"; Enterprise's limits are a superset, e.g. unlimited outlets/users
 * against Business's 5/15), so a business moved off Business loses nothing.
 *
 * New positioning copy from the owner's 3-plan table. Enterprise's bullet
 * list absorbs Business's former features ("Multi-branch", "Role
 * permissions") since a plan no longer on the ladder shouldn't be the thing
 * customers are told they're inheriting from.
 */
export const up = async (client) => {
  await client.query(`UPDATE plans SET is_active = FALSE, is_public = FALSE WHERE plan_code = 'BUSINESS'`);

  await client.query(`
    UPDATE plans SET description = 'Essential tools to run day-to-day operations — for small, single-location businesses.'
    WHERE plan_code = 'STARTER'
  `);
  await client.query(`
    UPDATE plans SET description = 'Advanced operations, automation and analytics — for growing businesses and multi-user teams.'
    WHERE plan_code = 'GROWTH'
  `);
  await client.query(`
    UPDATE plans SET
      description = 'Advanced control, integrations and customization — for multi-branch and larger businesses.',
      features = '["Everything in Growth","Multi-branch & role permissions","Advanced reports","Unlimited users, priority support"]'::jsonb
    WHERE plan_code = 'ENTERPRISE'
  `);

  // Any business still on Business (there may be none on a fresh DB) moves to Enterprise, pinned
  // to Enterprise's current version — the same move admin.controller.js's updateBusinessPlan makes.
  await client.query(`
    UPDATE businesses SET
      plan_code = 'ENTERPRISE',
      plan_version_id = (SELECT plan_version_id FROM plan_versions WHERE plan_code = 'ENTERPRISE' AND effective_to IS NULL),
      updated_at = CURRENT_TIMESTAMP
    WHERE plan_code = 'BUSINESS'
  `);
};
