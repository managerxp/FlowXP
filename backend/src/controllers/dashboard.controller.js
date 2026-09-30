/*
 * The dashboard.
 *
 * Billing now exists, so today's sales, outstanding and low-stock counts are
 * real aggregates rather than the placeholder this file used to return. A
 * business three minutes into its trial genuinely has ₹0 in sales — that is
 * a true zero, not the dishonest one this file used to avoid by hiding the
 * numbers entirely.
 */
import pool from '../config/database.js';
import { subscriptionSummary } from '../modules/subscription.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { hasPermission } from '../middleware/auth.js';

const TREND_DAYS = 14;

/*
 * The parts of the dashboard that are really a sales report: the last two
 * weeks by day, this week's best sellers and the latest bills. Only for people
 * who may see reports; a cashier's dashboard keeps today's figures and what
 * needs attention.
 */
const salesDetail = async (businessId, today, branchSql, branchArgs) => {
  const from = addDaysISO(today, -(TREND_DAYS - 1));
  const weekFrom = addDaysISO(today, -6);
  const [byDay, top, recent] = await Promise.all([
    pool.query(
      `SELECT invoice_date::text AS d, COUNT(*)::int AS n, COALESCE(SUM(total_paise),0) AS t
         FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2 AND $3${branchSql.replace('$2', '$4')}
        GROUP BY invoice_date`,
      [businessId, from, today, ...branchArgs]
    ),
    pool.query(
      `SELECT ii.product_id, COALESCE(p.name, 'Item') AS name, SUM(ii.quantity) AS qty, SUM(ii.line_total_paise) AS revenue
         FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id LEFT JOIN products p ON p.product_id = ii.product_id
        WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3 AND ii.product_id IS NOT NULL${branchSql.replace('$2', '$4').replace('branch_id', 'i.branch_id')}
        GROUP BY ii.product_id, p.name ORDER BY revenue DESC LIMIT 5`,
      [businessId, weekFrom, today, ...branchArgs]
    ),
    pool.query(
      `SELECT i.invoice_id, i.invoice_number, i.total_paise, i.payment_status, i.created_at, c.name AS customer_name
         FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id
        WHERE i.business_id = $1 AND i.status = 'ISSUED'${branchSql.replace('branch_id', 'i.branch_id')}
        ORDER BY i.created_at DESC LIMIT 6`,
      [businessId, ...branchArgs]
    )
  ]);
  const got = new Map(byDay.rows.map((row) => [row.d, row]));
  return {
    trend: Array.from({ length: TREND_DAYS }, (_, k) => {
      const d = addDaysISO(from, k);
      const row = got.get(d);
      return { date: d, invoice_count: row ? row.n : 0, total: toRupees(row ? row.t : 0) };
    }),
    top_products: top.rows.map((row) => ({ product_id: row.product_id, name: row.name, quantity: Number(row.qty), revenue: toRupees(row.revenue) })),
    recent_invoices: recent.rows.map((row) => ({
      invoice_id: row.invoice_id, invoice_number: row.invoice_number, customer_name: row.customer_name,
      total: toRupees(row.total_paise), payment_status: row.payment_status, created_at: row.created_at
    }))
  };
};

/*
 * The path from signup to a working till. Each step is a real check against
 * the database, not a stored flag — a flag says "we told them to add a
 * product", a query says "they have one".
 */
const buildChecklist = (business, counts) => [
  {
    key: 'business_details',
    label: 'Add your business details',
    done: Boolean(business.address && business.phone),
    href: '/app/settings/business'
  },
  {
    key: 'tax_setup',
    label: business.gst_enabled ? 'GST configured' : 'Set up GST (optional)',
    done: !business.gst_enabled || Boolean(business.gstin),
    href: '/app/settings/tax'
  },
  {
    key: 'first_product',
    label: business.business_type && ['RESTAURANT', 'CAFE', 'CLOUD_KITCHEN', 'GAMING_CAFE', 'RACING'].includes(business.business_type) ? 'Add your menu (take a photo of it)' : 'Add your first product',
    done: counts.products > 0,
    href: '/app/products'
  },
  {
    key: 'first_customer',
    label: 'Add a customer',
    done: counts.customers > 0,
    href: '/app/customers',
    optional: true
  },
  {
    key: 'first_invoice',
    label: 'Create your first invoice',
    done: counts.invoices > 0,
    href: '/app/billing'
  }
];

