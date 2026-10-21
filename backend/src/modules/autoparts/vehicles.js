/*
 * The vehicle catalogue (makes, models, variants) and which part fits which vehicle.
 *
 * The list starts empty: the shop enters it, imports a file, or adds the usual Indian makes and models with one click (indiaVehicles.js: names only, never fitment). A fitment row says which vehicle a part is said to fit,
 * for which years, where that came from, and whether a person has checked it. A part is never assumed to fit because it looks the same as another:
 *   VERIFIED    someone checked it (their name and the time are kept)
 *   UNVERIFIED  said to fit, nobody has checked; always shown with a warning
 *   NOT_FIT     known not to fit; wins over every other row for the same vehicle
 * Alternates are suggested only where both parts have VERIFIED fitment for the same vehicle.
 */
import { FITMENT_STATUS, PartsError, VEHICLE_TYPES, int, oneOf, ownedProduct, text, withRupees } from './common.js';

const FUELS = ['PETROL', 'DIESEL', 'CNG', 'LPG', 'ELECTRIC', 'HYBRID', 'OTHER'];
const GEARS = ['MANUAL', 'AUTOMATIC', 'AMT', 'CVT', 'DCT', 'OTHER'];

/* ── makes, models, variants ─────────────────────────────────────────────────────────────────────────────────────────────── */

export const tree = async (db, businessId, { includeInactive = false } = {}) => {
  const makes = (await db.query(`SELECT * FROM vehicle_makes WHERE business_id = $1${includeInactive ? '' : ' AND is_active'} ORDER BY vehicle_type, name`, [businessId])).rows;
  const models = (await db.query(`SELECT m.*, (SELECT COUNT(*) FROM part_fitment f WHERE f.model_id = m.model_id)::int AS parts FROM vehicle_models m WHERE m.business_id = $1${includeInactive ? '' : ' AND m.is_active'} ORDER BY m.name`, [businessId])).rows;
  const variants = (await db.query(`SELECT * FROM vehicle_variants WHERE business_id = $1${includeInactive ? '' : ' AND is_active'} ORDER BY year_from NULLS LAST, variant`, [businessId])).rows;
  return makes.map((mk) => ({
    ...mk,
    models: models.filter((m) => m.make_id === mk.make_id).map((m) => ({ ...m, variants: variants.filter((v) => v.model_id === m.model_id) }))
  }));
};

