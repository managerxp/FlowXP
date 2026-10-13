/*
 * Members. A member is a `customers` row (so billing, receipts and messaging work on them as on any customer) plus a `gym_members` row with the
 * gym's own details: a member code, a status, an emergency contact, consent, and a restricted health note.
 *
 * VISIBILITY. A person pinned to one outlet sees the members who belong to it: those whose home outlet it is, those with no home outlet, and
 * those whose memberships are valid at it. They cannot read, change or sell to a member of another outlet by guessing an id (404, the same as a
 * member that does not exist). Owners and group users see the whole gym.
 *
 * PRIVACY. `health_notes` is only returned to, and only written by, people with the gym_trainer or gym_setup permission. A desk screen never
 * carries it. Phone, email and emergency contact are shown to the desk because they need them; exports need the export permission.
 */
import { hasPermission } from '../../middleware/auth.js';
import { GymError, MEMBER_STATUSES, SQL_PHONE_KEY, bool, isoDate, like, localParts, oneOf, paging, phone as cleanPhone, phoneKey, text, withRupees } from './common.js';
import { revokeAll, listCredentials } from './credentials.js';
import { endMemberSessions } from './portal.js';
import { viewsFor } from './memberships.js';

const bad = (message) => new GymError(400, message);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** SQL that limits a member list to what the viewer's outlet may see. Pushes its own parameter. */
/**
 * A person whose only gym permission is the trainer one (a trainer's own login): they see the members assigned to them, and not those members' phone or email.
 * Anyone who can run the desk, register members or manage the gym is not a trainer in this sense, even if they also have the trainer permission.
 */
export const trainerOnly = (tenant) => hasPermission(tenant, 'gym_trainer') && !hasPermission(tenant, 'gym_desk') && !hasPermission(tenant, 'gym_members') && !hasPermission(tenant, 'gym_setup');

export const visibleTo = (tenant, params, alias = 'gm') => {
  let sql = '';
  const id = tenant?.scopeBranchId;
  if (id != null) {
    params.push(id);
    const n = params.length;
    sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id = $${n} OR EXISTS (
      SELECT 1 FROM gym_memberships v WHERE v.member_id = ${alias}.member_id AND v.status = 'ACTIVE' AND (v.allowed_branch_ids IS NULL OR $${n} = ANY(v.allowed_branch_ids))))`;
  }
  if (trainerOnly(tenant)) {
    params.push(tenant.userId ?? 0);
    sql += ` AND ${alias}.assigned_trainer_id IN (SELECT t.trainer_id FROM gym_trainers t WHERE t.business_id = ${alias}.business_id AND t.user_id = $${params.length})`;
  }
  return sql;
};

export const canSeeHealth = (hasPermission, tenant) => hasPermission(tenant, 'gym_trainer') || hasPermission(tenant, 'gym_setup');

const nextCode = async (db, businessId) => {
  await db.query(`INSERT INTO gym_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  const r = (await db.query(`UPDATE gym_settings SET next_member_no = next_member_no + 1 WHERE business_id = $1 RETURNING member_prefix, next_member_no - 1 AS n`, [businessId])).rows[0];
  return `${r.member_prefix}-${String(r.n).padStart(5, '0')}`;
};

/** Other live members who share this phone number. */
export const findByPhone = async (db, businessId, phone, { excludeMemberId = null } = {}) => {
  const key = phoneKey(phone);
  if (key.length < 7) return [];
  return (await db.query(
    `SELECT gm.member_id, gm.member_code, c.name FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
     WHERE gm.business_id = $1 AND gm.status <> 'ARCHIVED' AND ${SQL_PHONE_KEY('c.phone')} = $2 AND ($3::int IS NULL OR gm.member_id <> $3)`, [businessId, key, excludeMemberId])).rows;
};

