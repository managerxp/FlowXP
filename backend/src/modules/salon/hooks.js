/*
 * What the rest of FlowXP tells the salon module when an invoice is taken back.
 *
 *   onInvoiceCancelled   the whole invoice is void: package visits and membership benefits used on it are handed
 *                        back, gift card money returns to the card, offers can be used again, commission is
 *                        voided (or offset if already paid), the appointment reopens, and anything the invoice
 *                        SOLD (a package, a membership, a gift card) is withdrawn — unless it has been used,
 *                        in which case the cancellation is refused with a clear message
 *   onCreditNote         part of an invoice is credited: commission shrinks with the credited share, and a sold
 *                        package / membership / gift card that is credited in full is withdrawn (same rule)
 *
 * Both run inside the caller's transaction. They are no-ops for an invoice the salon module did not create, so
 * the shared cancel and credit-note code can call them without checking.
 */
import { reverseCommissions } from './commission.js';
import { SalonError } from './common.js';

/** Withdraw what one invoice line sold. Refuses when the package / membership / gift card has already been used. */
const withdraw = async (client, businessId, line, userId) => {
  if (line.line_type === 'PACKAGE' && line.ref_id) {
    const used = Number((await client.query(`SELECT COUNT(*) AS n FROM salon_package_usage WHERE cp_id = $1 AND voided_at IS NULL`, [line.ref_id])).rows[0].n);
    if (used) throw new SalonError(409, 'A package sold on this bill has already been used, so the bill cannot be taken back. Adjust the package instead.');
    await client.query(`UPDATE salon_customer_packages SET status = 'CANCELLED' WHERE cp_id = $1 AND business_id = $2`, [line.ref_id, businessId]);
  }
  if (line.line_type === 'MEMBERSHIP' && line.ref_id) {
    const used = Number((await client.query(`SELECT COUNT(*) AS n FROM salon_membership_usage WHERE membership_id = $1 AND kind = 'FREE_SERVICE' AND voided_at IS NULL`, [line.ref_id])).rows[0].n);
    if (used) throw new SalonError(409, 'A membership sold on this bill has already been used, so the bill cannot be taken back. Cancel the membership instead.');
    await client.query(`UPDATE salon_customer_memberships SET status = 'CANCELLED' WHERE membership_id = $1 AND business_id = $2`, [line.ref_id, businessId]);
  }
  if (line.line_type === 'GIFT_CARD' && line.ref_id) {
    const card = (await client.query(`SELECT card_id, initial_paise, balance_paise FROM salon_gift_cards WHERE card_id = $1 AND business_id = $2 FOR UPDATE`, [line.ref_id, businessId])).rows[0];
    if (card && Number(card.balance_paise) !== Number(card.initial_paise)) throw new SalonError(409, 'A gift card sold on this bill has already been spent from, so the bill cannot be taken back.');
    if (card) {
      await client.query(`UPDATE salon_gift_cards SET status = 'CANCELLED', balance_paise = 0 WHERE card_id = $1`, [card.card_id]);
      await client.query(`INSERT INTO salon_gift_card_txns (card_id, business_id, kind, amount_paise, balance_after_paise, invoice_id, note, created_by) VALUES ($1,$2,'ADJUST',$3,0,$4,'Sale cancelled',$5)`, [card.card_id, businessId, -Number(card.initial_paise), line.invoice_id, userId]);
    }
  }
};

