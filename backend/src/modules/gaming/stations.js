/*
 * Zones, stations and the games list.
 *
 * A station owns a dining table (so its tab, its QR menu and the kitchen all work as they do for any table). The table is made with the station
 * and closed with it. A station is per outlet; reads are limited to the outlet the viewer is looking at (`tenant.scopeBranchId`).
 */
import crypto from 'node:crypto';
import { GamingError, STATION_KINDS, bool, int, oneOf, text } from './common.js';

const scoped = (tenant, params, alias) => {
  if (tenant?.scopeBranchId == null) return '';
  params.push(tenant.scopeBranchId);
  return ` AND ${alias}.branch_id = $${params.length}`;
};

/* ── zones ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const listZones = async (db, tenant) => {
  const params = [tenant.businessId];
  const where = scoped(tenant, params, 'z');
  return (await db.query(
    `SELECT z.zone_id, z.branch_id, z.name, z.sort_order, z.is_active,
            (SELECT COUNT(*)::int FROM gaming_stations s WHERE s.zone_id = z.zone_id AND s.status <> 'ARCHIVED') AS stations
     FROM gaming_zones z WHERE z.business_id = $1 AND z.is_active${where} ORDER BY z.sort_order, z.name`, params)).rows;
};

export const createZone = async (db, tenant, b) => {
  const name = text(b.name, 'Zone name', { max: 60, required: true });
  const sort = b.sort_order === undefined ? 0 : int(b.sort_order, 'Order', { min: 0, max: 999 });
  try {
    return (await db.query(`INSERT INTO gaming_zones (business_id, branch_id, name, sort_order) VALUES ($1,$2,$3,$4) RETURNING zone_id, name, sort_order, branch_id`, [tenant.businessId, tenant.branchId, name, sort])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new GamingError(409, `You already have a zone called ${name}`);
    throw error;
  }
};

export const updateZone = async (db, tenant, id, b) => {
  const cur = (await db.query(`SELECT * FROM gaming_zones WHERE zone_id = $1 AND business_id = $2 AND is_active`, [id, tenant.businessId])).rows[0];
  if (!cur || (tenant.scopeBranchId != null && cur.branch_id !== tenant.scopeBranchId)) throw new GamingError(404, 'Not found');
  const name = b.name === undefined ? cur.name : text(b.name, 'Zone name', { max: 60, required: true });
  const sort = b.sort_order === undefined ? cur.sort_order : int(b.sort_order, 'Order', { min: 0, max: 999 });
  try {
    await db.query(`UPDATE gaming_zones SET name = $2, sort_order = $3 WHERE zone_id = $1`, [id, name, sort]);
  } catch (error) {
    if (error.code === '23505') throw new GamingError(409, `You already have a zone called ${name}`);
    throw error;
  }
  // the table floor shows the zone's name
  await db.query(`UPDATE dining_tables t SET zone = $2 FROM gaming_stations s WHERE s.table_id = t.table_id AND s.zone_id = $1`, [id, name]);
  return { zone_id: id, name, sort_order: sort };
};

export const deleteZone = async (db, tenant, id) => {
  const cur = (await db.query(`SELECT * FROM gaming_zones WHERE zone_id = $1 AND business_id = $2 AND is_active`, [id, tenant.businessId])).rows[0];
  if (!cur || (tenant.scopeBranchId != null && cur.branch_id !== tenant.scopeBranchId)) throw new GamingError(404, 'Not found');
  const n = (await db.query(`SELECT COUNT(*)::int AS n FROM gaming_stations WHERE zone_id = $1 AND status <> 'ARCHIVED'`, [id])).rows[0].n;
  if (n) throw new GamingError(409, `${n} station${n === 1 ? ' is' : 's are'} in this zone. Move or archive them first`);
  await db.query(`UPDATE gaming_zones SET is_active = FALSE WHERE zone_id = $1`, [id]);
};

/* ── stations ──────────────────────────────────────────────────────────────────────────────────────────────── */

const shape = (r) => ({
  station_id: r.station_id, branch_id: r.branch_id, zone_id: r.zone_id, zone_name: r.zone_name ?? null, name: r.name, kind: r.kind, label: r.label,
  max_players: r.max_players, table_id: r.table_id, qr_token: r.qr_token ?? null, status: r.status, status_note: r.status_note, sort_order: r.sort_order
});

