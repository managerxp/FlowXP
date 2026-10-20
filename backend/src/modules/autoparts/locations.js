/*
 * The warehouse layout: a tree of locations (warehouse > zone > aisle > rack > shelf > bin by default; the level names are the shop's own) and the bins that hold stock.
 *
 * A location has a SEGMENT ("R12") and a CODE (its parent's code and its segment: "WH-A-B-03-R12-04-B07"), unique per outlet. Only locations marked can_store hold stock.
 * Locations are never deleted: they are switched off, and only when nothing is in them. Each has a random QR token, so a printed label opens it without exposing anything.
 */
import crypto from 'node:crypto';
import { PartsError, bool, int, num, oneOf, text, withRupees } from './common.js';

export const TYPES = ['WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN', 'OTHER'];
const TYPE_BY_LEVEL = ['WAREHOUSE', 'ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'];
export const MAX_LEVEL = 6;

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._]{0,22}$/;
const normSegment = (value) => {
  const v = String(value ?? '').trim().toUpperCase();
  if (!SEGMENT.test(v)) throw new PartsError(400, 'A location name is letters, digits, dots and underscores, such as R12 or B07');
  return v;
};

export const getSettings = async (db, businessId) => {
  await db.query(`INSERT INTO autoparts_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  return (await db.query(`SELECT * FROM autoparts_settings WHERE business_id = $1`, [businessId])).rows[0];
};

/** The shop's own word for a kind of place (its configured name for that step of the usual warehouse > zone > aisle > rack > shelf > bin ladder). */
const typeName = (settings, type) => settings.level_names?.[TYPE_BY_LEVEL.indexOf(type)] || type.charAt(0) + type.slice(1).toLowerCase();

const shape = (r) => ({
  location_id: r.location_id, branch_id: r.branch_id, parent_id: r.parent_id, level: r.level, segment: r.segment, code: r.code, name: r.name, loc_type: r.loc_type,
  can_store: r.can_store, capacity_units: r.capacity_units == null ? null : Number(r.capacity_units), capacity_weight_g: r.capacity_weight_g == null ? null : Number(r.capacity_weight_g),
  handling: r.handling, notes: r.notes, is_active: r.is_active, sort_order: r.sort_order, qr_token: r.qr_token, qr_text: `FXB:${r.qr_token}`
});

/** The location, if it is in this business and visible from the outlet being viewed. */
export const getLocation = async (db, tenant, id, { lock = false } = {}) => {
  const r = (await db.query(`SELECT * FROM warehouse_locations WHERE location_id = $1 AND business_id = $2${lock ? ' FOR NO KEY UPDATE' : ''}`, [Number(id), tenant.businessId])).rows[0];
  if (!r || (tenant.scopeBranchId != null && r.branch_id !== tenant.scopeBranchId)) throw new PartsError(404, 'Not found');
  return r;
};

/** A scanned label ("FXB:<token>") or a typed code. */
export const findByScan = async (db, tenant, code) => {
  const t = String(code ?? '').trim();
  if (!t) return null;
  const params = [tenant.businessId];
  let cond;
  if (/^FXB:/i.test(t)) { params.push(t.slice(4)); cond = `qr_token = $2`; } else { params.push(t); cond = `lower(code) = lower($2)`; }
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); cond += ` AND branch_id = $3`; }
  const r = (await db.query(`SELECT * FROM warehouse_locations WHERE business_id = $1 AND ${cond} AND is_active ORDER BY location_id LIMIT 1`, params)).rows[0];
  return r || null;
};

export const createLocation = async (db, tenant, userId, b) => {
  const settings = await getSettings(db, tenant.businessId);
  let parent = null;
  if (b.parent_id) parent = await getLocation(db, tenant, b.parent_id, { lock: true });
  const level = parent ? parent.level + 1 : 1;
  if (level > MAX_LEVEL) throw new PartsError(400, `The layout goes ${MAX_LEVEL} levels deep at most`);
  if (parent && !parent.is_active) throw new PartsError(409, `${parent.code} is switched off`);
  if (parent?.can_store) {
    const held = Number((await db.query(`SELECT COALESCE(SUM(qty + damaged_qty), 0) AS n FROM bin_stock WHERE location_id = $1`, [parent.location_id])).rows[0].n);
    if (held > 0) throw new PartsError(409, `${parent.code} already holds stock, so it cannot be split into smaller locations. Move the stock out first`);
    await db.query(`UPDATE warehouse_locations SET can_store = FALSE WHERE location_id = $1`, [parent.location_id]);
  }
  let branchId = parent ? parent.branch_id : tenant.branchId;
  if (!parent && b.branch_id) {
    const own = (await db.query(`SELECT branch_id FROM branches WHERE branch_id = $1 AND business_id = $2`, [Number(b.branch_id), tenant.businessId])).rows[0];
    if (!own || (tenant.scopeBranchId != null && own.branch_id !== tenant.scopeBranchId)) throw new PartsError(404, 'Not found');
    branchId = own.branch_id;
  }
  if (branchId == null) throw new PartsError(400, 'Choose an outlet first');
  const segment = normSegment(b.segment ?? b.code);
  const code = parent ? `${parent.code}-${segment}` : segment;
  const type = b.loc_type ? oneOf(b.loc_type, 'Type', TYPES, { required: true }) : (TYPE_BY_LEVEL[level - 1] ?? 'OTHER');
  const canStore = b.can_store === undefined ? type === 'BIN' : bool(b.can_store);
  const capacity = b.capacity_units === undefined || b.capacity_units === null || b.capacity_units === '' ? null : num(b.capacity_units, 'Capacity', { min: 0, max: 100000000 });
  const weight = b.capacity_weight_g === undefined || b.capacity_weight_g === null || b.capacity_weight_g === '' ? null : int(b.capacity_weight_g, 'Weight limit', { min: 0, max: 1000000000 });
  try {
    const r = (await db.query(
      `INSERT INTO warehouse_locations (business_id, branch_id, parent_id, level, segment, code, name, loc_type, can_store, capacity_units, capacity_weight_g, handling, notes, qr_token, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [tenant.businessId, branchId, parent?.location_id ?? null, level, segment, code, text(b.name, 'Name', { max: 80 }) || `${typeName(settings, type)} ${segment}`, type, canStore, capacity, weight,
        text(b.handling, 'Handling', { max: 200 }), text(b.notes, 'Notes', { max: 300 }), crypto.randomBytes(12).toString('hex'), b.sort_order === undefined ? 0 : int(b.sort_order, 'Order', { min: 0, max: 100000 }), userId])).rows[0];
    return shape(r);
  } catch (error) {
    if (error.code === '23505') throw new PartsError(409, `${code} already exists at this outlet`);
    throw error;
  }
};

