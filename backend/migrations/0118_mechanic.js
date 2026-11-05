/*
 * FlowXP Mechanic, foundation. A garage is a business of type MECHANIC with a kind (BIKE, CAR or BOTH), and a shared vehicle master (brand, model, fuel) that every garage picks from
 * but only the platform maintains. The master is seeded from modules/mechanic/vehicleMaster.json (two-wheelers, cars, discontinued and upcoming models). A garage can always type a
 * vehicle that is not in it; the master is a convenience, never a rule.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const up = async (client) => {
  await client.query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS garage_kind TEXT`);
  await client.query(`CREATE TABLE IF NOT EXISTS vehicle_master (
    master_id    SERIAL PRIMARY KEY,
    brand        TEXT NOT NULL,
    model        TEXT NOT NULL,
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('BIKE','CAR')),
    body_type    TEXT NOT NULL DEFAULT '',
    fuel_type    TEXT NOT NULL,
    availability TEXT NOT NULL CHECK (availability IN ('CURRENT','DISCONTINUED','UPCOMING')),
    intro_year   INT,
    UNIQUE (brand, model, fuel_type)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS vehicle_master_type_brand ON vehicle_master (vehicle_type, brand)`);
  const file = fileURLToPath(new URL('../src/modules/mechanic/vehicleMaster.json', import.meta.url));
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const values = []; const marks = part.map((r, n) => { values.push(...r); return `($${n * 7 + 1},$${n * 7 + 2},$${n * 7 + 3},$${n * 7 + 4},$${n * 7 + 5},$${n * 7 + 6},$${n * 7 + 7})`; });
    await client.query(`INSERT INTO vehicle_master (brand, model, vehicle_type, body_type, fuel_type, availability, intro_year) VALUES ${marks.join(',')} ON CONFLICT DO NOTHING`, values);
  }
};
