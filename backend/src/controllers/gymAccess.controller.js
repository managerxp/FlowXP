/*
 * Gym access and attendance for the front desk: scan a card or a phone pass, check a member in by lookup, read the access history and the
 * attendance log, and correct a visit. Every decision is the shared engine's (modules/gym/access.js); this file only carries the request in and
 * the answer out. Permissions are decided in the router.
 */
import pool from '../config/database.js';
import { attempt, REASON } from '../modules/gym/access.js';
import { visibleTo } from '../modules/gym/members.js';
import { GymError, audit, inTx, isoDate, localParts, ok, page, paging, wrapAll } from '../modules/gym/common.js';
import { branchFilter } from '../utils/scope.js';
import { todaysCode } from '../modules/gym/portal.js';

const answer = (res, result) => {
  if (result.unavailable) return res.status(503).json({ success: false, message: result.message, code: REASON.SERVICE_UNAVAILABLE, data: result });
  return res.json({ success: true, data: result });
};

/** Scan a card or phone pass at this outlet's desk. A refusal is a normal answer (200 with decision DENIED), not an error. */
const scan = async (req, res) => {
  const b = req.body || {};
  if (!b.code || typeof b.code !== 'string' || b.code.length > 100) throw new GymError(400, 'Scan a card or a phone pass');
  const result = await attempt({
    businessId: req.tenant.businessId, branchId: req.tenant.branchId, source: 'RECEPTION', action: b.action === 'OUT' ? 'OUT' : 'IN',
    code: b.code, confirm: b.confirm === true, actorUserId: req.auth.userId, idempotencyKey: b.idempotency_key
  });
  answer(res, result);
};

/** Check a member in by looking them up (no card, no phone). The desk is saying it has seen who this is, so `confirm` is required. */
const manual = async (req, res) => {
  const b = req.body || {};
  const memberId = Number(b.member_id);
  if (!Number.isInteger(memberId)) throw new GymError(400, 'Choose a member');
  const params = [req.tenant.businessId, memberId];
  const found = (await pool.query(`SELECT 1 FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(req.tenant, params)}`, params)).rows.length;
  if (!found) throw new GymError(404, 'Not found');
  const result = await attempt({
    businessId: req.tenant.businessId, branchId: req.tenant.branchId, source: 'RECEPTION', action: b.action === 'OUT' ? 'OUT' : 'IN',
    memberId, confirm: b.confirm === true, actorUserId: req.auth.userId, idempotencyKey: b.idempotency_key
  });
  answer(res, result);
};

