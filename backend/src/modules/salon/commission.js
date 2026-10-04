/*
 * Staff commission: how much a line earns the person who did it, recorded as a ledger.
 *
 * One row per commissionable invoice line, starting PENDING. A manager approves rows (PENDING -> APPROVED) and a
 * payout pays the approved ones (-> PAID). A cancelled invoice voids rows that have not been paid; a row that was
 * already paid is offset by a negative PENDING row, so the next payout nets it off rather than rewriting history.
 *
 * Rate, most specific first:
 *   1. the rate set for this person AND this service (salon_staff_services)
 *   2. the rate set on the service / product itself (salon_item_details)
 *   3. the person's own default: services use commission_type / commission_value, products and sales of
 *      packages, memberships and gift cards use product_commission_pct
 * A fixed amount is per unit performed; a percentage is of the line's base — its value after discounts and
 * without tax (NET) or before discounts (GROSS), as set in salon settings. Package and membership visits have a
 * zero price, so their base is the service's list price when "commission on package use" is on.
 */

/** Pick the rate for one line. Returns { type, value } (value 0 when nothing is configured). */
export const rateFor = ({ lineType, staff, staffService, item }) => {
  const isService = ['SERVICE', 'PACKAGE_USE', 'MEMBERSHIP_USE'].includes(lineType);
  if (isService && staffService?.commission_type) return { type: staffService.commission_type, value: Number(staffService.commission_value) };
  if ((lineType === 'SERVICE' || lineType === 'PRODUCT' || lineType === 'PACKAGE_USE' || lineType === 'MEMBERSHIP_USE') && item?.commission_type) {
    return { type: item.commission_type, value: Number(item.commission_value) };
  }
  if (isService) return { type: staff.commission_type, value: Number(staff.commission_value) };
  return { type: 'PERCENT', value: Number(staff.product_commission_pct) };
};

/** Commission in paise for a line. */
export const commissionAmount = ({ type, value }, { basePaise, quantity }) => {
  if (!(value > 0) || basePaise < 0) return 0;
  return type === 'FIXED' ? Math.round(value * 100 * quantity) : Math.round((basePaise * value) / 100);
};

/**
 * Write the commission rows for a new invoice. `lines` are { item_id, line_type, staff_id, quantity, base_paise,
 * product_id }. Staff and rates are read in one query per table.
 */
export const accrueCommissions = async (db, { businessId, branchId, invoiceId, earnedOn, lines }) => {
  const withStaff = lines.filter((l) => l.staff_id);
  if (!withStaff.length) return [];
  const staffIds = [...new Set(withStaff.map((l) => l.staff_id))];
  const productIds = [...new Set(withStaff.map((l) => l.product_id).filter(Boolean))];
  const staff = new Map((await db.query(
    `SELECT staff_id, commission_type, commission_value, product_commission_pct FROM salon_staff WHERE business_id = $1 AND staff_id = ANY($2::int[])`, [businessId, staffIds])).rows.map((s) => [s.staff_id, s]));
  const overrides = new Map((await db.query(
    `SELECT staff_id, product_id, commission_type, commission_value FROM salon_staff_services WHERE staff_id = ANY($1::int[]) AND product_id = ANY($2::int[])`, [staffIds, productIds])).rows.map((r) => [`${r.staff_id}:${r.product_id}`, r]));
  const items = new Map((await db.query(
    `SELECT product_id, commission_type, commission_value FROM salon_item_details WHERE product_id = ANY($1::int[])`, [productIds])).rows.map((r) => [r.product_id, r]));

  const written = [];
  for (const l of withStaff) {
    const s = staff.get(l.staff_id);
    if (!s) continue;
    const rate = rateFor({ lineType: l.line_type, staff: s, staffService: overrides.get(`${l.staff_id}:${l.product_id}`), item: items.get(l.product_id) });
    const amount = commissionAmount(rate, { basePaise: l.base_paise, quantity: l.quantity });
    if (amount <= 0) continue;
    const row = (await db.query(
      `INSERT INTO salon_commissions (business_id, branch_id, staff_id, invoice_id, invoice_item_id, line_type, base_paise, rate_type, rate, amount_paise, earned_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING commission_id, staff_id, amount_paise`,
      [businessId, branchId, l.staff_id, invoiceId, l.item_id, l.line_type, l.base_paise, rate.type, rate.value, amount, earnedOn])).rows[0];
    written.push(row);
  }
  return written;
};

/**
 * An invoice was cancelled: unpaid commission is voided; commission that was already paid out is offset by a
 * negative PENDING row so the next payout nets it off.
 */
export const reverseCommissions = async (db, businessId, invoiceId) => {
  await db.query(`UPDATE salon_commissions SET status = 'VOID' WHERE business_id = $1 AND invoice_id = $2 AND status IN ('PENDING','APPROVED') AND amount_paise > 0`, [businessId, invoiceId]);
  // what is still standing per line: paid rows plus any earlier negative offsets (the unpaid positives were just voided)
  const paid = (await db.query(
    `SELECT staff_id, branch_id, invoice_item_id, line_type, SUM(amount_paise)::bigint AS net FROM salon_commissions
     WHERE business_id = $1 AND invoice_id = $2 AND status <> 'VOID'
     GROUP BY staff_id, branch_id, invoice_item_id, line_type`, [businessId, invoiceId])).rows;
  for (const r of paid) {
    const net = Number(r.net);
    if (net <= 0) continue;
    await db.query(
      `INSERT INTO salon_commissions (business_id, branch_id, staff_id, invoice_id, invoice_item_id, line_type, base_paise, rate_type, rate, amount_paise, earned_on)
       VALUES ($1,$2,$3,$4,$5,$6,0,'FIXED',0,$7,(CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date)`,
      [businessId, r.branch_id, r.staff_id, invoiceId, r.invoice_item_id, r.line_type, -net]);
  }
};
