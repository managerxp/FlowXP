/*
 * Training records: the exercise library, workout plans, goals and body measurements.
 *
 * PRIVACY. Goals and measurements are health information. Only trainers with that member assigned, managers, and the member themselves can read them: the desk screen
 * does not carry them. A trainer's own login reaches only their assigned members (see members.js `visibleTo`); every function here is given a member that has already
 * passed that check.
 */
import { GymError, bool, int, isoDate, num, oneOf, text } from './common.js';

const bad = (message) => new GymError(400, message);

/* ── exercises ──────────────────────────────────────────────────────────────────────────────── */

export const listExercises = async (db, businessId, { q = null, all = false } = {}) => (await db.query(
  `SELECT * FROM gym_exercises WHERE business_id = $1 ${all ? '' : 'AND is_active'} AND ($2::text IS NULL OR name ILIKE $2 OR muscle_group ILIKE $2) ORDER BY name LIMIT 300`,
  [businessId, q ? `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null])).rows;

export const saveExercise = async (db, businessId, id, b) => {
  const cur = id ? (await db.query(`SELECT * FROM gym_exercises WHERE exercise_id = $1 AND business_id = $2`, [id, businessId])).rows[0] : null;
  if (id && !cur) throw new GymError(404, 'Not found');
  const has = (k) => b[k] !== undefined;
  const e = {
    name: has('name') ? text(b.name, 'Name', { max: 100, required: true }) : cur?.name ?? text(b.name, 'Name', { max: 100, required: true }),
    muscle_group: has('muscle_group') ? text(b.muscle_group, 'Muscle group', { max: 40 }) : cur?.muscle_group ?? null,
    equipment: has('equipment') ? text(b.equipment, 'Equipment', { max: 60 }) : cur?.equipment ?? null,
    instructions: has('instructions') ? text(b.instructions, 'Instructions', { max: 1000 }) : cur?.instructions ?? null,
    is_active: has('is_active') ? bool(b.is_active) : cur?.is_active ?? true
  };
  try {
    if (!id) return (await db.query(`INSERT INTO gym_exercises (business_id, name, muscle_group, equipment, instructions) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [businessId, e.name, e.muscle_group, e.equipment, e.instructions])).rows[0];
    return (await db.query(`UPDATE gym_exercises SET name = $3, muscle_group = $4, equipment = $5, instructions = $6, is_active = $7 WHERE exercise_id = $1 AND business_id = $2 RETURNING *`, [id, businessId, e.name, e.muscle_group, e.equipment, e.instructions, e.is_active])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new GymError(409, 'There is already an exercise with that name');
    throw error;
  }
};

/* ── workout plans ──────────────────────────────────────────────────────────────────────────── */

const cleanItems = async (db, businessId, items) => {
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one exercise');
  if (items.length > 120) throw bad('A plan can have 120 exercises at most');
  const out = [];
  for (const [i, it] of items.entries()) {
    let exerciseId = it.exercise_id ? Number(it.exercise_id) : null;
    let name = text(it.exercise_name, 'Exercise', { max: 100 });
    if (exerciseId) {
      const ex = (await db.query(`SELECT name FROM gym_exercises WHERE exercise_id = $1 AND business_id = $2`, [exerciseId, businessId])).rows[0];
      if (!ex) throw bad(`Exercise ${i + 1} is not in your library`);
      name = name || ex.name;
    }
    if (!name) throw bad(`Exercise ${i + 1} needs a name`);
    out.push({
      day_no: int(it.day_no ?? 1, 'Day', { min: 1, max: 14, required: true }), position: i, exercise_id: exerciseId, exercise_name: name,
      sets: int(it.sets, 'Sets', { min: 1, max: 50 }), reps: text(it.reps, 'Reps', { max: 20 }), rest_seconds: int(it.rest_seconds, 'Rest', { min: 0, max: 1800 }),
      weight_kg: num(it.weight_kg, 'Weight', { min: 0, max: 1000 }), notes: text(it.notes, 'Notes', { max: 200 })
    });
  }
  return out;
};

