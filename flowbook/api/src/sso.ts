/*
 * One sign-in. FlowXP signs the person in and hands them over with a token it signs with the secret both servers share
 * (FLOWBOOK_SSO_SECRET): who they are, which FlowXP business, their role, and that business's own trial or plan. FlowBook
 * keeps no password for them. The trial is FlowXP's: the books' plan and trial end are copied from the business each time.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { provisionOrganization } from './provision.ts';

export type Handoff = { sub: string; email: string; name: string; bid: string; bname: string; role: string; status: string; tend: string | null; exp: number };

/** The handoff if the signature is right and it has not expired (it lives 60 seconds), else null. */
export const readHandoff = (token: string, secret: string, now = Date.now()): Handoff | null => {
  const [body, sig] = token.split('.');
  if (!secret || !body || !sig) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const h = JSON.parse(Buffer.from(body, 'base64url').toString()) as Handoff;
    return typeof h.exp === 'number' && h.exp > now && h.sub && h.email && h.bid ? h : null;
  } catch { return null; }
};

const ROLE: Record<string, string> = { OWNER: 'owner', ADMIN: 'admin' };

/** Find or make the person and the business's books, add them if new, and copy the trial. Returns null for a role that may not open the books. */
export const signInFromFlowxp = async (pool: pg.Pool, h: Handoff): Promise<{ userId: bigint; orgId: bigint } | null> => {
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

const signIn = async (pool: pg.Pool, h: Handoff): Promise<{ userId: bigint; orgId: bigint } | null> => {
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
  await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO NOTHING`, [org.id, userId, role]);
  // FlowXP's trial is the trial: a paid business is ACTIVE; a trial, an ended trial or anything else follows the trial end it reports
  const paid = h.status === 'ACTIVE';
  const end = h.status === 'TRIAL' && h.tend ? h.tend : new Date(Math.min(Date.parse(h.tend ?? '') || Date.now(), Date.now())).toISOString();
  await pool.query(`UPDATE organizations SET plan = $2, trial_ends_at = $3 WHERE id = $1`, [org.id, paid ? 'ACTIVE' : 'TRIAL', end]);
  return { userId, orgId: org.id as bigint };
};
