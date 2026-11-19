/*
 * Loyalty points expiry, run by the background worker. A card with "points expire after N days" has what a member earned and left unused for N days written off
 * as an EXPIRE row in the ledger (see engine.expireMembership: oldest points are used first, history is never edited). A card without it never expires anything.
 * Each business is checked about twice a day; one member failing never stops the rest.
 */
import pool from '../config/database.js';
import { registerScan } from './jobs.js';
import { claim } from './scans.js';
import { withTransaction } from './wholesale/common.js';
import * as engine from './loyaltyEngine.js';
import { pushBalance } from './walletGoogle.js';

export const EVERY_MINUTES = 720;

/** Expires points for one business. Returns how many members lost points and how many points in all. */
export const runForBusiness = async (db, businessId, { on = new Date() } = {}) => {
  // only members who have a balance and some credit older than their card's expiry can lose anything: the rest are skipped without taking a lock
  const { rows } = await db.query(
    `SELECT m.membership_id FROM loyalty_memberships m JOIN loyalty_programmes p ON p.programme_id = m.programme_id
      WHERE m.business_id = $1 AND p.expiry_days IS NOT NULL
        AND EXISTS (SELECT 1 FROM points_ledger l WHERE l.membership_id = m.membership_id AND l.voided_at IS NULL AND l.points > 0 AND l.created_at < $2::timestamptz - p.expiry_days * interval '1 day')
      ORDER BY m.membership_id`, [businessId, on]);
  const out = { members: 0, points: 0 }; const changed = [];
  for (const r of rows) {
    try {
      const x = await withTransaction((c) => engine.expireMembership(c, { businessId, membershipId: r.membership_id, on }));
      if (x.expired > 0) { out.members += 1; out.points += x.expired; changed.push(r.membership_id); }
    } catch (error) { console.error(`[loyalty] expiry failed for member ${r.membership_id}:`, error.message); }
  }
  if (changed.length) pushBalance(changed);   // a saved Google Wallet pass shows the new balance (does nothing when Wallet is not set up)
  return out;
};

export const runScan = async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT b.business_id FROM businesses b JOIN loyalty_programmes p ON p.business_id = b.business_id
      WHERE p.expiry_days IS NOT NULL AND b.status = 'ACTIVE' AND b.subscription_status IN ('TRIAL','ACTIVE')`);
  for (const r of rows) {
    try {
      if (!(await claim(r.business_id, 'loyalty_expiry', EVERY_MINUTES))) continue;
      const out = await runForBusiness(pool, r.business_id);
      if (out.members) console.log(`[loyalty] business ${r.business_id}: ${out.points} points expired for ${out.members} members`);
    } catch (error) { console.error(`[loyalty] expiry scan failed for ${r.business_id}:`, error.message); }
  }
};
registerScan(runScan);