const cleanFields = (b, { creating }) => {
  const has = (k) => b[k] !== undefined;
  const out = {};
  if (creating || has('name')) out.name = text(b.name, 'Name', { max: 160, required: true });
  if (creating || has('phone')) out.phone = cleanPhone(b.phone);
  if (has('email')) { out.email = text(b.email, 'Email', { max: 160 }); if (out.email && !EMAIL.test(out.email)) throw bad('Enter a valid email address'); }
  if (has('dob')) { out.dob = isoDate(b.dob, 'Date of birth'); if (out.dob && out.dob > new Date().toISOString().slice(0, 10)) throw bad('The date of birth cannot be in the future'); }
  if (has('gender')) out.gender = oneOf(b.gender, 'Gender', ['FEMALE', 'MALE', 'OTHER']);
  if (has('emergency_name')) out.emergency_name = text(b.emergency_name, 'Emergency contact', { max: 120 });
  if (has('emergency_phone')) out.emergency_phone = cleanPhone(b.emergency_phone, 'Emergency phone');
  if (has('company')) out.company = text(b.company, 'Company', { max: 120 });
  if (has('photo_url')) out.photo_url = text(b.photo_url, 'Photo', { max: 500 });
  if (has('consent_marketing')) out.consent_marketing = bool(b.consent_marketing);
  if (has('health_notes')) out.health_notes = text(b.health_notes, 'Health notes', { max: 2000 });
  if (has('joined_on')) out.joined_on = isoDate(b.joined_on, 'Joined on');
  return out;
};

/**
 * Register a member. Call inside a transaction.
 * A second member on the same phone number is refused (DUPLICATE_MEMBER) unless they are a dependent of someone, or the desk confirms it is a
 * different person (a couple sharing a phone). An existing customer with that number (billed before, never a member) is reused, not duplicated.
 */