/** Make many siblings at once: racks R01 to R12, bins A to D. `count` of them from `start`, with `prefix` and a zero-padded number (or letters when `letters`). */
export const createMany = async (db, tenant, userId, b) => {
  const count = int(b.count, 'How many', { min: 1, max: 200, required: true });
  const prefix = String(b.prefix ?? '').trim().toUpperCase().slice(0, 12);
  const letters = bool(b.letters);
  const start = b.start === undefined ? 1 : int(b.start, 'Start at', { min: 0, max: 100000 });
  const pad = b.pad === undefined ? 2 : int(b.pad, 'Digits', { min: 1, max: 6 });
  if (letters && count > 26) throw new PartsError(400, 'Letters run A to Z: up to 26 at a time');
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const tail = letters ? String.fromCharCode(65 + i) : String(start + i).padStart(pad, '0');
    made.push(await createLocation(db, tenant, userId, { ...b, segment: `${prefix}${tail}`, name: undefined }));
  }
  return made;
};

const rewriteCodes = async (db, root, newCode) => {
  const oldCode = root.code;
  await db.query(`UPDATE warehouse_locations SET code = $2 || substr(code, $3) WHERE business_id = $1 AND branch_id = $4 AND (location_id = $5 OR code LIKE $6)`,
    [root.business_id, newCode, oldCode.length + 1, root.branch_id, root.location_id, `${oldCode.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`]);
};

