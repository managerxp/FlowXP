/*
 * The bill a customer opens from the link in their message. No session: the unguessable
 * share_token in the URL is the whole key, and it shows only that one bill.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';

/* GET /api/public/bill/:token */
export const bill = async (req, res) => {
  const inv = (await pool.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.subtotal_paise, i.discount_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
            i.round_off_paise, i.total_paise, i.amount_paid_paise, i.balance_due_paise, i.status,
            b.name AS business_name, b.currency, b.upi_vpa, b.gstin AS business_gstin, br.name AS outlet_name, br.gstin AS outlet_gstin
     FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN branches br ON br.branch_id = i.branch_id
     WHERE i.share_token = $1`, [String(req.params.token || '').slice(0, 40)])).rows[0];
  if (!inv) return res.status(404).json({ success: false, message: 'This bill link is not valid' });

  const items = (await pool.query(
    `SELECT description, quantity, line_total_paise FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [inv.invoice_id])).rows;
  const due = Number(inv.balance_due_paise);
  res.json({
    success: true,
    data: {
      business: inv.business_name, outlet: inv.outlet_name, gstin: inv.outlet_gstin || inv.business_gstin,
      invoice_number: inv.invoice_number, date: inv.invoice_date, status: inv.status, currency: inv.currency,
      items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), amount: toRupees(i.line_total_paise) })),
      subtotal: toRupees(inv.subtotal_paise), discount: toRupees(inv.discount_paise),
      cgst: toRupees(inv.cgst_paise), sgst: toRupees(inv.sgst_paise), igst: toRupees(inv.igst_paise), round_off: toRupees(inv.round_off_paise),
      total: toRupees(inv.total_paise), paid: toRupees(inv.amount_paid_paise), balance: toRupees(due),
      // a pay-now link only while something is still owed
      upi_link: inv.upi_vpa && due > 0 && inv.status === 'ISSUED'
        ? `upi://pay?pa=${encodeURIComponent(inv.upi_vpa)}&pn=${encodeURIComponent(inv.business_name)}&am=${toRupees(due).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoice_number)}` : null
    }
  });
};