export const listStations = async (db, tenant, { includeArchived = false } = {}) => {
  const params = [tenant.businessId];
  const where = scoped(tenant, params, 's');
  return (await db.query(
    `SELECT s.*, z.name AS zone_name, t.qr_token FROM gaming_stations s
     LEFT JOIN gaming_zones z ON z.zone_id = s.zone_id JOIN dining_tables t ON t.table_id = s.table_id
     WHERE s.business_id = $1${includeArchived ? '' : " AND s.status <> 'ARCHIVED'"}${where} ORDER BY COALESCE(z.sort_order, 999), z.name, s.sort_order, s.name`, params)).rows.map(shape);
};

export const getStation = async (db, tenant, id, { lock = false } = {}) => {
  const params = [id, tenant.businessId];
  const where = scoped(tenant, params, 's');
  const row = (await db.query(
    `SELECT s.*, z.name AS zone_name, t.qr_token FROM gaming_stations s LEFT JOIN gaming_zones z ON z.zone_id = s.zone_id JOIN dining_tables t ON t.table_id = s.table_id
     WHERE s.station_id = $1 AND s.business_id = $2${where}${lock ? ' FOR UPDATE OF s' : ''}`, params)).rows[0];
  if (!row) throw new GamingError(404, 'Not found');
  return row;
};

const zoneOf = async (db, tenant, zoneId, branchId) => {
  if (zoneId == null || zoneId === '') return null;
  const z = (await db.query(`SELECT zone_id, name FROM gaming_zones WHERE zone_id = $1 AND business_id = $2 AND branch_id = $3 AND is_active`, [Number(zoneId), tenant.businessId, branchId])).rows[0];
  if (!z) throw new GamingError(400, 'That zone does not exist at this outlet');
  return z;
};

const tableNameTaken = async (db, tenant, branchId, name, exceptTableId = null) =>
  (await db.query(`SELECT 1 FROM dining_tables WHERE business_id = $1 AND branch_id = $2 AND lower(name) = lower($3) AND status <> 'CLOSED' AND table_id <> COALESCE($4, 0)`, [tenant.businessId, branchId, name, exceptTableId])).rowCount > 0;

export const createStation = async (db, tenant, b) => {
  const name = text(b.name, 'Station name', { max: 60, required: true });
  const kind = oneOf(b.kind, 'Kind', STATION_KINDS, { required: true });
  const zone = await zoneOf(db, tenant, b.zone_id, tenant.branchId);
  const maxPlayers = b.max_players === undefined ? (kind === 'CONSOLE' ? 4 : 2) : int(b.max_players, 'Players', { min: 1, max: 20 });
  if (await tableNameTaken(db, tenant, tenant.branchId, name)) throw new GamingError(409, `You already have a table or station called ${name}`);
  const table = (await db.query(
    `INSERT INTO dining_tables (business_id, branch_id, name, zone, seats, qr_token) VALUES ($1,$2,$3,$4,$5,$6) RETURNING table_id`,
    [tenant.businessId, tenant.branchId, name, zone?.name ?? null, maxPlayers, crypto.randomBytes(20).toString('hex')])).rows[0];
  const id = (await db.query(
    `INSERT INTO gaming_stations (business_id, branch_id, zone_id, name, kind, label, max_players, table_id, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING station_id`,
    [tenant.businessId, tenant.branchId, zone?.zone_id ?? null, name, kind, text(b.label, 'Label', { max: 40 }), maxPlayers, table.table_id, b.sort_order === undefined ? 0 : int(b.sort_order, 'Order', { min: 0, max: 999 })])).rows[0].station_id;
  return getStation(db, tenant, id);
};

