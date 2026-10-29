import type { Db } from './db.ts';
import { LedgerError } from './ledger.ts';

/** A party's statement: documents and payments in date order with a running balance. Positive means they owe you, negative means you owe them.
    Voided documents and payments are left out. */
export const partyStatement = async (c: Db, partyId: bigint, from: string, to: string) => {
  const party = (await c.query(`SELECT id, name, gstin, kind FROM parties WHERE id = $1`, [partyId])).rows[0];
  if (!party) throw new LedgerError('not_found', 'no such party');
  const rows = (await c.query(
    `SELECT * FROM (
       SELECT d.issue_date::text AS date, d.id, CASE d.kind WHEN 'INVOICE' THEN 'Invoice' WHEN 'BILL' THEN 'Bill' ELSE 'Credit note' END AS type, COALESCE(d.number, '') AS number, d.supplier_ref AS reference,
              CASE d.kind WHEN 'INVOICE' THEN d.total_minor ELSE -d.total_minor END AS amount
         FROM documents d WHERE d.party_id = $1 AND d.status = 'ISSUED'
       UNION ALL
       SELECT p.pay_date::text, p.id, CASE p.direction WHEN 'IN' THEN 'Payment received' ELSE 'Payment made' END, p.number, p.reference,
              CASE p.direction WHEN 'IN' THEN -(p.amount_minor + p.tds_minor) ELSE p.amount_minor + p.tds_minor END
         FROM payments p WHERE p.party_id = $1 AND p.status = 'POSTED') x
      WHERE date <= $2::text ORDER BY date, type, id`, [partyId, to])).rows as { date: string; id: bigint; type: string; number: string; reference: string | null; amount: bigint }[];
  let balance = 0n;
  let opening = 0n;
  const lines: { date: string; type: string; number: string; reference: string | null; debit: bigint; credit: bigint; balance: bigint }[] = [];
  for (const r of rows) {
    const { date } = r;
    balance += r.amount;
    if (date < from) { opening = balance; continue; }
    lines.push({ date, type: r.type, number: r.number, reference: r.reference, debit: r.amount > 0n ? r.amount : 0n, credit: r.amount < 0n ? -r.amount : 0n, balance });
  }
  return { party, from, to, opening, lines, closing: balance };
};
