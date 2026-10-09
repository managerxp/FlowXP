/*
 * The phone database's version. Each upgrade runs once, in order, inside a transaction, and the version is recorded only when it succeeds,
 * so an app killed half way simply starts the upgrade again. Upgrades only ADD (tables, columns, indexes): a bill waiting to send is never
 * rewritten or dropped by one. v1 is the schema the first release shipped; a phone that has no version number is treated as v1.
 */
import type { Db } from './db.ts';

export type Step = { to: number; name: string; up: string[] };

export const STEPS: Step[] = [
  { to: 2, name: 'outbox remembers when it last tried', up: [`ALTER TABLE outbox ADD COLUMN last_try INTEGER`, `CREATE INDEX IF NOT EXISTS idx_outbox_taken ON outbox (taken_at)`] },
  { to: 3, name: 'index for the bills list by invoice', up: [`CREATE INDEX IF NOT EXISTS idx_outbox_invoice ON outbox (invoice_id)`] },
  { to: 4, name: 'outbox remembers which till a sale belongs to (pharmacy bills go to the pharmacy till)', up: [`ALTER TABLE outbox ADD COLUMN path TEXT`] }
];
export const LATEST = STEPS[STEPS.length - 1].to;

const columns = async (db: Db, table: string) => (await db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);

/** Bring a database up to LATEST. Resolves to the versions applied. Safe to call on every start. */
export const migrate = async (db: Db, steps: Step[] = STEPS): Promise<number[]> => {
  const have = Number((await db.all<{ user_version: number }>(`PRAGMA user_version`))[0]?.user_version ?? 0) || 1;
  const done: number[] = [];
  for (const step of steps.filter((x) => x.to > have)) {
    await db.tx(async (t) => {
      for (const sql of step.up) {
        // a column that is already there (an upgrade interrupted after it) is not an error
        if (/^ALTER TABLE (\w+) ADD COLUMN (\w+)/.test(sql)) { const [, table, col] = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql)!; if ((await columns(t, table)).includes(col)) continue; }
        await t.run(sql);
      }
      await t.run(`PRAGMA user_version = ${step.to}`);
    });
    done.push(step.to);
  }
  return done;
};
