import type { Db } from './db.ts';
import { createItem, createParty } from './masters.ts';
import type { ItemIn, PartyIn } from './masters.ts';

/* Bulk import of customers, vendors and items from rows the web app read out of a CSV file.
   Each row is its own all-or-nothing step: a bad row is reported and skipped, the good ones go in. A dry run does the same work and then undoes it, so the preview is exactly what the import would do. */

export type RowError = { row: number; message: string };
export type ImportResult = { created: number; errors: RowError[]; dryRun: boolean };
export const IMPORT_LIMIT = 1000;

const run = async <T>(c: Db, rows: T[], dryRun: boolean, one: (r: T) => Promise<unknown>): Promise<ImportResult> => {
  const errors: RowError[] = []; let created = 0;
  await c.query('SAVEPOINT import_all');
  for (const [i, r] of rows.entries()) {
    await c.query('SAVEPOINT import_row');
    try { await one(r); await c.query('RELEASE SAVEPOINT import_row'); created += 1; }
    catch (e) { await c.query('ROLLBACK TO SAVEPOINT import_row'); errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) }); }
  }
  if (dryRun) await c.query('ROLLBACK TO SAVEPOINT import_all'); else await c.query('RELEASE SAVEPOINT import_all');
  return { created, errors, dryRun };
};

export const importParties = (c: Db, orgId: bigint, rows: PartyIn[], dryRun: boolean, actor: string) => run(c, rows, dryRun, (r) => {
  if (!r.name?.trim()) throw new Error('the name is empty');
  return createParty(c, orgId, r, actor);
});

export const importItems = (c: Db, orgId: bigint, rows: ItemIn[], dryRun: boolean, actor: string) => run(c, rows, dryRun, (r) => {
  if (!r.sku?.trim() || !r.name?.trim()) throw new Error('the code (SKU) and the name are both needed');
  return createItem(c, orgId, r, actor);
});