export const updateLocation = async (db, tenant, id, b) => {
  const cur = await getLocation(db, tenant, id, { lock: true });
  const f = {};
  if (b.name !== undefined) f.name = text(b.name, 'Name', { max: 80 });
  if (b.capacity_units !== undefined) f.capacity_units = b.capacity_units === null || b.capacity_units === '' ? null : num(b.capacity_units, 'Capacity', { min: 0, max: 100000000 });
  if (b.capacity_weight_g !== undefined) f.capacity_weight_g = b.capacity_weight_g === null || b.capacity_weight_g === '' ? null : int(b.capacity_weight_g, 'Weight limit', { min: 0, max: 1000000000 });
  if (b.handling !== undefined) f.handling = text(b.handling, 'Handling', { max: 200 });
  if (b.notes !== undefined) f.notes = text(b.notes, 'Notes', { max: 300 });
  if (b.sort_order !== undefined) f.sort_order = int(b.sort_order, 'Order', { min: 0, max: 100000 });
  if (b.loc_type !== undefined) f.loc_type = oneOf(b.loc_type, 'Type', TYPES, { required: true });
  if (b.can_store !== undefined) {
    const want = bool(b.can_store);
    if (want && (await db.query(`SELECT 1 FROM warehouse_locations WHERE parent_id = $1 LIMIT 1`, [cur.location_id])).rowCount) throw new PartsError(409, 'This location has smaller locations inside it, so it cannot hold stock itself');
    if (!want && Number((await db.query(`SELECT COALESCE(SUM(qty + damaged_qty), 0) AS n FROM bin_stock WHERE location_id = $1`, [cur.location_id])).rows[0].n) > 0) throw new PartsError(409, 'This location holds stock. Move it out first');
    f.can_store = want;
  }
  if (b.is_active !== undefined) {
    const active = bool(b.is_active);
    if (!active) {
      const held = Number((await db.query(
        `SELECT COALESCE(SUM(s.qty + s.damaged_qty), 0) AS n FROM bin_stock s JOIN warehouse_locations l ON l.location_id = s.location_id WHERE l.business_id = $1 AND l.branch_id = $2 AND (l.location_id = $3 OR l.code LIKE $4)`,
        [cur.business_id, cur.branch_id, cur.location_id, `${cur.code.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`])).rows[0].n);
      if (held > 0) throw new PartsError(409, `${cur.code} still holds ${held} units. Move the stock out before switching it off`);
      await db.query(`UPDATE warehouse_locations SET is_active = FALSE WHERE business_id = $1 AND branch_id = $2 AND (location_id = $3 OR code LIKE $4)`, [cur.business_id, cur.branch_id, cur.location_id, `${cur.code.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`]);
    } else {
      if (cur.parent_id) { const p = (await db.query(`SELECT is_active FROM warehouse_locations WHERE location_id = $1`, [cur.parent_id])).rows[0]; if (!p.is_active) throw new PartsError(409, 'Switch the location above on first'); }
      f.is_active = true;
    }
  }
  if (b.segment !== undefined) {
    const seg = normSegment(b.segment);
    if (seg !== cur.segment) {
      const parentCode = cur.parent_id ? (await db.query(`SELECT code FROM warehouse_locations WHERE location_id = $1`, [cur.parent_id])).rows[0].code : null;
      const newCode = parentCode ? `${parentCode}-${seg}` : seg;
      try {
        await rewriteCodes(db, cur, newCode);
        await db.query(`UPDATE warehouse_locations SET segment = $2 WHERE location_id = $1`, [cur.location_id, seg]);
      } catch (error) {
        if (error.code === '23505') throw new PartsError(409, `${newCode} already exists at this outlet`);
        throw error;
      }
    }
  }
  const keys = Object.keys(f);
  if (keys.length) await db.query(`UPDATE warehouse_locations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE location_id = $1`, [cur.location_id, ...keys.map((k) => f[k])]);
  return shape((await db.query(`SELECT * FROM warehouse_locations WHERE location_id = $1`, [cur.location_id])).rows[0]);
};

