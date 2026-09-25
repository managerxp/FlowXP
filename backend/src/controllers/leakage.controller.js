/*
 * Revenue leakage findings for the owner. Restricted to the 'settings'
 * permission (OWNER and ADMIN): a report about how the team handles discounts
 * and cancellations should not be readable by the people it describes.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { currentFindings, summarise } from '../modules/leakage.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

/* GET /api/leakage?from=&to= */
export const list = async (req, res) => {
  const to = req.query.to || await businessToday(req.tenant.businessId);
  const from = req.query.from || addDaysISO(to, -29);
  const days = Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  if (!(days >= 7 && days <= 180)) return res.status(400).json({ success: false, message: 'Choose a range of 7 to 180 days' });

  const { period, previous_period, findings: reviewed } = await currentFindings(req.tenant.businessId, from, to);
  const s = summarise(reviewed);

  res.json({
    success: true,
    data: {
      period, previous_period,
      summary: { potential: toRupees(s.potential_paise), open: s.open, critical: s.critical, by_category: s.by_category },
      findings: reviewed.map(({ potential_paise, ...f }) => f),
      note: 'These are patterns that differ from your own normal and need a look. They are not conclusions about anyone.'
    }
  });
};

/* POST /api/leakage/reviews { fingerprint, status: REVIEWED | DISMISSED | OPEN, note } */
export const review = async (req, res) => {
  const { fingerprint, status, note } = req.body || {};
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 120) return res.status(400).json({ success: false, message: 'Unknown finding' });
  if (!['REVIEWED', 'DISMISSED', 'OPEN'].includes(status)) return res.status(400).json({ success: false, message: 'Status must be REVIEWED, DISMISSED or OPEN' });

  if (status === 'OPEN') {
    await pool.query(`DELETE FROM leakage_reviews WHERE business_id = $1 AND fingerprint = $2`, [req.tenant.businessId, fingerprint]);
  } else {
    await pool.query(
      `INSERT INTO leakage_reviews (business_id, fingerprint, status, note, reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
       ON CONFLICT (business_id, fingerprint) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, reviewed_by = EXCLUDED.reviewed_by, reviewed_at = CURRENT_TIMESTAMP`,
      [req.tenant.businessId, fingerprint, status, note ? String(note).slice(0, 500) : null, req.auth.userId]
    );
  }
  recordAudit(req, { action: 'leakage.reviewed', resource_type: 'leakage_finding', resource_id: fingerprint, metadata: { status } });
  res.json({ success: true, data: { fingerprint, status } });
};
