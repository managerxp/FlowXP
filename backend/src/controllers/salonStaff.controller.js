/*
 * Salon team: the people who perform services, what they can do, their hours and their attendance.
 *
 * Distinct from FlowXP logins (business_users): most stylists never sign in. A staff member may be linked
 * to a login (user_id), which is how a STYLIST sees their own appointments. Commission rates are visible
 * only to people with 'staff_commission'.
 */
import pool from '../config/database.js';
import { branchFilter } from '../utils/scope.js';
import { businessToday } from '../utils/dates.js';
import { canSeeCommission, ownStaffId } from '../modules/salon/access.js';
import {
  SalonError, audit, bool, clock, diff, isoDate, int, like, num, ok, oneOf, page, paging, phone, text, timestamp, wrapAll
} from '../modules/salon/common.js';
import { checkEmail } from '../utils/validate.js';

const STAFF_ROLES = ['HAIR_STYLIST', 'BARBER', 'BEAUTICIAN', 'MAKEUP_ARTIST', 'THERAPIST', 'RECEPTIONIST', 'MANAGER', 'OTHER'];
const ATTENDANCE = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY'];

/* { "1": { start, end } | null, ... } by ISO weekday. null = a day off for this person. */
export const cleanWorkingHours = (value) => {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new SalonError(400, 'Working hours must be set per weekday');
  const out = {};
  for (const [day, w] of Object.entries(value)) {
    if (!/^[1-7]$/.test(day)) throw new SalonError(400, 'Working hours use weekdays 1 (Monday) to 7 (Sunday)');
    if (w === null) { out[day] = null; continue; }
    const start = clock(w?.start, 'Start time', { required: true });
    const end = clock(w?.end, 'End time', { required: true });
    if (start >= end) throw new SalonError(400, 'A shift must end after it starts');
    out[day] = { start, end };
  }
  return out;
};

const asStaff = (r, withCommission) => ({
  staff_id: r.staff_id, branch_id: r.branch_id, branch_name: r.branch_name, user_id: r.user_id,
  name: r.name, phone: r.phone, email: r.email, staff_role: r.staff_role, skills: r.skills || [],
  working_hours: r.working_hours, is_bookable: r.is_bookable, status: r.status, joined_on: r.joined_on,
  services: r.service_count == null ? undefined : Number(r.service_count),
  ...(withCommission ? {
    commission_type: r.commission_type, commission_value: Number(r.commission_value), product_commission_pct: Number(r.product_commission_pct)
  } : {})
});

const SELECT = `
  SELECT s.*, b.name AS branch_name, (SELECT COUNT(*) FROM salon_staff_services ss WHERE ss.staff_id = s.staff_id) AS service_count
  FROM salon_staff s JOIN branches b ON b.branch_id = s.branch_id`;

/* GET /api/salon/staff?status=&bookable=1&q=&limit=&offset= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 100 });
  const values = [req.tenant.businessId];
  let where = 's.business_id = $1';
  where += branchFilter(req.tenant, 's.branch_id', values);
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'); where += ` AND s.status = $${values.length}`; }
  if (req.query.bookable === '1' || req.query.bookable === 'true') where += ` AND s.is_bookable`;
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where += ` AND s.name ILIKE $${values.length}`; }
  const own = await ownStaffId(pool, req.tenant, req.auth.userId);
  if (own != null) { values.push(own); where += ` AND s.staff_id = $${values.length}`; }
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_staff s WHERE ${where}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(`${SELECT} WHERE ${where} ORDER BY s.status, s.name LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => asStaff(r, canSeeCommission(req.tenant))), total, pg);
};

const loadOne = async (req, id) => {
  const values = [req.tenant.businessId, id];
  const row = (await pool.query(`${SELECT} WHERE s.business_id = $1 AND s.staff_id = $2${branchFilter(req.tenant, 's.branch_id', values)}`, values)).rows[0];
  if (!row) return null;
  const own = await ownStaffId(pool, req.tenant, req.auth.userId);
  if (own != null && own !== row.staff_id) return null;
  const services = (await pool.query(
    `SELECT ss.product_id AS service_id, p.name, ss.commission_type, ss.commission_value FROM salon_staff_services ss JOIN products p ON p.product_id = ss.product_id
     WHERE ss.staff_id = $1 ORDER BY p.name`, [id])).rows;
  const see = canSeeCommission(req.tenant);
  return {
    ...asStaff(row, see),
    services: services.map((s) => ({ service_id: s.service_id, name: s.name, ...(see ? { commission_type: s.commission_type, commission_value: s.commission_value == null ? null : Number(s.commission_value) } : {}) }))
  };
};

/* GET /api/salon/staff/:id */
const get = async (req, res) => {
  const s = await loadOne(req, req.params.id);
  if (!s) throw new SalonError(404, 'Not found');
  ok(res, s);
};