export const updateStation = async (db, tenant, id, b) => {
  const cur = await getStation(db, tenant, id, { lock: true });
  if (cur.status === 'ARCHIVED') throw new GamingError(400, 'This station is archived');
  const next = {};
  if (b.name !== undefined) next.name = text(b.name, 'Station name', { max: 60, required: true });
  if (b.kind !== undefined) next.kind = oneOf(b.kind, 'Kind', STATION_KINDS, { required: true });
  if (b.label !== undefined) next.label = text(b.label, 'Label', { max: 40 });
  if (b.max_players !== undefined) next.max_players = int(b.max_players, 'Players', { min: 1, max: 20 });
  if (b.sort_order !== undefined) next.sort_order = int(b.sort_order, 'Order', { min: 0, max: 999 });
  let zone = null;
  if (b.zone_id !== undefined) { zone = await zoneOf(db, tenant, b.zone_id, cur.branch_id); next.zone_id = zone?.zone_id ?? null; }
  if (next.name && next.name.toLowerCase() !== cur.name.toLowerCase() && await tableNameTaken(db, tenant, cur.branch_id, next.name, cur.table_id)) throw new GamingError(409, `You already have a table or station called ${next.name}`);
  const keys = Object.keys(next);
  if (!keys.length) return shape(cur);
  try {
    await db.query(`UPDATE gaming_stations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE station_id = $1`, [id, ...keys.map((k) => next[k])]);
  } catch (error) {
    if (error.code === '23505') throw new GamingError(409, `You already have a station called ${next.name}`);
    throw error;
  }
  // the linked table follows the station's name, zone and size
  await db.query(
    `UPDATE dining_tables SET name = COALESCE($2, name), zone = CASE WHEN $3::boolean THEN $4 ELSE zone END, seats = COALESCE($5, seats) WHERE table_id = $1`,
    [cur.table_id, next.name ?? null, b.zone_id !== undefined, zone?.name ?? null, next.max_players ?? null]);
  return getStation(db, tenant, id);
};

const hasLiveSession = async (db, stationId) =>
  (await db.query(`SELECT 1 FROM gaming_sessions WHERE station_id = $1 AND status IN ('RUNNING','PAUSED')`, [stationId])).rowCount > 0;

/** Take a station out of service (a broken controller, a torn cloth) or back. A running station cannot be taken out. */
export const setStationStatus = async (db, tenant, id, b) => {
  const cur = await getStation(db, tenant, id, { lock: true });
  if (cur.status === 'ARCHIVED') throw new GamingError(400, 'This station is archived');
  const out = bool(b.out_of_service);
  if (out && await hasLiveSession(db, id)) throw new GamingError(409, 'A session is running on this station. Stop it first');
  await db.query(`UPDATE gaming_stations SET status = $2, status_note = $3 WHERE station_id = $1`, [id, out ? 'OUT_OF_SERVICE' : 'ACTIVE', out ? text(b.note, 'Note', { max: 120 }) : null]);
  return getStation(db, tenant, id);
};

/** Retire a station. Its history stays; its table is closed so it leaves the floor. */
export const archiveStation = async (db, tenant, id) => {
  const cur = await getStation(db, tenant, id, { lock: true });
  if (cur.status === 'ARCHIVED') return shape(cur);
  if (await hasLiveSession(db, id)) throw new GamingError(409, 'A session is running on this station. Stop it first');
  const tab = (await db.query(`SELECT 1 FROM orders WHERE table_id = $1 AND status NOT IN ('BILLED','CANCELLED','MERGED')`, [cur.table_id])).rowCount;
  if (tab) throw new GamingError(409, 'This station has an open tab. Bill or cancel it first');
  await db.query(`UPDATE gaming_stations SET status = 'ARCHIVED' WHERE station_id = $1`, [id]);
  await db.query(`UPDATE dining_tables SET status = 'CLOSED' WHERE table_id = $1`, [cur.table_id]);
  return { ...shape(cur), status: 'ARCHIVED' };
};

/* ── games ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const listGames = async (db, businessId) => (await db.query(`SELECT game_id, name FROM gaming_games WHERE business_id = $1 AND is_active ORDER BY name`, [businessId])).rows;

export const createGame = async (db, businessId, b) => {
  const name = text(b.name, 'Game', { max: 80, required: true });
  try {
    return (await db.query(`INSERT INTO gaming_games (business_id, name) VALUES ($1,$2) RETURNING game_id, name`, [businessId, name])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new GamingError(409, `${name} is already on the list`);
    throw error;
  }
};

export const deleteGame = async (db, businessId, id) => {
  const n = (await db.query(`UPDATE gaming_games SET is_active = FALSE WHERE game_id = $1 AND business_id = $2 AND is_active`, [id, businessId])).rowCount;
  if (!n) throw new GamingError(404, 'Not found');
};