const events = async (req, res) => {
  const { limit, offset } = paging(req.query, { max: 200, fallback: 50 });
  const params = [req.tenant.businessId];
  let where = `e.business_id = $1${branchFilter(req.tenant, 'e.branch_id', params)}`;
  const add = (sql, v) => { params.push(v); where += ` AND ${sql.replace('?', `$${params.length}`)}`; };
  if (req.query.decision) add('e.decision = ?', String(req.query.decision).toUpperCase());
  if (req.query.reason) add('e.reason_code = ?', String(req.query.reason).toUpperCase());
  if (req.query.source) add('e.source = ?', String(req.query.source).toUpperCase());
  if (req.query.member_id) add('e.member_id = ?', Number(req.query.member_id));
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  const tz = (await pool.query(`SELECT COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0].tz;
  if (from) { params.push(tz, from); where += ` AND (e.occurred_at AT TIME ZONE $${params.length - 1}::text)::date >= $${params.length}::date`; }
  if (to) { params.push(tz, to); where += ` AND (e.occurred_at AT TIME ZONE $${params.length - 1}::text)::date <= $${params.length}::date`; }
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_access_events e WHERE ${where}`, params)).rows[0].n;
  params.push(limit, offset);
  const rows = (await pool.query(
    `SELECT e.event_id, e.occurred_at, e.source, e.action, e.decision, e.reason_code, e.detail, e.branch_id, e.device_id, e.member_id, gm.member_code, c.name AS member_name, u.name AS actor
     FROM gym_access_events e LEFT JOIN gym_members gm ON gm.member_id = e.member_id LEFT JOIN customers c ON c.customer_id = gm.customer_id LEFT JOIN users u ON u.user_id = e.actor_user_id
     WHERE ${where} ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  page(res, rows, total, { limit, offset });
};

const attendance = async (req, res) => {
  const { limit, offset } = paging(req.query, { max: 200, fallback: 50 });
  const { date: today } = await localParts(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || today; const to = isoDate(req.query.to, 'To') || today;
  const params = [req.tenant.businessId, from, to];
  let where = `a.business_id = $1 AND a.local_date BETWEEN $2::date AND $3::date${branchFilter(req.tenant, 'a.branch_id', params)}`;
  if (req.query.member_id) { params.push(Number(req.query.member_id)); where += ` AND a.member_id = $${params.length}`; }
  if (req.query.open === 'true') where += ` AND a.check_out_at IS NULL`;
  if (req.query.include_voided !== 'true') where += ` AND a.status <> 'VOIDED'`;
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance a WHERE ${where}`, params)).rows[0].n;
  params.push(limit, offset);
  const rows = (await pool.query(
    `SELECT a.attendance_id, a.member_id, gm.member_code, c.name AS member_name, a.branch_id, a.check_in_at, a.check_out_at, a.local_date::text AS local_date, a.source, a.status, a.void_reason, ms.plan_name
     FROM gym_attendance a JOIN gym_members gm ON gm.member_id = a.member_id JOIN customers c ON c.customer_id = gm.customer_id LEFT JOIN gym_memberships ms ON ms.membership_id = a.membership_id
     WHERE ${where} ORDER BY a.check_in_at DESC, a.attendance_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  page(res, rows, total, { limit, offset });
};

/** Add a visit that was missed, with a reason. The access log records it as a correction, not as a scan. */
const addVisit = async (req, res) => {
  const b = req.body || {};
  const memberId = Number(b.member_id);
  if (!Number.isInteger(memberId)) throw new GymError(400, 'Choose a member');
  const reason = String(b.reason || '').trim().slice(0, 200);
  if (!reason) throw new GymError(400, 'Say why the visit is being added');
  const at = b.check_in_at ? new Date(b.check_in_at) : new Date();
  if (Number.isNaN(at.getTime()) || at > new Date(Date.now() + 60000)) throw new GymError(400, 'The check-in time is not valid');
  const params = [req.tenant.businessId, memberId];
  if (!(await pool.query(`SELECT 1 FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(req.tenant, params)}`, params)).rows.length) throw new GymError(404, 'Not found');
  const row = await inTx(async (db) => {
    const { date } = await localParts(db, req.tenant.businessId, at);
    const ev = (await db.query(
      `INSERT INTO gym_access_events (business_id, branch_id, member_id, source, action, decision, reason_code, detail, actor_user_id, occurred_at)
       VALUES ($1,$2,$3,'RECEPTION','IN','APPROVED','APPROVED',$4,$5,$6) RETURNING event_id`,
      [req.tenant.businessId, req.tenant.branchId, memberId, JSON.stringify({ correction: true, reason }), req.auth.userId, at])).rows[0];
    const a = (await db.query(
      `INSERT INTO gym_attendance (business_id, branch_id, member_id, check_in_at, local_date, source, status, access_event_id, corrected_by) VALUES ($1,$2,$3,$4,$5,'RECEPTION','CONFIRMED',$6,$7) RETURNING attendance_id`,
      [req.tenant.businessId, req.tenant.branchId, memberId, at, date, ev.event_id, req.auth.userId])).rows[0];
    await db.query(`UPDATE gym_access_events SET attendance_id = $2 WHERE event_id = $1`, [ev.event_id, a.attendance_id]);
    return a;
  });
  audit(req, 'gym.attendance_added', 'gym_attendance', row.attendance_id, null, { member_id: memberId, reason });
  ok(res, row, 201);
};

/** Void a visit (a mistaken scan) or set when somebody left. The row stays, with who changed it and why. */
const correct = async (req, res) => {
  const attendanceId = Number(req.params.id);
  const b = req.body || {};
  const reason = String(b.reason || '').trim().slice(0, 200);
  if (!reason) throw new GymError(400, 'Say why the visit is being changed');
  const params = [req.tenant.businessId, attendanceId];
  const cur = (await pool.query(`SELECT a.* FROM gym_attendance a WHERE a.business_id = $1 AND a.attendance_id = $2${branchFilter(req.tenant, 'a.branch_id', params)}`, params)).rows[0];
  if (!cur) throw new GymError(404, 'Not found');
  if (b.void === true) {
    if (cur.status === 'VOIDED') throw new GymError(409, 'That visit is already voided');
    await pool.query(`UPDATE gym_attendance SET status = 'VOIDED', void_reason = $2, corrected_by = $3 WHERE attendance_id = $1`, [attendanceId, reason, req.auth.userId]);
    audit(req, 'gym.attendance_voided', 'gym_attendance', attendanceId, { status: cur.status }, { status: 'VOIDED', reason });
  } else if (b.check_out_at) {
    const out = new Date(b.check_out_at);
    if (Number.isNaN(out.getTime()) || out < new Date(cur.check_in_at) || out > new Date(Date.now() + 60000)) throw new GymError(400, 'The check-out time is not valid');
    await pool.query(`UPDATE gym_attendance SET check_out_at = $2, corrected_by = $3 WHERE attendance_id = $1`, [attendanceId, out, req.auth.userId]);
    audit(req, 'gym.attendance_corrected', 'gym_attendance', attendanceId, { check_out_at: cur.check_out_at }, { check_out_at: out, reason });
  } else throw new GymError(400, 'Nothing to change');
  ok(res, (await pool.query(`SELECT attendance_id, status, check_out_at, void_reason FROM gym_attendance WHERE attendance_id = $1`, [attendanceId])).rows[0]);
};

/** Today's four-digit code for this outlet, to read out or show to members who check in from their own phone. It changes at the gym's midnight. */
const dailyCode = async (req, res) => {
  const { date } = await localParts(pool, req.tenant.businessId);
  res.set('Cache-Control', 'no-store');
  ok(res, { date, code: await todaysCode(req.tenant.businessId, req.tenant.branchId) });
};

export default wrapAll({ scan, manual, events, attendance, addVisit, correct, dailyCode });