/* ==========================================================================
   GET /api/dashboard
   ========================================================================== */
export const getDashboard = async (req, res) => {
  try {
    const businessId = req.tenant.businessId;
    const { rows } = await pool.query(`SELECT * FROM businesses WHERE business_id = $1`, [businessId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const business = rows[0];
    // Today's numbers follow the outlet being viewed; setup counts stay business-wide.
    const scopeId = req.tenant.scopeBranchId;
    const scoped = scopeId != null;
    const one = scoped ? [businessId, scopeId] : [businessId];
    const branchSql = scoped ? ' AND branch_id = $2' : '';

    // "Today" is the business's own date, the same one reports use.
    const todayDate = await businessToday(businessId);
    const yesterdayDate = addDaysISO(todayDate, -1);
    const dayArgs = scoped ? [businessId, scopeId] : [businessId];
    const daySql = (n) => `invoice_date = $${n}`;

    const [productCount, customerCount, invoiceCount, today, yesterday, outstanding, lowStock, openOrders] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [businessId]),
      pool.query(
        `SELECT COUNT(*)::int AS invoice_count, COALESCE(SUM(total_paise),0) AS total_paise
         FROM invoices WHERE business_id = $1 AND status = 'ISSUED'${branchSql} AND ${daySql(dayArgs.length + 1)}`,
        [...dayArgs, todayDate]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS invoice_count, COALESCE(SUM(total_paise),0) AS total_paise
         FROM invoices WHERE business_id = $1 AND status = 'ISSUED'${branchSql} AND ${daySql(dayArgs.length + 1)}`,
        [...dayArgs, yesterdayDate]
      ),
      pool.query(
        `SELECT COALESCE(SUM(balance_due_paise),0) AS balance_paise
         FROM invoices WHERE business_id = $1 AND status = 'ISSUED'${branchSql}`,
        one
      ),
      pool.query(
        scoped
          ? `SELECT COUNT(*)::int AS n FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2
             WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND COALESCE(bs.quantity, 0) <= p.min_stock`
          : `SELECT COUNT(*)::int AS n FROM products
             WHERE business_id = $1 AND track_inventory AND status = 'ACTIVE' AND current_stock <= min_stock`,
        one
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM orders WHERE business_id = $1 AND status IN ('OPEN','PREPARING','READY','SERVED')${branchSql}`,
        one
      )
    ]);

    const detail = hasPermission(req.tenant, 'reports') ? await salesDetail(businessId, todayDate, branchSql, scoped ? [scopeId] : []) : null;

    const counts = { products: productCount.rows[0].n, customers: customerCount.rows[0].n, invoices: invoiceCount.rows[0].n };
    const checklist = buildChecklist(business, counts);
    const requiredSteps = checklist.filter((s) => !s.optional);

    res.json({
      success: true,
      data: {
        business: {
          business_id: business.business_id,
          name: business.name,
          business_type: business.business_type,
          currency: business.currency,
          onboarding_step: business.onboarding_step
        },
        subscription: subscriptionSummary(business),
        setup: {
          checklist,
          complete: requiredSteps.every((s) => s.done),
          done_count: requiredSteps.filter((s) => s.done).length,
          total_count: requiredSteps.length
        },
        counts,
        metrics_available: true,
        metrics: {
          today: todayDate,
          today_sales: toRupees(today.rows[0].total_paise),
          today_invoice_count: today.rows[0].invoice_count,
          yesterday_sales: toRupees(yesterday.rows[0].total_paise),
          yesterday_invoice_count: yesterday.rows[0].invoice_count,
          open_orders: openOrders.rows[0].n,
          outstanding: toRupees(outstanding.rows[0].balance_paise),
          low_stock_count: lowStock.rows[0].n
        },
        // null when this person may not see reports
        sales: detail
      }
    });
  } catch (error) {
    console.error('[dashboard] failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load your dashboard' });
  }
};
