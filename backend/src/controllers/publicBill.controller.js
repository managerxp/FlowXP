/*
 * The bill a customer opens from the link in their message. No session: the unguessable
 * share_token in the URL is the whole key, and it shows only that one bill.
 *
 * The same page also carries the "rate your visit" prompt (owner's request, 2026-09-29,
 * customer_feedback — migration 0045): one bill, one rating. A happy rating (4-5) is
 * asked to also post it on Google (the owner's own share link, no API); an unhappy one
 * stays private here — see modules/ai/tools.js's feedback_summary and
 * reviews.controller.js for what an owner does with it afterward.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { effectiveFeatureFlags } from '../modules/planFeatures.js';

const findByToken = (token) => pool.query(
  `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.subtotal_paise, i.discount_paise, i.cgst_paise, i.sgst_paise, i.igst_paise,
          i.round_off_paise, i.total_paise, i.amount_paid_paise, i.balance_due_paise, i.status, i.business_id, i.branch_id, i.customer_id,
          b.name AS business_name, b.business_type, b.currency, b.upi_vpa, b.gstin AS business_gstin, b.google_review_link,
          br.name AS outlet_name, br.gstin AS outlet_gstin,
          COALESCE(pv.feature_flags, p.feature_flags, '{}'::jsonb) AS plan_feature_flags,
          btf.feature_flags AS type_feature_flags,
          COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides,
          cf.rating AS feedback_rating, cf.comment AS feedback_comment
   FROM invoices i
   JOIN businesses b ON b.business_id = i.business_id
   LEFT JOIN branches br ON br.branch_id = i.branch_id
   LEFT JOIN plans p ON p.plan_code = b.plan_code
   LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
   LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
   LEFT JOIN LATERAL (
     SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
     WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
   ) bfo ON true
   LEFT JOIN customer_feedback cf ON cf.invoice_id = i.invoice_id
   WHERE i.share_token = $1`, [String(token || '').slice(0, 40)]
);

const reviewsOn = (inv) => effectiveFeatureFlags([inv.plan_feature_flags, inv.type_feature_flags], inv.feature_overrides, inv.business_type).reviews !== false;

/* GET /api/public/bill/:token */
export const bill = async (req, res) => {
  const inv = (await findByToken(req.params.token)).rows[0];
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
        ? `upi://pay?pa=${encodeURIComponent(inv.upi_vpa)}&pn=${encodeURIComponent(inv.business_name)}&am=${toRupees(due).toFixed(2)}&cu=INR&tn=${encodeURIComponent(inv.invoice_number)}` : null,
      feedback_enabled: inv.status !== 'CANCELLED' && reviewsOn(inv),
      feedback: inv.feedback_rating != null ? { rating: inv.feedback_rating, comment: inv.feedback_comment } : null
    }
  });
};

/* POST /api/public/bill/:token/feedback { rating, comment? } */
export const submitFeedback = async (req, res) => {
  const inv = (await findByToken(req.params.token)).rows[0];
  if (!inv) return res.status(404).json({ success: false, message: 'This bill link is not valid' });
  if (inv.status === 'CANCELLED' || !reviewsOn(inv)) return res.status(404).json({ success: false, message: 'Feedback is not available for this bill' });

  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be 1 to 5' });
  const comment = String(req.body?.comment ?? '').trim().slice(0, 1000) || null;

  await pool.query(
    `INSERT INTO customer_feedback (business_id, branch_id, invoice_id, customer_id, rating, comment)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (invoice_id) DO UPDATE SET rating = $5, comment = $6, updated_at = CURRENT_TIMESTAMP`,
    [inv.business_id, inv.branch_id, inv.invoice_id, inv.customer_id, rating, comment]
  );

  res.json({ success: true, data: { happy: rating >= 4, google_review_link: rating >= 4 ? inv.google_review_link : null } });
};
