/*
 * Loyalty: "every Nth visit, this item is free", keyed by mobile number.
 *
 * Progress is derived from loyalty_events, never stored as a counter:
 *   stamps = VISIT events (not voided) since the customer's last REDEEM.
 * With visits_required = 7, six stamps make the seventh visit the free one.
 * One event per customer per day, so a table that splits its bill still
 * counts as a single visit. Cancelling an invoice voids its events, and the
 * card is exactly as it was.
 */

/** A phone as its last 10 digits ("+91 98765-43210" -> "9876543210"), or null if it can't be a mobile number. */
export const normalisePhone = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

const MOBILE_SQL = `RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10)`;

export const findCustomerByPhone = async (db, businessId, phone) => {
  const mobile = normalisePhone(phone);
  if (!mobile) return null;
  return (await db.query(
    `SELECT customer_id, name, phone FROM customers WHERE business_id = $1 AND status = 'ACTIVE' AND ${MOBILE_SQL} = $2 ORDER BY customer_id LIMIT 1`,
    [businessId, mobile]
  )).rows[0] || null;
};

export const getProgram = async (db, businessId) => (await db.query(
  `SELECT lp.*, p.name AS reward_name, p.selling_price_paise AS reward_price_paise
   FROM loyalty_programs lp LEFT JOIN products p ON p.product_id = lp.reward_product_id WHERE lp.business_id = $1`,
  [businessId]
)).rows[0] || null;

/** The program only works when it is switched on and has a reward item. */
export const isLive = (program) => Boolean(program?.is_enabled && program.reward_product_id);

/**
 * Where a customer stands on `date`.
 *   stamps        stamps on the card now
 *   reward_ready  the reward applies to a bill on `date` (enough stamps from earlier days, none redeemed today)
 *   day_event     today's event kind, if the customer has already been counted today
 */
export const progressFor = async (db, businessId, customerId, program, date) => {
  const rows = (await db.query(
    `SELECT kind, visit_date::text AS visit_date FROM loyalty_events
     WHERE business_id = $1 AND customer_id = $2 AND voided_at IS NULL ORDER BY visit_date, event_id`,
    [businessId, customerId]
  )).rows;
  let stamps = 0; let before = 0; let redeemed = 0; let visits = 0; let last = null;
  for (const e of rows) {
    if (e.kind === 'REDEEM') { stamps = 0; before = 0; redeemed++; }
    else { stamps++; visits++; if (e.visit_date < date) before++; }
    last = e.visit_date;
  }
  const today = rows.find((e) => e.visit_date === date) || null;
  return {
    stamps, visits, rewards_redeemed: redeemed, last_visit: last, day_event: today?.kind ?? null,
    reward_ready: before >= program.visits_required - 1 && today?.kind !== 'REDEEM'
  };
};

/** What a screen shows: the card in words. */
export const describe = (program, progress) => {
  const need = program.visits_required - 1;
  const item = `${program.reward_quantity > 1 ? `${program.reward_quantity} × ` : ''}${program.reward_name}`;
  const togo = Math.max(0, need - progress.stamps);
  return {
    visits_required: program.visits_required, stamps: Math.min(progress.stamps, need), reward_item: item,
    reward_ready: progress.reward_ready, visits_to_go: togo,
    message: progress.reward_ready
      ? `Free ${item} on this visit!`
      : togo === 0
        ? `Free ${item} on your next visit!`
        : `${togo} more visit${togo === 1 ? '' : 's'}, then ${item} is free.`
  };
};

/**
 * Record an invoice against the card. `redeemed` = the free item was applied to it.
 * Called inside the billing transaction, after the invoice exists.
 */
export const recordEvent = async (client, { businessId, customerId, invoiceId, date, redeemed, amountPaise = 0 }) => {
  if (redeemed) {
    // Today's earlier stamp (if any) becomes the reward visit rather than a second event.
    const upgraded = await client.query(
      `UPDATE loyalty_events SET kind = 'REDEEM', invoice_id = $3, amount_paise = $4
       WHERE business_id = $5 AND customer_id = $1 AND visit_date = $2 AND voided_at IS NULL`,
      [customerId, date, invoiceId, amountPaise, businessId]
    );
    if (upgraded.rowCount) return;
    await client.query(
      `INSERT INTO loyalty_events (business_id, customer_id, invoice_id, kind, visit_date, amount_paise) VALUES ($1,$2,$3,'REDEEM',$4,$5)`,
      [businessId, customerId, invoiceId, date, amountPaise]
    );
    return;
  }
  await client.query(
    `INSERT INTO loyalty_events (business_id, customer_id, invoice_id, kind, visit_date) VALUES ($1,$2,$3,'VISIT',$4)
     ON CONFLICT (customer_id, visit_date) WHERE voided_at IS NULL DO NOTHING`,
    [businessId, customerId, invoiceId, date]
  );
};

/** Undo everything an invoice did to loyalty and coupons (used when it is cancelled). */
export const voidForInvoice = async (client, businessId, invoiceId) => {
  await client.query(`UPDATE loyalty_events SET voided_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND invoice_id = $2 AND voided_at IS NULL`, [businessId, invoiceId]);
  await client.query(`UPDATE coupon_redemptions SET voided_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND invoice_id = $2 AND voided_at IS NULL`, [businessId, invoiceId]);
};
