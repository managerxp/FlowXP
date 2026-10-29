import type { Db } from './db.ts';

/* Who buys, what sells and how each month went. Sales are issued invoices less credit notes, before GST; voided and draft documents are left out. */

export const salesAnalysis = async (c: Db, from: string, to: string) => {
  const between = `d.status = 'ISSUED' AND d.issue_date BETWEEN $1::date AND $2::date`;
  const net = `CASE d.kind WHEN 'CREDIT_NOTE' THEN -d.subtotal_minor ELSE d.subtotal_minor END`;
  const customers = (await c.query(
    `SELECT p.id AS party_id, p.name AS party_name, SUM(${net})::bigint AS sales_minor, COUNT(*) FILTER (WHERE d.kind = 'INVOICE')::bigint AS invoices,
            COALESCE(SUM(d.balance_minor) FILTER (WHERE d.kind = 'INVOICE'), 0)::bigint AS owed_minor
       FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.kind IN ('INVOICE', 'CREDIT_NOTE') AND ${between}
      GROUP BY p.id, p.name ORDER BY sales_minor DESC LIMIT 10`, [from, to])).rows;
  const items = (await c.query(
    `SELECT COALESCE(i.name, l.description) AS name, SUM(l.taxable_minor)::bigint AS sales_minor, SUM(l.quantity_milli)::bigint AS quantity_milli, MIN(l.unit) AS unit
       FROM document_lines l JOIN documents d ON d.id = l.document_id LEFT JOIN items i ON i.id = l.item_id
      WHERE d.kind = 'INVOICE' AND ${between} GROUP BY COALESCE(i.name, l.description) ORDER BY sales_minor DESC LIMIT 10`, [from, to])).rows;
  const months = (await c.query(
    `SELECT to_char(date_trunc('month', d.issue_date), 'YYYY-MM') AS month,
            COALESCE(SUM(${net}) FILTER (WHERE d.kind IN ('INVOICE', 'CREDIT_NOTE')), 0)::bigint AS sales_minor,
            COALESCE(SUM(d.subtotal_minor) FILTER (WHERE d.kind = 'BILL'), 0)::bigint AS purchases_minor
       FROM documents d WHERE ${between} GROUP BY 1 ORDER BY 1`, [from, to])).rows;
  return { customers, items, months };
};
