/* Restore from a backup on the phone: pick the ZIP the owner downloaded, check what would be added (a preview that changes nothing), then restore what is missing. The server does
   all of it (backend modules/restore.js): it only ADDS, never changes or removes anything that is already there. These only shape what the screen shows. */
import { t } from './i18n.ts';

export type RestoreTable = { file: string; label: string; found: boolean; rows: number; added: number; already_there: number; not_needed: number; skipped: number; problems: { row: number; why: string }[] };
export type RestoreReport = { applied: boolean; source: { name: string | null; gstin: string | null; made_on: string | null }; tables: RestoreTable[]; totals: { added: number; already_there: number; skipped: number }; notes: string[] };

export const canRestore = (role: string | null | undefined): boolean => role === 'OWNER';
export const isZipName = (name: string): boolean => /\.zip$/i.test(name.trim());
export const pickProblem = (name: string, size: number | null | undefined): string =>
  !isZipName(name) ? 'Choose the ZIP file you downloaded from FlowXP' : size != null && size > 55 * 1024 * 1024 ? 'That file is too large to restore here' : '';

export const sourceLine = (r: RestoreReport): string => (r.source.name ? t('From {name}, made on {date}.', { name: r.source.name, date: r.source.made_on ?? '—' }) : '');
export const headline = (r: RestoreReport): string =>
  r.totals.added === 0 && r.totals.skipped === 0 ? t('Nothing was missing: everything in the backup is already here.') : t(r.applied ? '{n} records were added.' : '{n} records would be added.', { n: r.totals.added });
/** One line per kind of record that was in the backup: what was added (or would be), what was already here, what had to be skipped. */
export const tableLine = (x: RestoreTable, applied: boolean): string =>
  [t(applied ? '{n} added' : '{n} to add', { n: x.added }), t('{n} already here', { n: x.already_there }), x.skipped ? t('{n} skipped', { n: x.skipped }) : ''].filter(Boolean).join(' · ');
export const shownTables = (r: RestoreReport): RestoreTable[] => r.tables.filter((x) => x.found && x.rows > 0);
export const problemLines = (r: RestoreReport): string[] => r.tables.flatMap((x) => x.problems.map((p) => `${x.label}, ${t('row {n}', { n: p.row })}: ${p.why}`));
export const canApply = (r: RestoreReport | null): boolean => Boolean(r && !r.applied && r.totals.added > 0);

export const RESTORE_TEXTS: string[] = [
  'Choose the ZIP file you downloaded from FlowXP', 'That file is too large to restore here', 'From {name}, made on {date}.', 'Nothing was missing: everything in the backup is already here.', '{n} records were added.', '{n} records would be added.',
  '{n} added', '{n} to add', '{n} already here', '{n} skipped', 'row {n}', 'Restore from a backup', 'Put back what a backup has and this business does not', 'Only the owner can restore from a backup.',
  'Choose the ZIP file you downloaded before. Restoring only adds what is missing. Nothing that is already in FlowXP is changed or removed, so it is safe to run twice.', 'Choose the backup file', 'Check what would be added', 'Restore what is missing',
  'This is only a check. Nothing has been changed yet.', 'Restored bills do not change the shelf. If goods were lost, count your stock.', 'Make the restore?', 'The records that are missing are added. Nothing else changes.', 'Restored'
];