const checkBranch = async (req, branchId) => {
  const id = branchId == null ? req.tenant.branchId : branchId;
  const b = (await pool.query(`SELECT branch_id FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [id, req.tenant.businessId])).rows[0];
  if (!b) throw new SalonError(400, 'Choose one of your active outlets');
  if (req.tenant.pinned && id !== req.tenant.branchId) throw new SalonError(403, 'You can only add people to your own outlet');
  return id;
};

const checkUser = async (req, userId, exceptStaffId = null) => {
  if (userId == null) return null;
  const member = (await pool.query(`SELECT 1 FROM business_users WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, userId])).rows.length;
  if (!member) throw new SalonError(400, 'That login is not part of this business');
  const taken = (await pool.query(`SELECT 1 FROM salon_staff WHERE business_id = $1 AND user_id = $2 AND ($3::int IS NULL OR staff_id <> $3)`, [req.tenant.businessId, userId, exceptStaffId])).rows.length;
  if (taken) throw new SalonError(409, 'That login is already linked to another team member');
  return userId;
};

const fields = async (req, body, { partial, existing = null }) => {
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Name', { max: 120, min: 2, required: true });
  if ('phone' in body) f.phone = phone(body.phone);
  if ('email' in body) {
    const e = text(body.email, 'Email', { max: 160 });
    if (e && checkEmail(e)) throw new SalonError(400, 'Enter a valid email address');
    f.email = e ? e.toLowerCase() : null;
  }
  if ('staff_role' in body) f.staff_role = oneOf(body.staff_role, 'Role', STAFF_ROLES, { required: true });
  if ('skills' in body) {
    if (!Array.isArray(body.skills) || body.skills.length > 30) throw new SalonError(400, 'Skills must be a short list');
    f.skills = JSON.stringify(body.skills.map((s) => text(s, 'Skill', { max: 40, required: true })));
  }
  if ('commission_type' in body) f.commission_type = oneOf(body.commission_type, 'Commission type', ['PERCENT', 'FIXED'], { required: true });
  if ('commission_value' in body) {
    const type = f.commission_type || existing?.commission_type || 'PERCENT';
    f.commission_value = num(body.commission_value, 'Commission', { min: 0, max: type === 'PERCENT' ? 100 : 1000000, required: true });
  }
  if ('product_commission_pct' in body) f.product_commission_pct = num(body.product_commission_pct, 'Product commission', { min: 0, max: 100, required: true });
  if ('working_hours' in body) f.working_hours = body.working_hours === null ? null : JSON.stringify(cleanWorkingHours(body.working_hours));
  if ('is_bookable' in body) f.is_bookable = bool(body.is_bookable);
  if ('joined_on' in body) f.joined_on = isoDate(body.joined_on, 'Joining date');
  if ('user_id' in body) f.user_id = await checkUser(req, int(body.user_id, 'Login'), existing?.staff_id ?? null);
  return f;
};

