/*
 * Enquiries and follow-ups: someone asks about joining, the desk writes down their name and number and when to call back. The "call today" list is
 * the heart of it: every open enquiry whose follow-up date has come, oldest first. A note after each call moves the next date. When they join the
 * enquiry becomes a member (one tap, the same registration as the Members page); when they will not, it is closed with a short reason.
 */
import { branchFilter } from '../../utils/scope.js';
import { registerMember } from './members.js';
import { GymError, addDays, isoDate, oneOf, phone as cleanPhone, text } from './common.js';

export const SOURCES = ['WALK_IN', 'PHONE', 'WHATSAPP', 'INSTAGRAM', 'REFERRAL', 'WEBSITE', 'OTHER'];

/** Enquiries, with counts for the tabs. `view`: today (due or overdue), open (all open), joined, lost. */
export const list = async (db, tenant, { today, view = 'today', search = '', limit = 200 }) => {
  const p = [tenant.businessId];
  const scope = branchFilter(tenant, 'e.branch_id', p);
  const like = String(search || '').trim();
  let q = '';
  if (like) { p.push(`%${like}%`); q = ` AND (e.name ILIKE $${p.length} OR e.phone ILIKE $${p.length})`; }
  p.push(today);
  const t = p.length;
  const where = view === 'joined' ? `e.status = 'JOINED'` : view === 'lost' ? `e.status = 'LOST'` : view === 'open' ? `e.status = 'OPEN'`
    : `e.status = 'OPEN' AND COALESCE(e.next_follow_up, e.created_at::date) <= $${t}::date`;
  const rows = (await db.query(
    `SELECT e.*, e.next_follow_up::text AS next_follow_up, e.created_at::date::text AS created_on,
            (SELECT n.note FROM gym_enquiry_notes n WHERE n.enquiry_id = e.enquiry_id ORDER BY n.note_id DESC LIMIT 1) AS last_note,
            (SELECT COUNT(*)::int FROM gym_enquiry_notes n WHERE n.enquiry_id = e.enquiry_id) AS calls,
            (COALESCE(e.next_follow_up, e.created_at::date) < $${t}::date) AS overdue
       FROM gym_enquiries e WHERE e.business_id = $1${scope}${q} AND ${where}
      ORDER BY (CASE WHEN e.status = 'OPEN' THEN COALESCE(e.next_follow_up, e.created_at::date) END) ASC NULLS LAST, e.created_at DESC
      LIMIT ${Math.min(Math.max(Number(limit) || 200, 1), 500)}`, p)).rows;
  const cp = [tenant.businessId];
  const cs = branchFilter(tenant, 'e.branch_id', cp);
  cp.push(today);
  const c = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'OPEN' AND COALESCE(next_follow_up, created_at::date) <= $${cp.length}::date)::int AS today,
            COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
            COUNT(*) FILTER (WHERE status = 'JOINED' AND closed_at > now() - interval '30 days')::int AS joined_30d,
            COUNT(*) FILTER (WHERE status = 'LOST' AND closed_at > now() - interval '30 days')::int AS lost_30d
       FROM gym_enquiries e WHERE e.business_id = $1${cs}`, cp)).rows[0];
  return { counts: c, rows };
};

const load = async (db, tenant, id) => {
  const p = [id, tenant.businessId];
  const row = (await db.query(`SELECT * FROM gym_enquiries e WHERE e.enquiry_id = $1 AND e.business_id = $2${branchFilter(tenant, 'e.branch_id', p)}`, p)).rows[0];
  if (!row) throw new GymError(404, 'Not found');
  return row;
};

export const create = async (db, tenant, userId, b, today) => {
  const name = text(b.name, 'Name', { max: 160, required: true });
  const phone = cleanPhone(b.phone);
  if (!phone) throw new GymError(400, 'Enter the phone number');
  const source = oneOf(b.source, 'Where they came from', SOURCES, { fallback: 'WALK_IN' });
  const follow = isoDate(b.follow_up_on, 'Follow-up date') || addDays(today, 1);
  if (follow < today) throw new GymError(400, 'The follow-up date cannot be in the past');
  const row = (await db.query(
    `INSERT INTO gym_enquiries (business_id, branch_id, name, phone, source, interest, next_follow_up, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING enquiry_id`,
    [tenant.businessId, tenant.branchId ?? null, name, phone, source, text(b.interest, 'Interested in', { max: 200 }) || null, follow, userId ?? null])).rows[0];
  const note = text(b.note, 'Note', { max: 500 });
  if (note) await db.query(`INSERT INTO gym_enquiry_notes (enquiry_id, note, created_by) VALUES ($1,$2,$3)`, [row.enquiry_id, note, userId ?? null]);
  return { enquiry_id: row.enquiry_id, next_follow_up: follow };
};

/** After a call: what was said, and when to call next (default: tomorrow). */
export const addNote = async (db, tenant, userId, id, b, today) => {
  const e = await load(db, tenant, id);
  if (e.status !== 'OPEN') throw new GymError(409, 'This enquiry is already closed');
  const note = text(b.note, 'Note', { max: 500, required: true });
  const next = isoDate(b.next_follow_up_on, 'Next follow-up') || addDays(today, 1);
  if (next < today) throw new GymError(400, 'The next follow-up cannot be in the past');
  await db.query(`INSERT INTO gym_enquiry_notes (enquiry_id, note, created_by) VALUES ($1,$2,$3)`, [id, note, userId ?? null]);
  await db.query(`UPDATE gym_enquiries SET next_follow_up = $2 WHERE enquiry_id = $1`, [id, next]);
  return { next_follow_up: next };
};

export const markLost = async (db, tenant, userId, id, b) => {
  const e = await load(db, tenant, id);
  if (e.status !== 'OPEN') throw new GymError(409, 'This enquiry is already closed');
  const reason = text(b.reason, 'Reason', { max: 200, required: true });
  await db.query(`UPDATE gym_enquiries SET status = 'LOST', lost_reason = $2, closed_at = now(), next_follow_up = NULL WHERE enquiry_id = $1`, [id, reason]);
  await db.query(`INSERT INTO gym_enquiry_notes (enquiry_id, note, created_by) VALUES ($1,$2,$3)`, [id, `Closed: ${reason}`, userId ?? null]);
  return { status: 'LOST' };
};

/** They joined: register them as a member with the enquiry's name and number, and close the enquiry. Selling the plan is the next step on the member's page. */
export const makeMember = async (db, tenant, userId, id, b = {}) => {
  const e = await load(db, tenant, id);
  if (e.status !== 'OPEN') throw new GymError(409, 'This enquiry is already closed');
  const member = await registerMember(db, tenant, userId, { name: e.name, phone: e.phone, confirm_duplicate: b.confirm_duplicate === true, consent_data: true });
  await db.query(`UPDATE gym_enquiries SET status = 'JOINED', member_id = $2, closed_at = now(), next_follow_up = NULL WHERE enquiry_id = $1`, [id, member.member_id]);
  await db.query(`INSERT INTO gym_enquiry_notes (enquiry_id, note, created_by) VALUES ($1,'Joined as a member',$2)`, [id, userId ?? null]);
  return { member_id: member.member_id, member_code: member.member_code };
};

export const notes = async (db, tenant, id) => {
  await load(db, tenant, id);
  return (await db.query(`SELECT n.note_id, n.note, n.created_at, u.name AS by FROM gym_enquiry_notes n LEFT JOIN users u ON u.user_id = n.created_by WHERE n.enquiry_id = $1 ORDER BY n.note_id DESC LIMIT 50`, [id])).rows;
};
