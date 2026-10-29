import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { saveDraft } from './documents.ts';
import type { LineIn } from './documents.ts';
import { LedgerError } from './ledger.ts';

/* Recurring invoices and bills. A template makes a DRAFT on each due date; a person checks and issues it, so nothing posts by itself. */

export type Every = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
export type TemplateIn = { kind: 'INVOICE' | 'BILL'; partyId: bigint; every: Every; startDate: string; endDate?: string; memo?: string; lines: (Omit<LineIn, 'itemId'> & { itemId?: string })[] };

/** The next due date. Month steps keep the day of the month, or the last day when the month is shorter (31 Jan, 28 Feb, 31 Mar). */
export const nextDue = (date: string, every: Every, anchorDay = Number(date.slice(8, 10))): string => {
  const d = new Date(`${date}T00:00:00Z`);
  if (every === 'WEEK') return new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const months = every === 'MONTH' ? 1 : every === 'QUARTER' ? 3 : 12;
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(anchorDay, last));
  return first.toISOString().slice(0, 10);
};

export const createTemplate = async (c: Db, orgId: bigint, t: TemplateIn, actor: string): Promise<bigint> => {
  if (t.endDate && t.endDate < t.startDate) throw new LedgerError('bad_dates', 'the end date is before the start date');
  const id = (await c.query(
    `INSERT INTO recurring_templates (organization_id, kind, party_id, every, next_date, end_date, memo, lines) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [orgId, t.kind, t.partyId, t.every, t.startDate, t.endDate ?? null, t.memo ?? null, JSON.stringify(t.lines)])).rows[0].id as bigint;
  await audit(c, orgId, { actor, action: 'recurring.created', entityType: 'recurring_template', entityId: id, detail: { kind: t.kind, every: t.every } });
  return id;
};

export const listTemplates = async (c: Db) => (await c.query(
  `SELECT r.id, r.kind, r.party_id, p.name AS party_name, r.every, r.next_date::text AS next_date, r.end_date::text AS end_date, r.memo, r.lines, r.active, r.runs, r.last_document_id
     FROM recurring_templates r JOIN parties p ON p.id = r.party_id ORDER BY r.active DESC, r.next_date, r.id`)).rows;

export const setTemplateActive = async (c: Db, orgId: bigint, id: bigint, active: boolean, actor: string): Promise<boolean> => {
  const ok = (await c.query(`UPDATE recurring_templates SET active = $2 WHERE id = $1`, [id, active])).rowCount;
  if (ok) await audit(c, orgId, { actor, action: active ? 'recurring.resumed' : 'recurring.paused', entityType: 'recurring_template', entityId: id });
  return Boolean(ok);
};

export const deleteTemplate = async (c: Db, orgId: bigint, id: bigint, actor: string): Promise<boolean> => {
  const ok = (await c.query(`DELETE FROM recurring_templates WHERE id = $1`, [id])).rowCount;
  if (ok) await audit(c, orgId, { actor, action: 'recurring.deleted', entityType: 'recurring_template', entityId: id });
  return Boolean(ok);
};

/** Make a draft for every template that has fallen due on or before `today`, catching up missed periods (at most 12 per template per run). */
export const runDue = async (c: Db, orgId: bigint, today: string, actor: string) => {
  const due = (await c.query(
    `SELECT id, kind, party_id, every, next_date::text AS next_date, end_date::text AS end_date, memo, lines FROM recurring_templates
      WHERE active AND next_date <= $1::date AND (end_date IS NULL OR end_date >= next_date) ORDER BY id FOR UPDATE`, [today])).rows;
  const made: { templateId: bigint; documentId: bigint; date: string }[] = [];
  const failed: { templateId: bigint; reason: string }[] = [];
  for (const t of due) {
    let date = t.next_date as string;
    for (let n = 0; n < 12 && date <= today && (!t.end_date || date <= t.end_date); n += 1) {
      await c.query('SAVEPOINT recur');
      try {
        const lines = (t.lines as { itemId?: string }[]).map((l) => ({ ...l, itemId: l.itemId ? BigInt(l.itemId) : undefined })) as LineIn[];
        const documentId = await saveDraft(c, orgId, null, { kind: t.kind, partyId: t.party_id, date, lines, memo: t.memo ?? undefined }, actor);
        await c.query(`UPDATE recurring_templates SET runs = runs + 1, last_document_id = $2 WHERE id = $1`, [t.id, documentId]);
        made.push({ templateId: t.id, documentId, date });
        date = nextDue(date, t.every);
        await c.query('RELEASE SAVEPOINT recur');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT recur');
        failed.push({ templateId: t.id, reason: e instanceof Error ? e.message : String(e) });
        break;
      }
    }
    await c.query(`UPDATE recurring_templates SET next_date = $2, active = (active AND ($3::date IS NULL OR $2::date <= $3::date)) WHERE id = $1`, [t.id, date, t.end_date]);
  }
  return { made, failed };
};