export const createMake = async (db, businessId, b) => {
  const name = text(b.name, 'Make', { max: 60, required: true });
  const type = oneOf(b.vehicle_type ?? 'CAR', 'Vehicle type', VEHICLE_TYPES, { required: true });
  try {
    return (await db.query(`INSERT INTO vehicle_makes (business_id, name, vehicle_type) VALUES ($1,$2,$3) RETURNING *`, [businessId, name, type])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new PartsError(409, `${name} is already in the list for ${type.toLowerCase()}s`);
    throw error;
  }
};

const ownMake = async (db, businessId, id) => {
  const r = (await db.query(`SELECT * FROM vehicle_makes WHERE make_id = $1 AND business_id = $2`, [Number(id), businessId])).rows[0];
  if (!r) throw new PartsError(404, 'Not found');
  return r;
};
const ownModel = async (db, businessId, id) => {
  const r = (await db.query(`SELECT * FROM vehicle_models WHERE model_id = $1 AND business_id = $2`, [Number(id), businessId])).rows[0];
  if (!r) throw new PartsError(404, 'Not found');
  return r;
};

export const createModel = async (db, businessId, b) => {
  const make = await ownMake(db, businessId, b.make_id);
  const name = text(b.name, 'Model', { max: 80, required: true });
  try {
    return (await db.query(`INSERT INTO vehicle_models (business_id, make_id, name) VALUES ($1,$2,$3) RETURNING *`, [businessId, make.make_id, name])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new PartsError(409, `${name} is already listed under ${make.name}`);
    throw error;
  }
};

const yearOrNull = (v, label) => (v === undefined || v === null || v === '' ? null : int(v, label, { min: 1900, max: 2100 }));

const variantFields = (b) => {
  const f = {};
  if (b.generation !== undefined) f.generation = text(b.generation, 'Generation', { max: 40 });
  if (b.variant !== undefined) f.variant = text(b.variant, 'Variant', { max: 60 });
  if (b.engine_type !== undefined) f.engine_type = text(b.engine_type, 'Engine', { max: 40 });
  if (b.engine_cc !== undefined) f.engine_cc = b.engine_cc === '' || b.engine_cc === null ? null : int(b.engine_cc, 'Engine size (cc)', { min: 1, max: 20000 });
  if (b.fuel !== undefined) f.fuel = b.fuel === '' || b.fuel === null ? null : oneOf(b.fuel, 'Fuel', FUELS);
  if (b.transmission !== undefined) f.transmission = b.transmission === '' || b.transmission === null ? null : oneOf(b.transmission, 'Transmission', GEARS);
  if (b.year_from !== undefined) f.year_from = yearOrNull(b.year_from, 'From year');
  if (b.year_to !== undefined) f.year_to = yearOrNull(b.year_to, 'To year');
  return f;
};

export const createVariant = async (db, businessId, b) => {
  const model = await ownModel(db, businessId, b.model_id);
  const f = variantFields(b);
  if (f.year_from != null && f.year_to != null && f.year_to < f.year_from) throw new PartsError(400, 'The last year is before the first year');
  const keys = Object.keys(f);
  return (await db.query(`INSERT INTO vehicle_variants (business_id, model_id${keys.length ? `, ${keys.join(', ')}` : ''}) VALUES ($1,$2${keys.map((_, i) => `,$${i + 3}`).join('')}) RETURNING *`, [businessId, model.model_id, ...keys.map((k) => f[k])])).rows[0];
};

export const updateVariant = async (db, businessId, id, b) => {
  const cur = (await db.query(`SELECT * FROM vehicle_variants WHERE variant_id = $1 AND business_id = $2`, [Number(id), businessId])).rows[0];
  if (!cur) throw new PartsError(404, 'Not found');
  const f = variantFields(b);
  if (b.is_active !== undefined) f.is_active = b.is_active === true || b.is_active === 'true';
  const yf = f.year_from !== undefined ? f.year_from : cur.year_from; const yt = f.year_to !== undefined ? f.year_to : cur.year_to;
  if (yf != null && yt != null && yt < yf) throw new PartsError(400, 'The last year is before the first year');
  const keys = Object.keys(f);
  if (!keys.length) return cur;
  return (await db.query(`UPDATE vehicle_variants SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE variant_id = $1 AND business_id = $2 RETURNING *`, [Number(id), businessId, ...keys.map((k) => f[k])])).rows[0];
};

/** Rename or switch off a make or model. Switching off keeps every fitment row that points at it. */
export const updateMake = async (db, businessId, id, b) => {
  const cur = await ownMake(db, businessId, id);
  const name = b.name === undefined ? cur.name : text(b.name, 'Make', { max: 60, required: true });
  const active = b.is_active === undefined ? cur.is_active : (b.is_active === true || b.is_active === 'true');
  try { return (await db.query(`UPDATE vehicle_makes SET name = $2, is_active = $3 WHERE make_id = $1 RETURNING *`, [cur.make_id, name, active])).rows[0]; }
  catch (error) { if (error.code === '23505') throw new PartsError(409, `${name} is already in the list`); throw error; }
};
export const updateModel = async (db, businessId, id, b) => {
  const cur = await ownModel(db, businessId, id);
  const name = b.name === undefined ? cur.name : text(b.name, 'Model', { max: 80, required: true });
  const active = b.is_active === undefined ? cur.is_active : (b.is_active === true || b.is_active === 'true');
  try { return (await db.query(`UPDATE vehicle_models SET name = $2, is_active = $3 WHERE model_id = $1 RETURNING *`, [cur.model_id, name, active])).rows[0]; }
  catch (error) { if (error.code === '23505') throw new PartsError(409, `${name} is already listed`); throw error; }
};

/**
 * Load vehicles from rows the shop supplies: { vehicle_type, make, model, generation, variant, engine_type, engine_cc, fuel, transmission, year_from, year_to }.
 * `commit: false` only checks. Every row is checked first and nothing is saved unless all are good; a row that repeats a variant already there is skipped.
 */
export const importVehicles = async (db, businessId, rows, { commit = false } = {}) => {
  if (!Array.isArray(rows) || !rows.length) throw new PartsError(400, 'There are no rows to import');
  if (rows.length > 5000) throw new PartsError(400, 'Import up to 5,000 rows at a time');
  const problems = []; const clean = [];
  rows.forEach((r, i) => {
    try {
      const make = text(r.make, 'Make', { max: 60, required: true });
      const model = text(r.model, 'Model', { max: 80, required: true });
      const vt = oneOf(r.vehicle_type || 'CAR', 'Vehicle type', VEHICLE_TYPES, { required: true });
      const f = variantFields({ generation: r.generation, variant: r.variant, engine_type: r.engine_type, engine_cc: r.engine_cc, fuel: r.fuel, transmission: r.transmission, year_from: r.year_from, year_to: r.year_to });
      if (f.year_from != null && f.year_to != null && f.year_to < f.year_from) throw new PartsError(400, 'The last year is before the first year');
      clean.push({ make, model, vt, f });
    } catch (e) { problems.push({ row: i + 2, message: e.message }); }
  });
  if (problems.length) return { ok: false, problems: problems.slice(0, 50), checked: rows.length };
  if (!commit) return { ok: true, checked: rows.length, committed: false };
  let makes = 0; let models = 0; let variants = 0; let skipped = 0;
  for (const c of clean) {
    let mk = (await db.query(`SELECT make_id FROM vehicle_makes WHERE business_id = $1 AND lower(name) = lower($2) AND vehicle_type = $3`, [businessId, c.make, c.vt])).rows[0];
    if (!mk) { mk = (await db.query(`INSERT INTO vehicle_makes (business_id, name, vehicle_type) VALUES ($1,$2,$3) RETURNING make_id`, [businessId, c.make, c.vt])).rows[0]; makes += 1; }
    let md = (await db.query(`SELECT model_id FROM vehicle_models WHERE make_id = $1 AND lower(name) = lower($2)`, [mk.make_id, c.model])).rows[0];
    if (!md) { md = (await db.query(`INSERT INTO vehicle_models (business_id, make_id, name) VALUES ($1,$2,$3) RETURNING model_id`, [businessId, mk.make_id, c.model])).rows[0]; models += 1; }
    const f = c.f;
    if (!Object.values(f).some((v) => v != null && v !== '')) continue;     // a make and model alone
    const same = (await db.query(
      `SELECT 1 FROM vehicle_variants WHERE model_id = $1 AND generation IS NOT DISTINCT FROM $2 AND variant IS NOT DISTINCT FROM $3 AND engine_type IS NOT DISTINCT FROM $4 AND engine_cc IS NOT DISTINCT FROM $5
         AND fuel IS NOT DISTINCT FROM $6 AND transmission IS NOT DISTINCT FROM $7 AND year_from IS NOT DISTINCT FROM $8 AND year_to IS NOT DISTINCT FROM $9`,
      [md.model_id, f.generation ?? null, f.variant ?? null, f.engine_type ?? null, f.engine_cc ?? null, f.fuel ?? null, f.transmission ?? null, f.year_from ?? null, f.year_to ?? null])).rowCount;
    if (same) { skipped += 1; continue; }
    const keys = Object.keys(f);
    await db.query(`INSERT INTO vehicle_variants (business_id, model_id, ${keys.join(', ')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')})`, [businessId, md.model_id, ...keys.map((k) => f[k])]);
    variants += 1;
  }
  return { ok: true, checked: rows.length, committed: true, makes, models, variants, skipped };
};

/* ── fitment ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const fitShape = (r) => ({
  fit_id: r.fit_id, product_id: r.product_id, model_id: r.model_id, variant_id: r.variant_id, make: r.make_name, model: r.model_name, vehicle_type: r.vehicle_type,
  variant: r.variant ?? null, generation: r.generation ?? null, engine: [r.engine_type, r.engine_cc ? `${r.engine_cc} cc` : null].filter(Boolean).join(' ') || null, fuel: r.fuel ?? null,
  year_from: r.year_from, year_to: r.year_to, status: r.status, source: r.source, note: r.note, verified_by: r.verified_by_name ?? null, verified_at: r.verified_at
});

const FIT_SELECT = `SELECT f.*, mk.name AS make_name, mk.vehicle_type, md.name AS model_name, v.variant, v.generation, v.engine_type, v.engine_cc, v.fuel, u.name AS verified_by_name
  FROM part_fitment f JOIN vehicle_models md ON md.model_id = f.model_id JOIN vehicle_makes mk ON mk.make_id = md.make_id LEFT JOIN vehicle_variants v ON v.variant_id = f.variant_id LEFT JOIN users u ON u.user_id = f.verified_by`;

export const fitmentOf = async (db, businessId, productId) =>
  (await db.query(`${FIT_SELECT} WHERE f.business_id = $1 AND f.product_id = $2 ORDER BY mk.name, md.name, f.year_from NULLS FIRST`, [businessId, productId])).rows.map(fitShape);

/** Say a part fits a vehicle. New fitment is UNVERIFIED unless `status` says otherwise; VERIFIED stamps who and when. */
export const addFit = async (db, businessId, productId, userId, b) => {
  await ownedProduct(db, businessId, productId);
  const model = await ownModel(db, businessId, b.model_id);
  let variantId = null;
  if (b.variant_id) {
    const v = (await db.query(`SELECT variant_id, model_id FROM vehicle_variants WHERE variant_id = $1 AND business_id = $2`, [Number(b.variant_id), businessId])).rows[0];
    if (!v || v.model_id !== model.model_id) throw new PartsError(400, 'That variant belongs to a different model');
    variantId = v.variant_id;
  }
  const status = oneOf(b.status ?? 'UNVERIFIED', 'Fitment', FITMENT_STATUS, { required: true });
  const yf = yearOrNull(b.year_from, 'From year'); const yt = yearOrNull(b.year_to, 'To year');
  if (yf != null && yt != null && yt < yf) throw new PartsError(400, 'The last year is before the first year');
  const verified = status === 'VERIFIED';
  try {
    const id = (await db.query(
      `INSERT INTO part_fitment (business_id, product_id, model_id, variant_id, year_from, year_to, status, source, note, verified_by, verified_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING fit_id`,
      [businessId, productId, model.model_id, variantId, yf, yt, status, text(b.source, 'Source', { max: 80 }) || (verified ? null : 'entered by hand'), text(b.note, 'Note', { max: 200 }), verified ? userId : null, verified ? new Date() : null, userId])).rows[0].fit_id;
    return (await db.query(`${FIT_SELECT} WHERE f.fit_id = $1`, [id])).rows.map(fitShape)[0];
  } catch (error) {
    if (error.code === '23505') throw new PartsError(409, 'That fitment is already on this part. Change its status instead');
    throw error;
  }
};

/** Change a fitment row's status (verify it, mark it not fitting) or its note. */
export const setFit = async (db, businessId, fitId, userId, b) => {
  const cur = (await db.query(`SELECT * FROM part_fitment WHERE fit_id = $1 AND business_id = $2 FOR UPDATE`, [Number(fitId), businessId])).rows[0];
  if (!cur) throw new PartsError(404, 'Not found');
  const status = b.status === undefined ? cur.status : oneOf(b.status, 'Fitment', FITMENT_STATUS, { required: true });
  const note = b.note === undefined ? cur.note : text(b.note, 'Note', { max: 200 });
  const source = b.source === undefined ? cur.source : text(b.source, 'Source', { max: 80 });
  const verified = status === 'VERIFIED';
  // a change of status always restamps who looked; going back to UNVERIFIED clears it
  const stamp = status !== cur.status ? [verified ? userId : null, verified ? new Date() : null] : [cur.verified_by, cur.verified_at];
  await db.query(`UPDATE part_fitment SET status = $2, note = $3, source = $4, verified_by = $5, verified_at = $6 WHERE fit_id = $1`, [cur.fit_id, status, note, source, ...stamp]);
  return (await db.query(`${FIT_SELECT} WHERE f.fit_id = $1`, [cur.fit_id])).rows.map(fitShape)[0];
};

export const removeFit = async (db, businessId, fitId) => {
  const n = (await db.query(`DELETE FROM part_fitment WHERE fit_id = $1 AND business_id = $2`, [Number(fitId), businessId])).rowCount;
  if (!n) throw new PartsError(404, 'Not found');
};

/** Copy one part's fitment to others that share it ("the same pad fits both"). The copies are UNVERIFIED: someone has to check each part. */
export const copyFit = async (db, businessId, fromProductId, toProductIds, userId) => {
  await ownedProduct(db, businessId, fromProductId);
  const ids = [...new Set((toProductIds || []).map(Number))].filter((n) => n && n !== Number(fromProductId));
  if (!ids.length) throw new PartsError(400, 'Choose the parts to copy to');
  if (ids.length > 200) throw new PartsError(400, 'Copy to up to 200 parts at a time');
  const owned = (await db.query(`SELECT product_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids])).rows.length;
  if (owned !== ids.length) throw new PartsError(404, 'Not found');
  let added = 0;
  for (const to of ids) {
    const r = await db.query(
      `INSERT INTO part_fitment (business_id, product_id, model_id, variant_id, year_from, year_to, status, source, note, created_by)
       SELECT business_id, $3::int, model_id, variant_id, year_from, year_to, 'UNVERIFIED', 'copied from part ' || $2::int::text, note, $4::int FROM part_fitment WHERE product_id = $2::int AND business_id = $1 AND status <> 'NOT_FIT'
       ON CONFLICT DO NOTHING`, [businessId, Number(fromProductId), to, userId]);
    added += r.rowCount;
  }
  return { parts: ids.length, added };
};

/* ── asking: what fits this vehicle, does this part fit ──────────────────────────────────────────────────────────────────── */

/** How a part stands for one vehicle: NOT_FIT beats everything, then VERIFIED, then UNVERIFIED, else UNKNOWN (no fitment on record). */
export const fitFor = async (db, businessId, productId, { model_id: modelId, variant_id: variantId = null, year = null }) => {
  if (!modelId) throw new PartsError(400, 'Choose the vehicle model');
  const rows = (await db.query(
    `SELECT fit_id, status, source, note, verified_at FROM part_fitment WHERE business_id = $1 AND product_id = $2 AND model_id = $3
       AND ($4::int IS NULL OR variant_id IS NULL OR variant_id = $4) AND ($5::int IS NULL OR ((year_from IS NULL OR year_from <= $5) AND (year_to IS NULL OR year_to >= $5)))`,
    [businessId, productId, Number(modelId), variantId ? Number(variantId) : null, year ? Number(year) : null])).rows;
  const pick = (s) => rows.find((r) => r.status === s);
  const hit = pick('NOT_FIT') || pick('VERIFIED') || pick('UNVERIFIED');
  if (!hit) return { status: 'UNKNOWN', warning: 'No fitment is on record for this vehicle. Do not assume it fits.' };
  return {
    status: hit.status, fit_id: hit.fit_id, source: hit.source, verified_at: hit.verified_at,
    warning: hit.status === 'NOT_FIT' ? 'This part is recorded as NOT fitting this vehicle.' : hit.status === 'UNVERIFIED' ? 'Fitment has not been verified. Check before selling.' : null
  };
};

/** Parts for a vehicle, each with its fitment status. Parts recorded NOT_FIT are left out and counted. */
export const partsForVehicle = async (db, tenant, q, { limit = 50, offset = 0 } = {}) => {
  if (!q.model_id) throw new PartsError(400, 'Choose the vehicle model');
  const params = [tenant.businessId, Number(q.model_id)];
  const stock = tenant.scopeBranchId != null ? (params.push(tenant.scopeBranchId), `COALESCE((SELECT quantity FROM branch_stock bs WHERE bs.product_id = p.product_id AND bs.branch_id = $${params.length}), 0)`) : 'p.current_stock';
  let cond = '';
  if (q.variant_id) { params.push(Number(q.variant_id)); cond += ` AND (f.variant_id IS NULL OR f.variant_id = $${params.length})`; }
  if (q.year) { params.push(Number(q.year)); cond += ` AND (f.year_from IS NULL OR f.year_from <= $${params.length}) AND (f.year_to IS NULL OR f.year_to >= $${params.length})`; }
  if (q.search) { params.push(`%${String(q.search).toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`); cond += ` AND (lower(p.name) LIKE $${params.length} OR lower(p.sku) LIKE $${params.length})`; }
  if (q.category_id) { params.push(Number(q.category_id)); cond += ` AND p.category_id = $${params.length}`; }
  const rows = (await db.query(
    `SELECT p.product_id, p.name, p.sku, p.selling_price_paise, p.mrp_paise, p.category_id, c.name AS category_name, br.name AS brand_name, a.classification, a.oem_part_no, a.mfr_part_no, ${stock} AS stock,
            bool_or(f.status = 'NOT_FIT') AS not_fit, bool_or(f.status = 'VERIFIED') AS verified, bool_or(f.status = 'UNVERIFIED') AS unverified, MIN(f.source) AS source
     FROM part_fitment f JOIN products p ON p.product_id = f.product_id AND p.status = 'ACTIVE' LEFT JOIN autoparts_parts a ON a.product_id = p.product_id
     LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN brands br ON br.brand_id = p.brand_id
     WHERE f.business_id = $1 AND f.model_id = $2${cond} GROUP BY p.product_id, c.name, br.name, a.classification, a.oem_part_no, a.mfr_part_no ORDER BY p.name`, params)).rows;
  const fits = rows.filter((r) => !r.not_fit);
  const page = fits.slice(offset, offset + limit).map((r) => withRupees({
    product_id: r.product_id, name: r.name, sku: r.sku, selling_price_paise: Number(r.selling_price_paise), mrp_paise: r.mrp_paise == null ? null : Number(r.mrp_paise), category_name: r.category_name,
    brand_name: r.brand_name, classification: r.classification, oem_part_no: r.oem_part_no, mfr_part_no: r.mfr_part_no, stock: Number(r.stock),
    fitment: r.verified ? 'VERIFIED' : 'UNVERIFIED', warning: r.verified ? null : 'Fitment has not been verified. Check before selling.', source: r.source
  }));
  return { rows: page, total: fits.length, excluded_not_fit: rows.length - fits.length };
};

/** Alternates for a part: other parts with VERIFIED fitment for a vehicle this part is VERIFIED for, in the same category. Never from unverified rows. */
export const alternates = async (db, tenant, productId, { model_id: modelId = null, year = null } = {}) => {
  const params = [tenant.businessId, Number(productId)];
  let cond = '';
  if (modelId) { params.push(Number(modelId)); cond += ` AND mine.model_id = $${params.length}`; }
  if (year) { params.push(Number(year)); cond += ` AND (mine.year_from IS NULL OR mine.year_from <= $${params.length}) AND (mine.year_to IS NULL OR mine.year_to >= $${params.length})`; }
  const stock = tenant.scopeBranchId != null ? (params.push(tenant.scopeBranchId), `COALESCE((SELECT quantity FROM branch_stock bs WHERE bs.product_id = p.product_id AND bs.branch_id = $${params.length}), 0)`) : 'p.current_stock';
  const rows = (await db.query(
    `SELECT DISTINCT ON (p.product_id) p.product_id, p.name, p.sku, p.selling_price_paise, br.name AS brand_name, a.classification, ${stock} AS stock, md.name AS model_name, mk.name AS make_name
     FROM part_fitment mine
     JOIN part_fitment theirs ON theirs.model_id = mine.model_id AND theirs.product_id <> mine.product_id AND theirs.status = 'VERIFIED'
        AND (theirs.variant_id IS NULL OR mine.variant_id IS NULL OR theirs.variant_id = mine.variant_id)
        AND (theirs.year_from IS NULL OR mine.year_to IS NULL OR theirs.year_from <= mine.year_to) AND (theirs.year_to IS NULL OR mine.year_from IS NULL OR theirs.year_to >= mine.year_from)
     JOIN products p ON p.product_id = theirs.product_id AND p.status = 'ACTIVE' AND p.business_id = $1
     JOIN products me ON me.product_id = mine.product_id
     LEFT JOIN autoparts_parts a ON a.product_id = p.product_id LEFT JOIN brands br ON br.brand_id = p.brand_id
     JOIN vehicle_models md ON md.model_id = mine.model_id JOIN vehicle_makes mk ON mk.make_id = md.make_id
     WHERE mine.business_id = $1 AND mine.product_id = $2 AND mine.status = 'VERIFIED' AND p.category_id IS NOT DISTINCT FROM me.category_id${cond}
       AND NOT EXISTS (SELECT 1 FROM part_fitment nf WHERE nf.product_id = p.product_id AND nf.model_id = mine.model_id AND nf.status = 'NOT_FIT')
     ORDER BY p.product_id, p.name LIMIT 30`, params)).rows;
  return withRupees(rows.map((r) => ({ product_id: r.product_id, name: r.name, sku: r.sku, selling_price_paise: Number(r.selling_price_paise), brand_name: r.brand_name, classification: r.classification, stock: Number(r.stock), vehicle: `${r.make_name} ${r.model_name}` })));
};
