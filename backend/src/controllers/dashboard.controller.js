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
    label: business.business_type && ['RESTAURANT', 'CAFE', 'GAMING_CAFE', 'RACING'].includes(business.business_type) ? 'Add your menu (take a photo of it)' : 'Add your first product',
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

    const [productCount, customerCount, invoiceCount, today, outstanding, lowStock] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [businessId]),
      pool.query(
        `SELECT COUNT(*)::int AS invoice_count, COALESCE(SUM(total_paise),0) AS total_paise
         FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date = CURRENT_DATE${branchSql}`,
        one
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
      )
    ]);

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
          today_sales: toRupees(today.rows[0].total_paise),
          today_invoice_count: today.rows[0].invoice_count,
          outstanding: toRupees(outstanding.rows[0].balance_paise),
          low_stock_count: lowStock.rows[0].n
        }
      }
    });
  } catch (error) {
    console.error('[dashboard] failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load your dashboard' });
  }
};