const writeItems = async (db, workoutId, items) => {
  await db.query(`DELETE FROM gym_workout_items WHERE workout_id = $1`, [workoutId]);
  for (const it of items) {
    await db.query(`INSERT INTO gym_workout_items (workout_id, day_no, position, exercise_id, exercise_name, sets, reps, rest_seconds, weight_kg, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [workoutId, it.day_no, it.position, it.exercise_id, it.exercise_name, it.sets, it.reps, it.rest_seconds, it.weight_kg, it.notes]);
  }
};

/** Make a plan for a member, or a template (memberId null) to copy later. */
export const createWorkout = async (db, { businessId, memberId = null, trainerId = null, userId, b }) => {
  const items = await cleanItems(db, businessId, b.items);
  const isTemplate = memberId == null;
  const w = (await db.query(
    `INSERT INTO gym_workout_plans (business_id, member_id, trainer_id, name, goal, notes, is_template, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING workout_id`,
    [businessId, memberId, trainerId, text(b.name, 'Name', { max: 100, required: true }), text(b.goal, 'Goal', { max: 200 }), text(b.notes, 'Notes', { max: 1000 }), isTemplate, userId])).rows[0];
  await writeItems(db, w.workout_id, items);
  return w.workout_id;
};

export const updateWorkout = async (db, { businessId, workoutId, b }) => {
  const cur = (await db.query(`SELECT * FROM gym_workout_plans WHERE workout_id = $1 AND business_id = $2 FOR UPDATE`, [workoutId, businessId])).rows[0];
  if (!cur) throw new GymError(404, 'Not found');
  const has = (k) => b[k] !== undefined;
  await db.query(`UPDATE gym_workout_plans SET name = $3, goal = $4, notes = $5, status = $6 WHERE workout_id = $1 AND business_id = $2`, [workoutId, businessId,
    has('name') ? text(b.name, 'Name', { max: 100, required: true }) : cur.name, has('goal') ? text(b.goal, 'Goal', { max: 200 }) : cur.goal, has('notes') ? text(b.notes, 'Notes', { max: 1000 }) : cur.notes,
    has('status') ? oneOf(b.status, 'Status', ['ACTIVE', 'ARCHIVED'], { required: true }) : cur.status]);
  if (has('items')) await writeItems(db, workoutId, await cleanItems(db, businessId, b.items));
  return cur;
};

/** Copy a template onto a member. */
export const assignTemplate = async (db, { businessId, templateId, memberId, trainerId = null, userId }) => {
  const t = (await db.query(`SELECT * FROM gym_workout_plans WHERE workout_id = $1 AND business_id = $2 AND is_template AND status = 'ACTIVE'`, [templateId, businessId])).rows[0];
  if (!t) throw new GymError(404, 'Not found');
  const w = (await db.query(`INSERT INTO gym_workout_plans (business_id, member_id, trainer_id, name, goal, notes, is_template, created_by) VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7) RETURNING workout_id`, [businessId, memberId, trainerId, t.name, t.goal, t.notes, userId])).rows[0];
  await db.query(
    `INSERT INTO gym_workout_items (workout_id, day_no, position, exercise_id, exercise_name, sets, reps, rest_seconds, weight_kg, notes)
     SELECT $1, day_no, position, exercise_id, exercise_name, sets, reps, rest_seconds, weight_kg, notes FROM gym_workout_items WHERE workout_id = $2`, [w.workout_id, templateId]);
  return w.workout_id;
};

export const listWorkouts = async (db, businessId, { memberId = null, templates = false }) => {
  const plans = (await db.query(
    `SELECT w.workout_id, w.member_id, w.name, w.goal, w.notes, w.is_template, w.status, w.created_at, tr.name AS trainer_name
     FROM gym_workout_plans w LEFT JOIN gym_trainers tr ON tr.trainer_id = w.trainer_id
     WHERE w.business_id = $1 AND ${templates ? 'w.is_template' : 'w.member_id = $2'} AND w.status = 'ACTIVE' ORDER BY w.created_at DESC LIMIT 100`, templates ? [businessId] : [businessId, memberId])).rows;
  if (!plans.length) return [];
  const items = (await db.query(`SELECT * FROM gym_workout_items WHERE workout_id = ANY($1::int[]) ORDER BY workout_id, day_no, position`, [plans.map((p) => p.workout_id)])).rows;
  return plans.map((p) => ({ ...p, items: items.filter((i) => i.workout_id === p.workout_id).map((i) => ({ ...i, weight_kg: i.weight_kg == null ? null : Number(i.weight_kg) })) }));
};

/* ── goals and measurements ─────────────────────────────────────────────────────────────────── */

export const addGoal = async (db, { businessId, memberId, userId, b }) => {
  const g = (await db.query(
    `INSERT INTO gym_goals (business_id, member_id, description, metric, target_value, target_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [businessId, memberId, text(b.description, 'Goal', { max: 200, required: true }), oneOf(b.metric, 'Measure', ['WEIGHT_KG', 'BODY_FAT_PCT', 'WAIST_CM', 'OTHER']), num(b.target_value, 'Target', { min: 0, max: 100000 }), isoDate(b.target_date, 'Target date'), userId])).rows[0];
  return g;
};

export const setGoalStatus = async (db, { businessId, goalId, memberId, status }) => {
  const s = oneOf(status, 'Status', ['ACTIVE', 'ACHIEVED', 'DROPPED'], { required: true });
  const r = (await db.query(`UPDATE gym_goals SET status = $4 WHERE goal_id = $1 AND business_id = $2 AND member_id = $3 RETURNING *`, [goalId, businessId, memberId, s])).rows[0];
  if (!r) throw new GymError(404, 'Not found');
  return r;
};

export const addMeasurement = async (db, { businessId, memberId, userId, b }) => {
  const m = {
    measured_on: isoDate(b.measured_on, 'Date', { required: true }), weight_kg: num(b.weight_kg, 'Weight', { min: 10, max: 500 }), height_cm: num(b.height_cm, 'Height', { min: 50, max: 260 }),
    body_fat_pct: num(b.body_fat_pct, 'Body fat', { min: 2, max: 80 }), waist_cm: num(b.waist_cm, 'Waist', { min: 30, max: 250 }), chest_cm: num(b.chest_cm, 'Chest', { min: 30, max: 250 }), hips_cm: num(b.hips_cm, 'Hips', { min: 30, max: 250 }),
    notes: text(b.notes, 'Notes', { max: 300 })
  };
  if (![m.weight_kg, m.height_cm, m.body_fat_pct, m.waist_cm, m.chest_cm, m.hips_cm].some((v) => v != null)) throw bad('Enter at least one measurement');
  return (await db.query(
    `INSERT INTO gym_measurements (business_id, member_id, measured_on, weight_kg, height_cm, body_fat_pct, waist_cm, chest_cm, hips_cm, notes, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [businessId, memberId, m.measured_on, m.weight_kg, m.height_cm, m.body_fat_pct, m.waist_cm, m.chest_cm, m.hips_cm, m.notes, userId])).rows[0];
};

/** Goals and measurements, newest first, with how far each goal's measure has moved since the first reading. */
export const progress = async (db, businessId, memberId) => {
  const goals = (await db.query(`SELECT goal_id, description, metric, target_value::float AS target_value, target_date::text AS target_date, status FROM gym_goals WHERE business_id = $1 AND member_id = $2 ORDER BY created_at DESC`, [businessId, memberId])).rows;
  const measurements = (await db.query(
    `SELECT measurement_id, measured_on::text AS measured_on, weight_kg::float AS weight_kg, height_cm::float AS height_cm, body_fat_pct::float AS body_fat_pct, waist_cm::float AS waist_cm, chest_cm::float AS chest_cm, hips_cm::float AS hips_cm, notes
     FROM gym_measurements WHERE business_id = $1 AND member_id = $2 ORDER BY measured_on DESC, measurement_id DESC LIMIT 100`, [businessId, memberId])).rows;
  const column = { WEIGHT_KG: 'weight_kg', BODY_FAT_PCT: 'body_fat_pct', WAIST_CM: 'waist_cm' };
  const first = (c) => [...measurements].reverse().find((m) => m[c] != null)?.[c] ?? null;
  const latest = (c) => measurements.find((m) => m[c] != null)?.[c] ?? null;
  return {
    goals: goals.map((g) => {
      const c = column[g.metric];
      const start = c ? first(c) : null; const now = c ? latest(c) : null;
      return { ...g, start_value: start, current_value: now, moved: start != null && now != null ? Math.round((now - start) * 10) / 10 : null };
    }),
    measurements
  };
};
