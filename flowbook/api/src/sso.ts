/*
 * Who is working in the books. FlowBook has no sign-in of its own: the FlowXP API signs the person in, puts who they are on the
 * request (user, FlowXP business, role, and that business's trial or plan), and FlowBook finds or makes their user and the
 * business's books. The trial is FlowXP's: the books' plan and trial end are copied from the business.
 */
import type pg from 'pg';
import { withOrg } from './db.ts';
import { newSecret, storeSecret } from './inbox.ts';
import { provisionOrganization } from './provision.ts';

export type Identity = { sub: string; email: string; name: string; bid: string; bname: string; role: string; status: string; tend: string | null };

const ROLE: Record<string, string> = { OWNER: 'owner', ADMIN: 'admin' };

/** Find or make the person and the business's books, add them if new, and copy the trial. Returns null for a role that may not open the books. */
export const signInFromFlowxp = async (pool: pg.Pool, h: Identity): Promise<{ userId: bigint; orgId: bigint } | null> => {
  // two handoffs for the same business can arrive together (a double click, a page that opens twice): one at a time, or each would make its own books
  const lock = await pool.connect();
  try {
    await lock.query(`SELECT pg_advisory_lock(hashtext($1))`, [`flowbook-sso:${h.bid}`]);
    return await signIn(pool, h);
  } finally {
    await lock.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`flowbook-sso:${h.bid}`]).catch(() => {});
    lock.release();
  }
};

/** The same, remembered for a few seconds: every call of the app comes through here, and nothing it checks changes that fast. */
const seen = new Map<string, { at: number; r: { userId: bigint; orgId: bigint } | null }>();
export const hostSession = async (pool: pg.Pool, h: Identity): Promise<{ userId: bigint; orgId: bigint } | null> => {
  const key = [h.sub, h.bid, h.role, h.status, h.tend, h.email, h.bname].join('|');
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.r;
  const r = await signInFromFlowxp(pool, h);
  if (seen.size > 2000) seen.clear();
  seen.set(key, { at: Date.now(), r });
  return r;
};

const signIn = async (pool: pg.Pool, h: Identity): Promise<{ userId: bigint; orgId: bigint } | null> => {
  let user = (await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) AND status = 'ACTIVE'`, [h.email])).rows[0];
  if (!user) user = (await pool.query(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, 'flowxp-sign-in') RETURNING id`, [h.email, h.name || h.email])).rows[0];
  const userId = user.id as bigint;
  let org = (await pool.query(`SELECT id FROM organizations WHERE flowxp_business_id = $1`, [h.bid])).rows[0];
  const role = ROLE[h.role] ?? 'viewer';
  if (!org) {
    if (!ROLE[h.role]) return null;   // the first person in must be the owner or an admin
    const id = await provisionOrganization(pool, { name: h.bname || 'My business', ownerUserId: userId });
    await pool.query('UPDATE organizations SET flowxp_business_id = $2 WHERE id = $1', [id, h.bid]);
    org = { id };
  }
  // FlowXP's sales reach these books inside the same process, so the connection needs no address and no secret from anyone: this row only says whose books they are
  if (!(await pool.query(`SELECT 1 FROM integration_connections WHERE provider = 'FLOWXP' AND external_business_id = $1`, [h.bid])).rowCount) {
    await withOrg(pool, org.id as bigint, (c) => c.query(
      `INSERT INTO integration_connections (organization_id, provider, external_business_id, secret) VALUES ($1, 'FLOWXP', $2, $3) ON CONFLICT DO NOTHING`, [org.id, h.bid, storeSecret(newSecret())]));
  }
  await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO NOTHING`, [org.id, userId, role]);
  // FlowXP's trial is the trial: a paid business is ACTIVE; a trial, an ended trial or anything else follows the trial end it reports
  const paid = h.status === 'ACTIVE';
  const end = h.status === 'TRIAL' && h.tend ? h.tend : new Date(Math.min(Date.parse(h.tend ?? '') || Date.now(), Date.now())).toISOString();
  await pool.query(`UPDATE organizations SET plan = $2, trial_ends_at = $3 WHERE id = $1`, [org.id, paid ? 'ACTIVE' : 'TRIAL', end]);
  return { userId, orgId: org.id as bigint };
};
