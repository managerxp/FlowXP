import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { issueDocument, saveDraft } from './documents.ts';
import { LedgerError } from './ledger.ts';
import { paiseToString, toPaise } from './money.ts';

/* Flats and plots sold in stages. A unit has a price; selling it fixes the buyer and a schedule of stages (a share of the price each). Raising a stage
   makes and issues an invoice to the buyer for that share, tagged to the project, so receipts, GST and the project dashboard work as for any invoice. */

const gone = (what: string) => new LedgerError('not_found', `no such ${what}`);

export const addUnit = async (c: Db, orgId: bigint, projectId: bigint, u: { name: string; price: string }, actor: string): Promise<bigint> => {
  if (!u.name.trim()) throw new LedgerError('name_required', 'give the unit a name or number');
  const price = toPaise(u.price);
  if (price <= 0n) throw new LedgerError('bad_amount', 'the price must be above zero');
  if (!(await c.query(`SELECT 1 FROM projects WHERE id = $1`, [projectId])).rowCount) throw gone('project');
  const row = (await c.query(`INSERT INTO project_units (organization_id, project_id, name, price_minor) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`, [orgId, projectId, u.name.trim().slice(0, 60), price])).rows[0];
  if (!row) throw new LedgerError('name_taken', `${u.name} is already a unit of this project`);
  await audit(c, orgId, { actor, action: 'unit.created', entityType: 'unit', entityId: row.id as bigint, detail: { name: u.name } });
  return row.id as bigint;
};

export type StageIn = { name: string; percent: number; dueDate?: string };

/** Sell the unit: fix the buyer and the stages. The stages must add up to 100%; the last one takes any rounding. */
export const sellUnit = async (c: Db, orgId: bigint, unitId: bigint, s: { partyId: bigint; taxCode?: string; date: string; stages: StageIn[] }, actor: string): Promise<void> => {
  const u = (await c.query(`SELECT price_minor, party_id, name FROM project_units WHERE id = $1 FOR UPDATE`, [unitId])).rows[0];
  if (!u) throw gone('unit');
  if (u.party_id) throw new LedgerError('already_sold', 'this unit already has a buyer');
  if (!(await c.query(`SELECT 1 FROM parties WHERE id = $1 AND kind IN ('CUSTOMER', 'BOTH')`, [s.partyId])).rowCount) throw new LedgerError('bad_customer', 'choose one of your customers');
  const bps = s.stages.map((x) => Math.round(x.percent * 100));
  if (!s.stages.length || bps.some((b) => !(b >= 1)) || bps.reduce((a, b) => a + b, 0) !== 10000) throw new LedgerError('bad_stages', 'the stages must be above zero and add up to 100%');
  const price = u.price_minor as bigint;
  let given = 0n;
  for (const [i, st] of s.stages.entries()) {
    const amount = i === s.stages.length - 1 ? price - given : (price * BigInt(bps[i]!)) / 10000n;
    given += amount;
    if (amount <= 0n) throw new LedgerError('bad_stages', 'a stage is too small to be above zero');
    await c.query(`INSERT INTO unit_stages (organization_id, unit_id, seq, name, share_bp, amount_minor, due_date) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, unitId, i + 1, st.name.trim().slice(0, 80) || `Stage ${i + 1}`, bps[i], amount, st.dueDate ?? null]);
  }
  await c.query(`UPDATE project_units SET party_id = $2, tax_code = $3, sold_on = $4 WHERE id = $1`, [unitId, s.partyId, s.taxCode || 'GST0', s.date]);
  await audit(c, orgId, { actor, action: 'unit.sold', entityType: 'unit', entityId: unitId, detail: { name: u.name, stages: s.stages.length } });
};

/** Ask the buyer for a stage: makes and issues the invoice. A stage whose invoice was voided can be raised again. */
export const raiseStage = async (c: Db, orgId: bigint, stageId: bigint, date: string, actor: string) => {
  const st = (await c.query(
    `SELECT s.id, s.name, s.amount_minor, s.due_date::text AS due_date, s.invoice_id, u.name AS unit, u.party_id, u.tax_code, u.project_id, (SELECT status FROM documents WHERE id = s.invoice_id) AS inv_status
       FROM unit_stages s JOIN project_units u ON u.id = s.unit_id WHERE s.id = $1 FOR UPDATE OF s`, [stageId])).rows[0];
  if (!st) throw gone('stage');
  if (st.invoice_id && st.inv_status !== 'VOID') throw new LedgerError('already_raised', 'this stage was already raised');
  const id = await saveDraft(c, orgId, null, {
    kind: 'INVOICE', partyId: st.party_id as bigint, date, dueDate: st.due_date ?? undefined, projectId: st.project_id as bigint, memo: `${st.unit}: ${st.name}`,
    lines: [{ description: `${st.unit} - ${st.name}`, quantity: '1', unitPrice: paiseToString(st.amount_minor as bigint), taxCode: st.tax_code as string }]
  }, actor);
  await issueDocument(c, orgId, 'INVOICE', id, actor);
  await c.query(`UPDATE unit_stages SET invoice_id = $2 WHERE id = $1`, [stageId, id]);
  await audit(c, orgId, { actor, action: 'unit.stage_raised', entityType: 'unit', entityId: stageId, detail: { invoiceId: String(id) } });
  return { id };
};

/** Each unit with its buyer, stages, and what has been asked for and received. */
export const listUnits = async (c: Db, projectId: bigint) => {
  const units = (await c.query(
    `SELECT u.id, u.name, u.price_minor, u.party_id, p.name AS buyer, u.sold_on::text AS sold_on FROM project_units u LEFT JOIN parties p ON p.id = u.party_id WHERE u.project_id = $1 ORDER BY u.name, u.id`, [projectId])).rows;
  const stages = (await c.query(
    `SELECT s.id, s.unit_id, s.seq, s.name, s.share_bp, s.amount_minor, s.due_date::text AS due_date,
            CASE WHEN d.status = 'ISSUED' THEN s.invoice_id END AS invoice_id, CASE WHEN d.status = 'ISSUED' THEN d.number END AS invoice_number,
            CASE WHEN d.status = 'ISSUED' THEN d.total_minor ELSE 0 END AS invoiced_minor, CASE WHEN d.status = 'ISSUED' THEN d.total_minor - d.balance_minor ELSE 0 END AS received_minor
       FROM unit_stages s JOIN project_units u ON u.id = s.unit_id LEFT JOIN documents d ON d.id = s.invoice_id WHERE u.project_id = $1 ORDER BY s.unit_id, s.seq`, [projectId])).rows;
  return units.map((u) => {
    const mine = stages.filter((s) => s.unit_id === u.id);
    const sum = (k: string) => mine.reduce((a, s) => a + (s[k] as bigint), 0n);
    return { ...u, status: u.party_id ? 'SOLD' : 'AVAILABLE', invoiced_minor: sum('invoiced_minor'), received_minor: sum('received_minor'), stages: mine };
  });
};