const writeServices = async (db, businessId, staffId, list, see) => {
  if (list == null) return;
  if (!Array.isArray(list)) throw new SalonError(400, 'Services must be a list');
  const ids = list.map((s) => Number(s.service_id ?? s));
  if (new Set(ids).size !== ids.length) throw new SalonError(400, 'A service is listed twice');
  if (ids.length) {
    const n = Number((await db.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1 AND kind = 'SERVICE' AND product_id = ANY($2::int[])`, [businessId, ids])).rows[0].n);
    if (n !== ids.length) throw new SalonError(400, 'Choose services from your own list');
  }
  const keep = new Map((await db.query(`SELECT product_id, commission_type, commission_value FROM salon_staff_services WHERE staff_id = $1`, [staffId])).rows.map((r) => [r.product_id, r]));
  await db.query(`DELETE FROM salon_staff_services WHERE staff_id = $1`, [staffId]);
  for (const [i, raw] of list.entries()) {
    let type = null; let value = null;
    if (see && typeof raw === 'object' && ('commission_type' in raw)) {
      type = raw.commission_type ? oneOf(raw.commission_type, 'Commission type', ['PERCENT', 'FIXED'], { required: true }) : null;
      value = type ? num(raw.commission_value, 'Commission', { min: 0, max: type === 'PERCENT' ? 100 : 1000000, required: true }) : null;
    } else if (keep.has(ids[i])) { type = keep.get(ids[i]).commission_type; value = keep.get(ids[i]).commission_value; }
    await db.query(`INSERT INTO salon_staff_services (staff_id, product_id, commission_type, commission_value) VALUES ($1,$2,$3,$4)`, [staffId, ids[i], type, value]);
  }
};

/* POST /api/salon/staff */
const create = async (req, res) => {
  const body = req.body || {};
  const f = await fields(req, body, { partial: false });
  const branchId = await checkBranch(req, body.branch_id == null ? null : int(body.branch_id, 'Outlet'));
  const cols = { ...f, branch_id: branchId, business_id: req.tenant.businessId };
  const keys = Object.keys(cols);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = (await client.query(`INSERT INTO salon_staff (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING staff_id`, keys.map((k) => cols[k]))).rows[0].staff_id;
    await writeServices(client, req.tenant.businessId, id, body.services ?? (Array.isArray(body.service_ids) ? body.service_ids : null), canSeeCommission(req.tenant));
    await client.query('COMMIT');
    audit(req, 'salon.staff_created', 'salon_staff', id, null, { name: f.name, branch_id: branchId, staff_role: f.staff_role });
    ok(res, await loadOne(req, id), 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* PUT /api/salon/staff/:id */
const update = async (req, res) => {
  const body = req.body || {};
  const before = await loadOne(req, req.params.id);
  if (!before) throw new SalonError(404, 'Not found');
  if ((('commission_type' in body) || ('commission_value' in body) || ('product_commission_pct' in body)) && !canSeeCommission(req.tenant)) throw new SalonError(403, 'You do not have access to change commission');
  const existing = (await pool.query(`SELECT staff_id, commission_type FROM salon_staff WHERE staff_id = $1`, [before.staff_id])).rows[0];
  const f = await fields(req, body, { partial: true, existing });
  if ('branch_id' in body) f.branch_id = await checkBranch(req, int(body.branch_id, 'Outlet', { required: true }));
  if ('status' in body) f.status = oneOf(body.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  const keys = Object.keys(f);
  if (!keys.length && body.services == null && body.service_ids == null) throw new SalonError(400, 'Nothing to update');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (keys.length) await client.query(`UPDATE salon_staff SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE staff_id = $1 AND business_id = $2`, [before.staff_id, req.tenant.businessId, ...keys.map((k) => f[k])]);
    await writeServices(client, req.tenant.businessId, before.staff_id, body.services ?? (Array.isArray(body.service_ids) ? body.service_ids : null), canSeeCommission(req.tenant));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const after = await loadOne(req, before.staff_id);
  const changes = diff(before, after);
  delete changes.services;
  if ('commission_type' in changes || 'commission_value' in changes || 'product_commission_pct' in changes) {
    audit(req, 'salon.commission_rate_changed', 'salon_staff', before.staff_id, { type: before.commission_type, value: before.commission_value, product_pct: before.product_commission_pct }, { type: after.commission_type, value: after.commission_value, product_pct: after.product_commission_pct }, { name: after.name });
  }
  audit(req, 'salon.staff_updated', 'salon_staff', before.staff_id, null, null, { changes: Object.fromEntries(Object.entries(changes).filter(([k]) => !k.includes('commission'))) });
  ok(res, after);
};

/* ── attendance ───────────────────────────────────────────────────────────────────────────── */

/* GET /api/salon/attendance?date= — everyone at the outlet with that day's status (none recorded = null) */
const attendance = async (req, res) => {
  const date = isoDate(req.query.date, 'Date') || await businessToday(req.tenant.businessId);
  const values = [req.tenant.businessId, date];
  const scope = branchFilter(req.tenant, 's.branch_id', values);
  const { rows } = await pool.query(
    `SELECT s.staff_id, s.name, s.staff_role, s.branch_id, a.status, a.check_in, a.check_out, a.note
     FROM salon_staff s LEFT JOIN salon_attendance a ON a.staff_id = s.staff_id AND a.work_date = $2::date
     WHERE s.business_id = $1 AND s.status = 'ACTIVE'${scope} ORDER BY s.name`, values);
  ok(res, { date, staff: rows });
};

/* PUT /api/salon/attendance { staff_id, work_date, status, check_in?, check_out?, note? } */
const markAttendance = async (req, res) => {
  const b = req.body || {};
  const staffId = int(b.staff_id, 'Staff', { min: 1, required: true });
  const values = [req.tenant.businessId, staffId];
  const staff = (await pool.query(`SELECT staff_id, branch_id, name FROM salon_staff s WHERE s.business_id = $1 AND s.staff_id = $2${branchFilter(req.tenant, 's.branch_id', values)}`, values)).rows[0];
  if (!staff) throw new SalonError(404, 'Not found');
  const date = isoDate(b.work_date, 'Date') || await businessToday(req.tenant.businessId);
  const status = oneOf(b.status, 'Attendance', ATTENDANCE, { required: true });
  const checkIn = timestamp(b.check_in, 'Check-in');
  const checkOut = timestamp(b.check_out, 'Check-out');
  if (checkIn && checkOut && checkOut <= checkIn) throw new SalonError(400, 'Check-out must be after check-in');
  const note = text(b.note, 'Note', { max: 200 });
  const before = (await pool.query(`SELECT status FROM salon_attendance WHERE staff_id = $1 AND work_date = $2`, [staffId, date])).rows[0];
  const row = (await pool.query(
    `INSERT INTO salon_attendance (business_id, branch_id, staff_id, work_date, status, check_in, check_out, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (staff_id, work_date) DO UPDATE SET status = EXCLUDED.status, check_in = COALESCE(EXCLUDED.check_in, salon_attendance.check_in),
       check_out = COALESCE(EXCLUDED.check_out, salon_attendance.check_out), note = EXCLUDED.note
     RETURNING attendance_id, staff_id, work_date, status, check_in, check_out, note`,
    [req.tenant.businessId, staff.branch_id, staffId, date, status, checkIn, checkOut, note, req.auth.userId]
  )).rows[0];
  audit(req, 'salon.attendance_marked', 'salon_staff', staffId, before, { status, work_date: date }, { name: staff.name });
  ok(res, row);
};

/* GET /api/salon/attendance/summary?from=&to= — days present / absent / on leave per person */
const attendanceSummary = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || `${today.slice(0, 8)}01`;
  const to = isoDate(req.query.to, 'To') || today;
  const values = [req.tenant.businessId, from, to];
  const scope = branchFilter(req.tenant, 's.branch_id', values);
  const { rows } = await pool.query(
    `SELECT s.staff_id, s.name,
            COUNT(a.*) FILTER (WHERE a.status = 'PRESENT')::int AS present,
            COUNT(a.*) FILTER (WHERE a.status = 'HALF_DAY')::int AS half_days,
            COUNT(a.*) FILTER (WHERE a.status = 'ABSENT')::int AS absent,
            COUNT(a.*) FILTER (WHERE a.status = 'LEAVE')::int AS leave
     FROM salon_staff s LEFT JOIN salon_attendance a ON a.staff_id = s.staff_id AND a.work_date BETWEEN $2::date AND $3::date
     WHERE s.business_id = $1 AND s.status = 'ACTIVE'${scope} GROUP BY s.staff_id, s.name ORDER BY s.name`, values);
  ok(res, { from, to, staff: rows });
};

export default wrapAll({ list, get, create, update, attendance, markAttendance, attendanceSummary });
