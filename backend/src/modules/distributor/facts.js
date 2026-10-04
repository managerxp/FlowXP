/*
 * One definition of "what was sold": a row per invoice line, net of the credit notes issued against it, carrying
 * everything a distributor slices sales by — salesperson, territory, beat, customer, brand, principal, category,
 * product — and whether the line was a paid line or free goods.
 *
 * Targets, commission, the dashboard and the distributor reports all read this, so a target's "actual", a
 * salesperson's commission and the sales report for the same period cannot disagree.
 *
 *   revenue  = line value before GST − credit notes against the line          (paise)
 *   cost     = cost of what was sold − cost of what came back                   (paise)
 *   units    = quantity in BASE units − base units returned
 *   paid     = false for a free-goods line (price 0): it costs money and earns none
 */
export const FACTS = `(
  SELECT i.business_id, i.branch_id, i.invoice_id, i.invoice_date, i.customer_id,
         m.salesperson_id, o.beat_id, COALESCE(o.territory_id, w.territory_id) AS territory_id, COALESCE(o.source, 'OFFICE') AS source,
         ii.item_id, ii.product_id, p.brand_id, d.principal_id, p.category_id, d.subcategory_id,
         (ii.unit_price_paise > 0) AS paid,
         ii.quantity * ii.unit_factor - COALESCE(cn.units, 0) AS units,
         (ii.line_total_paise - ii.tax_amount_paise) - COALESCE(cn.revenue, 0) AS revenue,
         ii.quantity * ii.unit_cost_paise - COALESCE(cn.cost, 0) AS cost
  FROM invoice_items ii
  JOIN invoices i ON i.invoice_id = ii.invoice_id AND i.status = 'ISSUED'
  JOIN products p ON p.product_id = ii.product_id
  LEFT JOIN wholesale_item_details d ON d.product_id = ii.product_id
  LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
  LEFT JOIN wholesale_sales_orders o ON o.order_id = m.order_id
  LEFT JOIN wholesale_customer_profiles w ON w.customer_id = i.customer_id
  LEFT JOIN LATERAL (
    SELECT SUM(ci.quantity * ii.unit_factor) AS units, SUM(ci.line_total_paise - ci.tax_amount_paise) AS revenue, SUM(ci.quantity * ii.unit_cost_paise) AS cost
    FROM credit_note_items ci WHERE ci.invoice_item_id = ii.item_id
  ) cn ON TRUE
) f`;

/** SQL predicate on the FACTS alias `f` for a target / filter scope. `$n` is the placeholder holding the id (or id list for territory). */
export const scopePredicate = (scopeType, ph) => ({
  BUSINESS: 'TRUE',
  SALESPERSON: `f.salesperson_id = ${ph}`,
  TERRITORY: `f.territory_id = ANY(${ph}::int[])`,
  BRAND: `f.brand_id = ${ph}`,
  CATEGORY: `(f.category_id = ${ph} OR f.subcategory_id = ${ph})`,
  PRODUCT: `f.product_id = ${ph}`,
  CUSTOMER: `f.customer_id = ${ph}`,
  PRINCIPAL: `f.principal_id = ${ph}`
}[scopeType]);