/** Every location of an outlet with what is in it: units and parts per node (a node counts everything below it), and how full the storing ones are. */
export const tree = async (db, tenant, { branchId = null, includeInactive = false } = {}) => {
  const params = [tenant.businessId];
  let where = 'l.business_id = $1';
  const scope = tenant.scopeBranchId ?? (branchId ? Number(branchId) : null);
  if (scope != null) { params.push(scope); where += ` AND l.branch_id = $${params.length}`; }
  if (!includeInactive) where += ' AND l.is_active';
  const locs = (await db.query(`SELECT l.* FROM warehouse_locations l WHERE ${where} ORDER BY l.branch_id, l.sort_order, l.code`, params)).rows;
  const stock = (await db.query(`SELECT s.location_id, SUM(s.qty) AS qty, SUM(s.damaged_qty) AS damaged, SUM(s.reserved_qty) AS reserved, COUNT(*) FILTER (WHERE s.qty > 0 OR s.damaged_qty > 0) AS parts
    FROM bin_stock s JOIN warehouse_locations l ON l.location_id = s.location_id WHERE ${where} GROUP BY s.location_id`, params)).rows;
  const own = new Map(stock.map((r) => [r.location_id, r]));
  const kids = new Map();
  for (const l of locs) { if (!kids.has(l.parent_id)) kids.set(l.parent_id, []); kids.get(l.parent_id).push(l); }
  const roll = (l) => {
    const o = own.get(l.location_id);
    let qty = Number(o?.qty || 0); let damaged = Number(o?.damaged || 0); let parts = Number(o?.parts || 0); let bins = l.can_store ? 1 : 0; let occupied = l.can_store && (qty > 0 || damaged > 0) ? 1 : 0;
    for (const c of kids.get(l.location_id) || []) { const r = roll(c); qty += r.qty; damaged += r.damaged; parts += r.parts; bins += r.bins; occupied += r.occupied; }
    const out = { ...shape(l), qty, damaged, parts, storing_locations: bins, occupied_locations: occupied, own_qty: Number(o?.qty || 0),
      fill_pct: l.can_store && l.capacity_units ? Math.round(Number(o?.qty || 0) / Number(l.capacity_units) * 1000) / 10 : null };
    out.over_capacity = l.can_store && l.capacity_units != null && Number(o?.qty || 0) > Number(l.capacity_units);
    return out;
  };
  return locs.map(roll);
};

/** A location with the parts in it and its path from the warehouse down. */
export const detail = async (db, tenant, id) => {
  const l = await getLocation(db, tenant, id);
  const path = [];
  let cur = l;
  while (cur) { path.unshift({ location_id: cur.location_id, code: cur.code, name: cur.name, level: cur.level }); cur = cur.parent_id ? (await db.query(`SELECT * FROM warehouse_locations WHERE location_id = $1`, [cur.parent_id])).rows[0] : null; }
  const code = `${l.code.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`;
  const parts = (await db.query(
    `SELECT s.product_id, p.name, p.sku, s.qty, s.damaged_qty, s.reserved_qty, s.is_primary, s.updated_at, l2.code AS location_code
     FROM bin_stock s JOIN warehouse_locations l2 ON l2.location_id = s.location_id JOIN products p ON p.product_id = s.product_id
     WHERE s.business_id = $1 AND s.branch_id = $2 AND (s.location_id = $3 OR l2.code LIKE $4) AND (s.qty > 0 OR s.damaged_qty > 0) ORDER BY l2.code, p.name LIMIT 500`,
    [tenant.businessId, l.branch_id, l.location_id, code])).rows.map((r) => ({ ...r, qty: Number(r.qty), damaged_qty: Number(r.damaged_qty), reserved_qty: Number(r.reserved_qty), available: Number(r.qty) - Number(r.reserved_qty) }));
  const children = (await db.query(`SELECT location_id, code, name, loc_type, can_store, is_active FROM warehouse_locations WHERE parent_id = $1 ORDER BY sort_order, code`, [l.location_id])).rows;
  return withRupees({ ...shape(l), path, parts, children });
};

export const saveSettings = async (db, businessId, b) => {
  const cur = await getSettings(db, businessId);
  const f = {};
  if (b.level_names !== undefined) {
    if (!Array.isArray(b.level_names) || b.level_names.length < 1 || b.level_names.length > MAX_LEVEL) throw new PartsError(400, `Name between 1 and ${MAX_LEVEL} levels`);
    f.level_names = JSON.stringify(b.level_names.map((n) => text(n, 'Level name', { max: 24, required: true })));
  }
  if (b.count_auto_units !== undefined) f.count_auto_units = num(b.count_auto_units, 'Count difference limit', { min: 0, max: 1000000, required: true });
  for (const [k, label, min, max] of [['safety_days', 'Safety days', 0, 180], ['review_days', 'Review days', 7, 365], ['dead_days', 'Dead stock days', 30, 1095], ['slow_days', 'Slow stock days', 14, 730]]) {
    if (b[k] !== undefined) f[k] = int(b[k], label, { min, max, required: true });
  }
  const keys = Object.keys(f);
  if (keys.length) await db.query(`UPDATE autoparts_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE business_id = $1`, [businessId, ...keys.map((k) => f[k])]);
  return { ...cur, ...Object.fromEntries(keys.map((k) => [k, k === 'level_names' ? JSON.parse(f[k]) : f[k]])) };
};
