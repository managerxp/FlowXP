import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { saveDraft } from './documents.ts';
import { LedgerError } from './ledger.ts';
import { paiseToString, toPaise } from './money.ts';
import { COST_TYPES } from './costtypes.ts';

/* Projects. Hours are logged against a project at an hourly rate; bills, invoices and expenses can be tagged to it. The summary sets what was invoiced
   (before GST) against what it cost (bills and expenses, before GST), and "invoice the hours" turns unbilled billable time into a draft invoice. */

export type ProjectIn = { name: string; code?: string; customerId?: bigint; hourlyRate?: string; budget?: string; notes?: string };

const gone = () => new LedgerError('not_found', 'no such project');

export const createProject = async (c: Db, orgId: bigint, p: ProjectIn, actor: string): Promise<bigint> => {
  if (!p.name.trim()) throw new LedgerError('name_required', 'give the project a name');
  if (p.customerId && !(await c.query(`SELECT 1 FROM parties WHERE id = $1 AND kind IN ('CUSTOMER', 'BOTH')`, [p.customerId])).rowCount) throw new LedgerError('bad_customer', 'choose one of your customers');
  const row = (await c.query(
    `INSERT INTO projects (organization_id, name, code, party_id, hourly_rate_minor, budget_minor, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, p.name.trim().slice(0, 160), p.code?.trim() || null, p.customerId ?? null, toPaise(p.hourlyRate ?? '0'), toPaise(p.budget ?? '0'), p.notes?.trim().slice(0, 1000) || null, actor])).rows[0];
  if (!row) throw new LedgerError('code_taken', `the code ${p.code} is already used by another project`);
  await audit(c, orgId, { actor, action: 'project.created', entityType: 'project', entityId: row.id as bigint, detail: { name: p.name } });
  return row.id as bigint;
};

export const updateProject = async (c: Db, orgId: bigint, id: bigint, p: Partial<ProjectIn> & { status?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' }, actor: string): Promise<void> => {
  const cur = (await c.query(`SELECT id FROM projects WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!cur) throw gone();
  if (p.customerId && !(await c.query(`SELECT 1 FROM parties WHERE id = $1 AND kind IN ('CUSTOMER', 'BOTH')`, [p.customerId])).rowCount) throw new LedgerError('bad_customer', 'choose one of your customers');
  await c.query(
    `UPDATE projects SET name = COALESCE($2, name), party_id = COALESCE($3, party_id), hourly_rate_minor = COALESCE($4, hourly_rate_minor), budget_minor = COALESCE($5, budget_minor), notes = COALESCE($6, notes), status = COALESCE($7, status) WHERE id = $1`,
    [id, p.name?.trim() || null, p.customerId ?? null, p.hourlyRate === undefined ? null : toPaise(p.hourlyRate), p.budget === undefined ? null : toPaise(p.budget), p.notes ?? null, p.status ?? null]);
  await audit(c, orgId, { actor, action: 'project.updated', entityType: 'project', entityId: id, detail: { status: p.status ?? null } });
};

/** Goods you count in stock reach a project when they are issued to it, so the part of a bill that bought them is left out here (it would be counted twice). */
const COUNTED = `COALESCE((SELECT SUM(l.taxable_minor) FROM document_lines l JOIN items i ON i.id = l.item_id AND i.track_stock WHERE l.document_id = d.id), 0)`;

/** Hours, money billed, money spent. Revenue and cost are before GST: invoices less credit notes, bills less debit notes, and tagged expenses that were not reversed. */
const SUMMARY = `
  SELECT p.id, p.name, p.code, p.party_id, (SELECT name FROM parties x WHERE x.id = p.party_id) AS customer, p.status, p.hourly_rate_minor, p.budget_minor, p.notes,
    COALESCE((SELECT SUM(minutes) FROM time_entries t WHERE t.project_id = p.id), 0)::int AS minutes,
    COALESCE((SELECT SUM(minutes) FROM time_entries t WHERE t.project_id = p.id AND t.billable), 0)::int AS billable_minutes,
    COALESCE((SELECT SUM(minutes) FROM time_entries t WHERE t.project_id = p.id AND t.billable AND t.invoice_id IS NULL), 0)::int AS unbilled_minutes,
    COALESCE((SELECT SUM(ROUND(t.minutes::numeric * t.rate_minor / 60)) FROM time_entries t WHERE t.project_id = p.id AND t.billable AND t.invoice_id IS NULL), 0)::bigint AS unbilled_minor,
    COALESCE((SELECT SUM(CASE d.kind WHEN 'INVOICE' THEN d.subtotal_minor ELSE -d.subtotal_minor END) FROM documents d WHERE d.project_id = p.id AND d.status = 'ISSUED' AND d.kind IN ('INVOICE', 'CREDIT_NOTE')), 0)::bigint AS invoiced_minor,
    COALESCE((SELECT SUM(CASE d.kind WHEN 'BILL' THEN 1 ELSE -1 END * (d.subtotal_minor - ${COUNTED})) FROM documents d WHERE d.project_id = p.id AND d.status = 'ISSUED' AND d.kind IN ('BILL', 'DEBIT_NOTE')), 0)::bigint AS bills_minor,
    COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a JOIN documents d ON d.id = a.document_id WHERE d.project_id = p.id AND d.kind = 'INVOICE' AND d.status = 'ISSUED' AND a.source_type = 'PAYMENT' AND a.voided_at IS NULL), 0)::bigint AS receipts_minor,
    COALESCE((SELECT SUM(l.base_amount_minor) FROM project_expenses x JOIN journal_lines l ON l.entry_id = x.entry_id AND l.side = 'D' JOIN accounts a ON a.id = l.account_id AND a.type = 'EXPENSE'
               WHERE x.project_id = p.id AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = x.entry_id)), 0)::bigint AS expenses_minor
    FROM projects p`;

const withProfit = <T extends { invoiced_minor: bigint; bills_minor: bigint; expenses_minor: bigint; budget_minor: bigint }>(r: T) => ({
  ...r, cost_minor: r.bills_minor + r.expenses_minor, profit_minor: r.invoiced_minor - r.bills_minor - r.expenses_minor,
  budget_left_minor: r.budget_minor > 0n ? r.budget_minor - r.bills_minor - r.expenses_minor : null
});

export const listProjects = async (c: Db, status?: string) => (await c.query(`${SUMMARY} WHERE ($1::text IS NULL OR p.status = $1) ORDER BY (p.status = 'ACTIVE') DESC, p.id DESC LIMIT 500`, [status ?? null])).rows.map(withProfit);

export const getProject = async (c: Db, id: bigint) => {
  const p = (await c.query(`${SUMMARY} WHERE p.id = $1`, [id])).rows[0];
  if (!p) return null;
  const time = (await c.query(
    `SELECT id, work_date::text AS date, minutes, notes, billable, rate_minor, invoice_id, created_by, ROUND(minutes::numeric * rate_minor / 60)::bigint AS amount_minor FROM time_entries WHERE project_id = $1 ORDER BY work_date DESC, id DESC LIMIT 500`, [id])).rows;
  const documents = (await c.query(`SELECT id, kind, number, status, issue_date::text AS date, subtotal_minor, total_minor FROM documents WHERE project_id = $1 ORDER BY id DESC LIMIT 200`, [id])).rows;
  const expenses = (await c.query(
    `SELECT e.id, e.entry_no, e.posting_date::text AS date, e.memo, (SELECT COALESCE(SUM(l.base_amount_minor), 0)::bigint FROM journal_lines l JOIN accounts a ON a.id = l.account_id AND a.type = 'EXPENSE' WHERE l.entry_id = e.id AND l.side = 'D') AS amount_minor,
            EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = e.id) AS reversed
       FROM project_expenses x JOIN journal_entries e ON e.id = x.entry_id WHERE x.project_id = $1 ORDER BY e.posting_date DESC, e.id DESC`, [id])).rows;
  // where the money went: bills and debit notes by their kind of cost, expenses and stock issued to the project by theirs; the parts add up to cost_minor
  const parts = (await c.query(
    `SELECT category, SUM(amount)::bigint AS amount_minor FROM (
       SELECT COALESCE(d.project_category, 'Materials') AS category, CASE d.kind WHEN 'BILL' THEN 1 ELSE -1 END * (d.subtotal_minor - ${COUNTED}) AS amount
         FROM documents d WHERE d.project_id = $1 AND d.status = 'ISSUED' AND d.kind IN ('BILL', 'DEBIT_NOTE')
       UNION ALL
       SELECT COALESCE(x.category, 'Other'), SUM(l.base_amount_minor) FROM project_expenses x JOIN journal_lines l ON l.entry_id = x.entry_id AND l.side = 'D' JOIN accounts a ON a.id = l.account_id AND a.type = 'EXPENSE'
        WHERE x.project_id = $1 AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = x.entry_id) GROUP BY x.entry_id, x.category
     ) t GROUP BY category HAVING SUM(amount) <> 0`, [id])).rows as { category: string; amount_minor: bigint }[];
  const total = parts.reduce((a, r) => a + r.amount_minor, 0n);
  const breakdown = COST_TYPES.map((k) => parts.find((r) => r.category === k)).filter((r): r is { category: string; amount_minor: bigint } => Boolean(r))
    .map((r) => ({ category: r.category, amount_minor: r.amount_minor, share_bp: total > 0n ? Number((r.amount_minor * 10_000n) / total) : 0 }));
  return { ...withProfit(p), time, documents, expenses, breakdown };
};

/** "1.5" is an hour and a half; "1:30" is too. */
export const parseMinutes = (text: string): number => {
  const t = text.trim();
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  const dec = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(t);
  const m = hm ? Number(hm[1]) * 60 + Number(hm[2]) : dec ? Math.round(Number(`${dec[1]}.${dec[2] ?? '0'}`) * 60) : 0;
  if (m < 1 || m > 1440) throw new LedgerError('bad_hours', `${text} is not a time between a minute and a day (like 1.5 or 1:30)`);
  return m;
};

export const addTime = async (c: Db, orgId: bigint, projectId: bigint, t: { date: string; hours: string; notes?: string; billable?: boolean; rate?: string }, actor: string): Promise<bigint> => {
  const p = (await c.query(`SELECT status, hourly_rate_minor FROM projects WHERE id = $1`, [projectId])).rows[0];
  if (!p) throw gone();
  if (p.status === 'ARCHIVED') throw new LedgerError('archived', 'this project is archived; reopen it to log time');
  const minutes = parseMinutes(t.hours);
  const rate = t.rate === undefined ? (p.hourly_rate_minor as bigint) : toPaise(t.rate);
  const id = (await c.query(
    `INSERT INTO time_entries (organization_id, project_id, work_date, minutes, notes, billable, rate_minor, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [orgId, projectId, t.date, minutes, t.notes?.trim().slice(0, 300) || null, t.billable ?? true, rate, actor])).rows[0].id as bigint;
  await audit(c, orgId, { actor, action: 'project.time_logged', entityType: 'project', entityId: projectId, detail: { minutes } });
  return id;
};

export const deleteTime = async (c: Db, orgId: bigint, id: bigint, actor: string): Promise<void> => {
  const t = (await c.query(`SELECT project_id, invoice_id FROM time_entries WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!t) throw new LedgerError('not_found', 'no such time entry');
  if (t.invoice_id) throw new LedgerError('billed', 'this time is on an invoice; delete or void the invoice first');
  await c.query(`DELETE FROM time_entries WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'project.time_deleted', entityType: 'project', entityId: t.project_id as bigint });
};

const hoursText = (minutes: number): string => { const milli = Math.round((minutes * 1000) / 60); return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`; };

/** Unbilled billable time becomes a draft invoice to the project's customer, one line per entry. The time is marked billed; deleting or voiding the invoice frees it again. */
export const invoiceTime = async (c: Db, orgId: bigint, projectId: bigint, o: { date: string; taxCode: string; entryIds?: bigint[] }, actor: string) => {
  const p = (await c.query(`SELECT name, party_id FROM projects WHERE id = $1 FOR UPDATE`, [projectId])).rows[0];
  if (!p) throw gone();
  if (!p.party_id) throw new LedgerError('no_customer', 'choose the customer for this project first');
  const entries = (await c.query(
    `SELECT id, work_date::text AS date, minutes, notes, rate_minor FROM time_entries WHERE project_id = $1 AND billable AND invoice_id IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2)) ORDER BY work_date, id FOR UPDATE`, [projectId, o.entryIds ?? null])).rows;
  if (!entries.length) throw new LedgerError('nothing_to_bill', 'there is no unbilled billable time');
  if (o.entryIds && entries.length !== o.entryIds.length) throw new LedgerError('not_billable', 'some of that time is already billed, not billable, or belongs to another project');
  const id = await saveDraft(c, orgId, null, {
    kind: 'INVOICE', partyId: p.party_id as bigint, date: o.date, projectId, memo: `${p.name}`,
    lines: entries.map((e) => ({
      description: `${e.notes || 'Work'} (${e.date})`, quantity: hoursText(e.minutes as number),
      unitPrice: paiseToString(e.rate_minor as bigint), taxCode: o.taxCode, unit: 'HRS'
    }))
  }, actor);
  await c.query(`UPDATE time_entries SET invoice_id = $2 WHERE id = ANY($1)`, [entries.map((e) => e.id), id]);
  await audit(c, orgId, { actor, action: 'project.invoiced', entityType: 'project', entityId: projectId, detail: { invoiceId: String(id), entries: entries.length } });
  return { id, entries: entries.length };
};