export const onInvoiceCancelled = async (client, { businessId, invoiceId, userId = null }) => {
  const lines = (await client.query(`SELECT * FROM salon_invoice_lines WHERE invoice_id = $1 AND business_id = $2`, [invoiceId, businessId])).rows;
  const touched = lines.length || (await client.query(`SELECT 1 FROM salon_gift_card_txns WHERE invoice_id = $1 AND business_id = $2 LIMIT 1`, [invoiceId, businessId])).rows.length;
  if (!touched) return;

  // what this bill USED comes back first, so a package sold and used on the same bill can still be withdrawn
  const usage = (await client.query(`UPDATE salon_package_usage SET voided_at = CURRENT_TIMESTAMP WHERE invoice_id = $1 AND business_id = $2 AND voided_at IS NULL RETURNING cp_id, service_id, quantity`, [invoiceId, businessId])).rows;
  for (const u of usage) {
    await client.query(`UPDATE salon_customer_package_items SET qty_used = GREATEST(0, qty_used - $3) WHERE cp_id = $1 AND service_id = $2`, [u.cp_id, u.service_id, u.quantity]);
  }
  await client.query(`UPDATE salon_membership_usage SET voided_at = CURRENT_TIMESTAMP WHERE invoice_id = $1 AND business_id = $2 AND voided_at IS NULL`, [invoiceId, businessId]);
  await client.query(`UPDATE salon_offer_redemptions SET voided_at = CURRENT_TIMESTAMP WHERE invoice_id = $1 AND business_id = $2 AND voided_at IS NULL`, [invoiceId, businessId]);

  // gift card money spent on this bill goes back onto the card, once
  const spent = (await client.query(
    `SELECT t.card_id, -SUM(t.amount_paise) FILTER (WHERE t.kind = 'REDEEM') AS redeemed, COALESCE(SUM(t.amount_paise) FILTER (WHERE t.kind = 'REFUND'), 0) AS refunded
     FROM salon_gift_card_txns t WHERE t.invoice_id = $1 AND t.business_id = $2 GROUP BY t.card_id`, [invoiceId, businessId])).rows;
  for (const s of spent) {
    const back = Number(s.redeemed || 0) - Number(s.refunded);
    if (back <= 0) continue;
    const card = (await client.query(`SELECT balance_paise, status FROM salon_gift_cards WHERE card_id = $1 FOR UPDATE`, [s.card_id])).rows[0];
    if (!card) continue;
    const after = Number(card.balance_paise) + back;
    await client.query(`UPDATE salon_gift_cards SET balance_paise = $2 WHERE card_id = $1`, [s.card_id, after]);
    await client.query(`INSERT INTO salon_gift_card_txns (card_id, business_id, kind, amount_paise, balance_after_paise, invoice_id, note, created_by) VALUES ($1,$2,'REFUND',$3,$4,$5,'Sale cancelled',$6)`, [s.card_id, businessId, back, after, invoiceId, userId]);
  }

  for (const l of lines) await withdraw(client, businessId, l, userId);
  await reverseCommissions(client, businessId, invoiceId);
  await client.query(`UPDATE salon_appointments SET status = 'IN_SERVICE', invoice_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE invoice_id = $1 AND business_id = $2 AND status = 'COMPLETED'`, [invoiceId, businessId]);
};

export const onCreditNote = async (client, { businessId, invoiceId, userId = null }) => {
  const lines = (await client.query(
    `SELECT sl.*, ii.quantity AS qty, COALESCE((SELECT SUM(c.quantity) FROM credit_note_items c WHERE c.invoice_item_id = sl.item_id), 0) AS credited
     FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id WHERE sl.invoice_id = $1 AND sl.business_id = $2`, [invoiceId, businessId])).rows;
  for (const l of lines) {
    const qty = Number(l.qty); const credited = Number(l.credited);
    const fraction = Math.max(0, (qty - credited) / qty);
    const rows = (await client.query(`SELECT * FROM salon_commissions WHERE invoice_item_id = $1 AND status <> 'VOID' AND amount_paise > 0 ORDER BY commission_id`, [l.item_id])).rows;
    for (const r of rows) {
      const target = r.rate_type === 'FIXED' ? Math.round(Number(r.rate) * 100 * qty * fraction) : Math.round((Number(r.base_paise) * fraction * Number(r.rate)) / 100);
      if (r.status === 'PAID') {
        // already paid out: offset what the credit takes back, less whatever earlier credits already offset
        const offset = Number((await client.query(`SELECT COALESCE(SUM(-amount_paise), 0) AS n FROM salon_commissions WHERE invoice_item_id = $1 AND staff_id = $2 AND amount_paise < 0 AND status <> 'VOID'`, [l.item_id, r.staff_id])).rows[0].n);
        const delta = Number(r.amount_paise) - target - offset;
        if (delta > 0) {
          await client.query(
            `INSERT INTO salon_commissions (business_id, branch_id, staff_id, invoice_id, invoice_item_id, line_type, base_paise, rate_type, rate, amount_paise, earned_on)
             VALUES ($1,$2,$3,$4,$5,$6,0,'FIXED',0,$7,(CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date)`, [businessId, r.branch_id, r.staff_id, invoiceId, l.item_id, r.line_type, -delta]);
        }
      } else if (target <= 0) {
        await client.query(`UPDATE salon_commissions SET status = 'VOID' WHERE commission_id = $1`, [r.commission_id]);
      } else {
        await client.query(`UPDATE salon_commissions SET amount_paise = $2 WHERE commission_id = $1`, [r.commission_id, target]);
      }
    }
    // a package / membership / gift card credited in full is withdrawn (or the credit refused if it has been used)
    if (['PACKAGE', 'MEMBERSHIP', 'GIFT_CARD'].includes(l.line_type) && credited >= qty - 1e-9) await withdraw(client, businessId, l, userId);
  }
};
