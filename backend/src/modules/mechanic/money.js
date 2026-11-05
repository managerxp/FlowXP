/*
 * Money In and Money Out for a garage, one plain list each. Money In is what customers paid (against a bill or as an advance) and any other money received;
 * Money Out is what the garage spent (rent, salary, tea, tools) and what it paid its suppliers. It only reads the records the rest of FlowXP already keeps
 * (payments, other_income, expenses), so nothing is counted twice. Adding an entry uses the usual /payments, /other-income and /expenses routes.
 */
const sum = (rows) => rows.reduce((t, r) => t + r.amount_paise, 0);
const byMethod = (rows) => {
  const m = {}; for (const r of rows) m[r.method] = (m[r.method] || 0) + r.amount_paise;
  return m;
};

export const book = async (db, tenant, { from, to }) => {
  const scoped = tenant.scopeBranchId != null;
  const a = [tenant.businessId, from, to]; if (scoped) a.push(tenant.scopeBranchId);
  const sc = scoped ? ' AND branch_id = $4' : '';
  const pc = scoped ? ' AND p.branch_id = $4' : '';
  const q = async (sql) => (await db.query(sql, a)).rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) }));

  const customers = await q(
    `SELECT 'CUSTOMER' AS kind, p.payment_id::text AS ref_id, p.payment_date::text AS day, p.created_at, p.payment_method AS method, p.amount_paise,
            COALESCE(c.name, 'Customer') AS who, i.invoice_number AS note
       FROM payments p LEFT JOIN customers c ON c.customer_id = p.customer_id LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
      WHERE p.business_id = $1 AND p.payment_date BETWEEN $2::date AND $3::date AND p.po_id IS NULL AND p.supplier_id IS NULL AND p.payment_method <> 'CREDIT'${pc}
      ORDER BY p.payment_date DESC, p.payment_id DESC LIMIT 300`);
  const other = await q(
    `SELECT 'OTHER_IN' AS kind, income_id::text AS ref_id, income_date::text AS day, created_at, payment_method AS method, amount_paise, category AS who, description AS note
       FROM other_income WHERE business_id = $1 AND income_date BETWEEN $2::date AND $3::date${sc} ORDER BY income_date DESC, income_id DESC LIMIT 300`);
  const spent = await q(
    `SELECT 'EXPENSE' AS kind, expense_id::text AS ref_id, expense_date::text AS day, created_at, payment_method AS method, amount_paise, category AS who, description AS note
       FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2::date AND $3::date${sc} ORDER BY expense_date DESC, expense_id DESC LIMIT 300`);
  const suppliers = await q(
    `SELECT 'SUPPLIER' AS kind, p.payment_id::text AS ref_id, p.payment_date::text AS day, p.created_at, p.payment_method AS method, p.amount_paise,
            COALESCE(s.name, 'Supplier') AS who, po.po_number AS note
       FROM payments p LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id LEFT JOIN purchase_orders po ON po.po_id = p.po_id
      WHERE p.business_id = $1 AND p.payment_date BETWEEN $2::date AND $3::date AND (p.po_id IS NOT NULL OR p.supplier_id IS NOT NULL)${pc}
      ORDER BY p.payment_date DESC, p.payment_id DESC LIMIT 300`);

  const newest = (x, y) => (y.day === x.day ? new Date(y.created_at) - new Date(x.created_at) : y.day.localeCompare(x.day));
  const money_in = [...customers, ...other].sort(newest);
  const money_out = [...spent, ...suppliers].sort(newest);
  return {
    from, to,
    in: { total_paise: sum(money_in), by_method: byMethod(money_in), entries: money_in },
    out: { total_paise: sum(money_out), by_method: byMethod(money_out), entries: money_out },
    net_paise: sum(money_in) - sum(money_out),
    cash_net_paise: (byMethod(money_in).CASH || 0) - (byMethod(money_out).CASH || 0)
  };
};