export const registerMember = async (db, tenant, userId, input, { allowHealth = false } = {}) => {
  const f = cleanFields(input || {}, { creating: true });
  if (!allowHealth) delete f.health_notes;
  let head = null;
  if (input.head_member_id) {
    head = (await db.query(`SELECT member_id FROM gym_members WHERE member_id = $1 AND business_id = $2 AND status <> 'ARCHIVED'`, [Number(input.head_member_id), tenant.businessId])).rows[0];
    if (!head) throw bad('The member who pays for this person was not found');
  }
  if (!f.phone && !head) throw bad('A phone number is required: members sign in with it');
  if (f.phone && !head && input.confirm_duplicate !== true) {
    const same = await findByPhone(db, tenant.businessId, f.phone);
    if (same.length) throw new GymError(409, 'A member with this phone number already exists', { code: 'DUPLICATE_MEMBER', data: { members: same } });
  }
  if (input.branch_id != null && input.branch_id !== '') {
    const ok = (await db.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2`, [Number(input.branch_id), tenant.businessId])).rows.length;
    if (!ok) throw bad('That branch is not part of this gym');
  }

  let customerId = null;
  if (f.phone) {
    const existing = (await db.query(
      `SELECT c.customer_id FROM customers c WHERE c.business_id = $1 AND c.status = 'ACTIVE' AND ${SQL_PHONE_KEY('c.phone')} = $2
         AND NOT EXISTS (SELECT 1 FROM gym_members g WHERE g.customer_id = c.customer_id) ORDER BY c.customer_id LIMIT 1`, [tenant.businessId, phoneKey(f.phone)])).rows[0];
    if (existing) {
      customerId = existing.customer_id;
      await db.query(`UPDATE customers SET email = COALESCE(email, $2) WHERE customer_id = $1`, [customerId, f.email ?? null]);
    }
  }
  if (!customerId) {
    customerId = (await db.query(`INSERT INTO customers (business_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING customer_id`, [tenant.businessId, f.name, f.phone ?? null, f.email ?? null])).rows[0].customer_id;
  }

  let referrer = null;
  if (input.referred_by != null && input.referred_by !== '') {
    const ref = String(input.referred_by).trim();
    referrer = (await db.query(`SELECT member_id FROM gym_members WHERE business_id = $1 AND status <> 'ARCHIVED' AND (member_code = $2 OR member_id::text = $2)`, [tenant.businessId, ref])).rows[0];
    if (!referrer) throw bad('The member who referred them was not found');
  }
  const code = await nextCode(db, tenant.businessId);
  const m = (await db.query(
    `INSERT INTO gym_members (business_id, customer_id, branch_id, member_code, joined_on, dob, gender, emergency_name, emergency_phone, photo_url, company, head_member_id,
       consent_marketing, consent_data_at, health_notes, created_by, referred_by)
     VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING member_id, member_code`,
    [tenant.businessId, customerId, input.branch_id ? Number(input.branch_id) : tenant.branchId, code, f.joined_on ?? null, f.dob ?? null, f.gender ?? null, f.emergency_name ?? null, f.emergency_phone ?? null,
     f.photo_url ?? null, f.company ?? null, head?.member_id ?? null, f.consent_marketing ?? false, bool(input.consent_data) ? new Date() : null, f.health_notes ?? null, userId, referrer?.member_id ?? null])).rows[0];
  if (f.consent_marketing === false) await db.query(`UPDATE customers SET marketing_opt_out = TRUE WHERE customer_id = $1`, [customerId]);
  return { member_id: m.member_id, member_code: m.member_code, customer_id: customerId };
};

/** Change a member's details. Call inside a transaction. Returns the before and after of what changed, for the audit trail. */
export const updateMember = async (db, tenant, memberId, input, { allowHealth = false } = {}) => {
  const cur = (await db.query(
    `SELECT gm.*, c.name, c.phone, c.email FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.member_id = $1 AND gm.business_id = $2 FOR UPDATE OF gm`, [memberId, tenant.businessId])).rows[0];
  if (!cur) throw new GymError(404, 'Not found');
  const f = cleanFields(input || {}, { creating: false });
  if (!allowHealth) delete f.health_notes;
  if (f.phone && phoneKey(f.phone) !== phoneKey(cur.phone) && !cur.head_member_id && input.confirm_duplicate !== true) {
    const same = await findByPhone(db, tenant.businessId, f.phone, { excludeMemberId: memberId });
    if (same.length) throw new GymError(409, 'A member with this phone number already exists', { code: 'DUPLICATE_MEMBER', data: { members: same } });
  }
  const cust = {}; const gym = {};
  for (const k of ['name', 'phone', 'email']) if (k in f) cust[k] = f[k];
  for (const k of ['dob', 'gender', 'emergency_name', 'emergency_phone', 'company', 'photo_url', 'consent_marketing', 'health_notes', 'joined_on']) if (k in f) gym[k] = f[k];
  if ('consent_marketing' in f) await db.query(`UPDATE customers SET marketing_opt_out = $2 WHERE customer_id = $1`, [cur.customer_id, !f.consent_marketing]);
  if (bool(input.consent_data) && !cur.consent_data_at) gym.consent_data_at = new Date();
  const set = (table, id, col, obj) => {
    const keys = Object.keys(obj);
    return keys.length ? db.query(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE ${col} = $1`, [id, ...keys.map((k) => obj[k])]) : null;
  };
  await set('customers', cur.customer_id, 'customer_id', cust);
  await set('gym_members', memberId, 'member_id', gym);
  const changed = {};
  for (const [k, v] of Object.entries({ ...cust, ...gym })) if (k !== 'health_notes' && String(cur[k] ?? '') !== String(v ?? '')) changed[k] = { from: cur[k] ?? null, to: v ?? null };
  if ('health_notes' in gym) changed.health_notes = { changed: true };
  return changed;
};

/** Active, inactive, suspended or archived. Archiving also stops every credential. */
export const setStatus = async (db, tenant, userId, memberId, { status, reason }) => {
  const next = oneOf(status, 'Status', MEMBER_STATUSES, { required: true });
  const cur = (await db.query(`SELECT status FROM gym_members WHERE member_id = $1 AND business_id = $2 FOR UPDATE`, [memberId, tenant.businessId])).rows[0];
  if (!cur) throw new GymError(404, 'Not found');
  if (cur.status === 'ARCHIVED' && next !== 'ARCHIVED') throw new GymError(409, 'An archived member cannot be brought back. Register them again');
  await db.query(`UPDATE gym_members SET status = $2, status_reason = $3 WHERE member_id = $1`, [memberId, next, reason ? String(reason).slice(0, 200) : null]);
  if (next === 'ARCHIVED') { await revokeAll(db, { businessId: tenant.businessId, memberId, userId, reason: 'Member archived' }); await endMemberSessions(db, tenant.businessId, memberId); }
  return { from: cur.status, to: next };
};

/**
 * Merge a duplicate into the member to keep. Memberships, visits and access history move across; the duplicate's cards stop working and it is
 * archived with a pointer to the member it was merged into. Its customer record stays (old invoices still name it).
 */
export const mergeMembers = async (db, tenant, userId, sourceId, targetId) => {
  if (Number(sourceId) === Number(targetId)) throw bad('Choose two different members');
  const ids = [Number(sourceId), Number(targetId)].sort((a, b) => a - b);
  const rows = (await db.query(`SELECT member_id, status FROM gym_members WHERE business_id = $1 AND member_id = ANY($2::int[]) ORDER BY member_id FOR UPDATE`, [tenant.businessId, ids])).rows;
  if (rows.length !== 2) throw new GymError(404, 'Not found');
  if (rows.some((r) => r.status === 'ARCHIVED')) throw new GymError(409, 'An archived member cannot be merged');
  for (const t of ['gym_memberships', 'gym_attendance', 'gym_access_events']) {
    await db.query(`UPDATE ${t} SET member_id = $2 WHERE member_id = $1 AND business_id = $3`, [Number(sourceId), Number(targetId), tenant.businessId]);
  }
  await db.query(`UPDATE gym_members SET head_member_id = $2 WHERE head_member_id = $1 AND business_id = $3 AND member_id <> $2`, [Number(sourceId), Number(targetId), tenant.businessId]);
  await revokeAll(db, { businessId: tenant.businessId, memberId: Number(sourceId), userId, reason: 'Merged into another member' });
  await db.query(`UPDATE gym_members SET status = 'ARCHIVED', status_reason = 'Merged', merged_into = $2 WHERE member_id = $1`, [Number(sourceId), Number(targetId)]);
  return { kept: Number(targetId), merged: Number(sourceId) };
};

/* ── reading ────────────────────────────────────────────────────────────────────────────────── */

const SORTS = { name: 'LOWER(t.name) ASC', joined: 't.joined_on DESC, t.member_id DESC', expiry: 't.expires_on ASC NULLS LAST', last_visit: 't.last_visit DESC NULLS LAST', code: 't.member_code ASC' };

/**
 * The member list: search, filter, sort, page. `state` is one of NONE, UPCOMING, ACTIVE, EXPIRING (ends within 7 days), FROZEN, EXPIRED.
 */
export const listMembers = async (db, tenant, query) => {
  const { limit, offset } = paging(query, { max: 200, fallback: 25 });
  const { date: today } = await localParts(db, tenant.businessId);
  const params = [tenant.businessId, today];
  let inner = `
    SELECT gm.member_id, gm.member_code, gm.status, gm.photo_url, gm.joined_on::text AS joined_on, gm.branch_id, gm.head_member_id, gm.company, c.name, c.phone, c.email,
           cur.membership_id, cur.plan_id, cur.plan_name, cur.end_date::text AS expires_on,
           CASE WHEN cur.membership_id IS NULL THEN 'NONE'
                WHEN cur.start_date > $2::date THEN 'UPCOMING'
                WHEN EXISTS (SELECT 1 FROM gym_freezes f WHERE f.membership_id = cur.membership_id AND $2::date BETWEEN f.from_date AND f.to_date) THEN 'FROZEN'
                WHEN cur.end_date < $2::date THEN 'EXPIRED'
                WHEN cur.end_date - $2::date <= 7 THEN 'EXPIRING'
                ELSE 'ACTIVE' END AS state,
           lv.last_visit
    FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id
    LEFT JOIN LATERAL (SELECT ms.* FROM gym_memberships ms WHERE ms.member_id = gm.member_id AND ms.status = 'ACTIVE' AND ms.kind = 'MEMBERSHIP'
                       ORDER BY (ms.end_date >= $2::date) DESC, CASE WHEN ms.end_date >= $2::date THEN ms.start_date END ASC, ms.end_date DESC LIMIT 1) cur ON TRUE
    LEFT JOIN LATERAL (SELECT MAX(a.check_in_at) AS last_visit FROM gym_attendance a WHERE a.member_id = gm.member_id AND a.status <> 'VOIDED') lv ON TRUE
    WHERE gm.business_id = $1`;
  inner += visibleTo(tenant, params);
  const status = query.status ? String(query.status).toUpperCase() : null;
  if (status && MEMBER_STATUSES.includes(status)) { params.push(status); inner += ` AND gm.status = $${params.length}`; }
  else if (!status || status === 'LIVE') inner += ` AND gm.status <> 'ARCHIVED'`;
  if (query.q && String(query.q).trim()) {
    params.push(like(String(query.q).trim().slice(0, 80)));
    const n = params.length;
    inner += ` AND (c.name ILIKE $${n} OR c.phone ILIKE $${n} OR c.email ILIKE $${n} OR gm.member_code ILIKE $${n})`;
  }
  if (query.branch_id) { params.push(Number(query.branch_id)); inner += ` AND gm.branch_id = $${params.length}`; }
  if (query.head_member_id) { params.push(Number(query.head_member_id)); inner += ` AND gm.head_member_id = $${params.length}`; }
  let outer = `SELECT *, COUNT(*) OVER()::int AS total FROM (${inner}) t WHERE TRUE`;
  const state = query.state ? String(query.state).toUpperCase() : null;
  if (state && ['NONE', 'UPCOMING', 'ACTIVE', 'EXPIRING', 'FROZEN', 'EXPIRED'].includes(state)) { params.push(state); outer += ` AND t.state = $${params.length}`; }
  if (query.plan_id) { params.push(Number(query.plan_id)); outer += ` AND t.plan_id = $${params.length}`; }
  if (query.inactive_days) { params.push(Math.max(1, Number(query.inactive_days) || 30)); outer += ` AND (t.last_visit IS NULL OR t.last_visit < now() - ($${params.length}::int * interval '1 day')) AND t.state IN ('ACTIVE','EXPIRING')`; }
  const order = SORTS[query.sort] || SORTS.name;
  params.push(limit, offset);
  const rows = (await db.query(`${outer} ORDER BY ${order}, t.member_id LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  const hide = trainerOnly(tenant);
  return { rows: rows.map(({ total, ...r }) => (hide ? { ...r, phone: null, email: null } : r)), total: rows[0]?.total ?? 0, limit, offset };
};

/** One member in full. Returns null when they are not visible to this viewer (so a caller answers 404). */
export const getMember = async (db, tenant, memberId, { health = false } = {}) => {
  const params = [tenant.businessId, memberId];
  const row = (await db.query(
    `SELECT gm.*, gm.joined_on::text AS joined_on, gm.dob::text AS dob, c.name, c.phone, c.email, c.customer_id,
            (SELECT json_build_object('member_id', h.member_id, 'name', hc.name, 'member_code', h.member_code) FROM gym_members h JOIN customers hc ON hc.customer_id = h.customer_id WHERE h.member_id = gm.head_member_id) AS head
     FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.business_id = $1 AND gm.member_id = $2${visibleTo(tenant, params)}`, params)).rows[0];
  if (!row) return null;
  const { date: today } = await localParts(db, tenant.businessId);
  const memberships = await viewsFor(db, tenant.businessId, memberId, today);
  const credentials = await listCredentials(db, tenant.businessId, memberId);
  const visits = (await db.query(
    `SELECT attendance_id, check_in_at, check_out_at, source, branch_id, status FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND status <> 'VOIDED' ORDER BY check_in_at DESC LIMIT 20`, [memberId, tenant.businessId])).rows;
  const stats = (await db.query(
    `SELECT COUNT(*)::int AS visits, COUNT(*) FILTER (WHERE local_date >= $3::date - 30)::int AS visits_30d, MAX(check_in_at) AS last_visit FROM gym_attendance WHERE member_id = $1 AND business_id = $2 AND status <> 'VOIDED'`, [memberId, tenant.businessId, today])).rows[0];
  const dependents = (await db.query(`SELECT gm.member_id, gm.member_code, gm.status, c.name FROM gym_members gm JOIN customers c ON c.customer_id = gm.customer_id WHERE gm.head_member_id = $1 AND gm.business_id = $2 ORDER BY gm.member_id`, [memberId, tenant.businessId])).rows;
  const { health_notes: notes, ...rest } = trainerOnly(tenant) ? { ...row, phone: null, email: null, emergency_phone: null } : row;
  return withRupees({ ...rest, ...(health ? { health_notes: notes } : {}), memberships, credentials, recent_visits: visits, stats, dependents });
};

/* ── CSV ────────────────────────────────────────────────────────────────────────────────────── */

const CSV_COLUMNS = ['member_code', 'name', 'phone', 'email', 'status', 'joined_on', 'dob', 'gender', 'plan', 'membership_ends', 'last_visit', 'company', 'emergency_name', 'emergency_phone'];

/** A spreadsheet runs a cell that starts with = + - @ as a formula. A member's name is typed by a stranger, so such cells are defused. */
const cell = (v) => {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const exportCsv = async (db, tenant) => {
  const { rows } = await listMembers(db, tenant, { limit: 200, status: 'LIVE' });
  // every page, not only the first
  const all = [...rows];
  for (let offset = 200; ; offset += 200) {
    const page = await listMembers(db, tenant, { limit: 200, offset, status: 'LIVE' });
    if (!page.rows.length) break;
    all.push(...page.rows);
    if (all.length >= page.total) break;
  }
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of all) lines.push([r.member_code, r.name, r.phone, r.email, r.status, r.joined_on, '', '', r.plan_name, r.expires_on, r.last_visit, r.company, '', ''].map(cell).join(','));
  return `${lines.join('\n')}\n`;
};

/**
 * Check (and, unless dry_run, load) members from rows the screen parsed out of a CSV: { name, phone, email, dob, gender, joined_on, company }.
 * Every row is checked; the result lists each problem with its row number. Nothing is saved if any row has a problem, so a file is loaded whole or not at all.
 */
export const importRows = async (db, tenant, userId, rows, { dryRun = true } = {}) => {
  if (!Array.isArray(rows) || !rows.length) throw bad('The file has no rows');
  if (rows.length > 2000) throw bad('Import at most 2000 members at a time');
  const problems = []; const seen = new Map();
  const clean = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    try {
      const f = cleanFields(r, { creating: true });
      if (!f.phone) throw bad('A phone number is required');
      const k = phoneKey(f.phone);
      if (seen.has(k)) throw bad(`Same phone as row ${seen.get(k)}`);
      seen.set(k, i + 2);
      if ((await findByPhone(db, tenant.businessId, f.phone)).length) throw bad('A member with this phone number already exists');
      clean.push(r);
    } catch (e) {
      if (e?.name === 'GymError' || e?.name === 'SalonError') problems.push({ row: i + 2, message: e.message }); else throw e;
    }
  }
  if (problems.length || dryRun) return { ok: !problems.length, imported: 0, checked: rows.length, problems: problems.slice(0, 200) };
  for (const r of clean) await registerMember(db, tenant, userId, { ...r, confirm_duplicate: false });
  return { ok: true, imported: clean.length, checked: rows.length, problems: [] };
};
