/*
 * Loyalty phase 6: what the owner reads, and a self-check of the books.
 *
 * report():  per card, over the last N days: members, joined, active, points/stamps given and used, spend behind them, repeat members, rewards claimed and what they cost,
 *            plus what is still owed to members (the liability) and a day-by-day series. Money is raw paise (strings), like the rest of the loyalty endpoints.
 *            Figures are read straight from the ledger, never stored, so they cannot drift from it. A reversal is counted on its own line, not netted off earned/used.
 * problems(): things that should never be true if the engine did its job. Empty means healthy. Read-only: it reports, it never repairs.
 */
const days = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 30; };

export const report = async (db, businessId, { days: d, programmeId = null } = {}) => {
  const n = days(d);
  const since = `now() - ${n} * interval '1 day'`;   // n is a validated integer, so it is safe to inline
  const cards = (await db.query(
    `SELECT p.programme_id, p.name, p.kind, p.is_active, p.redeem_points, p.redeem_value_paise::text AS redeem_value_paise,
            (SELECT COUNT(*) FROM loyalty_memberships m WHERE m.programme_id = p.programme_id)::int AS members,
            (SELECT COUNT(*) FROM loyalty_memberships m WHERE m.programme_id = p.programme_id AND m.joined_at >= ${since})::int AS joined,
            (SELECT COUNT(*) FROM loyalty_memberships m WHERE m.programme_id = p.programme_id AND m.consent_marketing)::int AS consented,
            COALESCE(l.earned, 0)::int AS earned, COALESCE(l.used, 0)::int AS used, COALESCE(l.undone, 0)::int AS undone, COALESCE(l.expired, 0)::int AS expired, COALESCE(l.visits, 0)::int AS visits,
            COALESCE(l.spend, 0)::text AS spend_paise, COALESCE(l.active, 0)::int AS active, COALESCE(l.owed, 0)::int AS owed_points,
            COALESCE(rp.repeaters, 0)::int AS repeaters,
            COALESCE(rc.claims, 0)::int AS claims, COALESCE(rc.claim_paise, 0)::text AS claim_paise, COALESCE(rc.on_bill, 0)::int AS claims_on_bill
       FROM loyalty_programmes p
       LEFT JOIN LATERAL (SELECT SUM(points) FILTER (WHERE kind = 'EARN' AND created_at >= ${since}) AS earned,
                                 -SUM(points) FILTER (WHERE kind = 'REDEEM' AND created_at >= ${since}) AS used,
                                 COUNT(*) FILTER (WHERE kind = 'REVERSAL' AND created_at >= ${since}) AS undone,
                                 -SUM(points) FILTER (WHERE kind = 'EXPIRE' AND created_at >= ${since}) AS expired,
                                 COUNT(*) FILTER (WHERE kind = 'EARN' AND created_at >= ${since}) AS visits,
                                 SUM(amount_paise) FILTER (WHERE kind = 'EARN' AND created_at >= ${since}) AS spend,
                                 COUNT(DISTINCT membership_id) FILTER (WHERE kind IN ('EARN','REDEEM') AND created_at >= ${since}) AS active,
                                 SUM(points) FILTER (WHERE voided_at IS NULL) AS owed
                            FROM points_ledger WHERE programme_id = p.programme_id) l ON TRUE
       LEFT JOIN LATERAL (SELECT COUNT(*) AS repeaters FROM (SELECT membership_id FROM points_ledger WHERE programme_id = p.programme_id AND kind = 'EARN' AND created_at >= ${since}
                                                              GROUP BY membership_id HAVING COUNT(*) >= 2) x) rp ON TRUE
       LEFT JOIN LATERAL (SELECT COUNT(*) AS claims, SUM(d.value_paise) AS claim_paise, COUNT(*) FILTER (WHERE d.applied_invoice_id IS NOT NULL) AS on_bill
                            FROM loyalty_redemptions d JOIN loyalty_rewards r ON r.reward_id = d.reward_id
                           WHERE r.programme_id = p.programme_id AND d.status = 'REDEEMED' AND d.created_at >= ${since}) rc ON TRUE
      WHERE p.business_id = $1 AND ($2::int IS NULL OR p.programme_id = $2) ORDER BY p.programme_id`, [businessId, programmeId])).rows;

  // What members are still owed, in rupees' worth: balance / points-per-reward-value. Only meaningful where points have a money value.
  for (const c of cards) c.owed_paise = String(c.redeem_points ? Math.floor((c.owed_points * Number(c.redeem_value_paise)) / c.redeem_points) : 0);

  const topRewards = (await db.query(
    `SELECT r.reward_id, r.name, COUNT(*)::int AS claims FROM loyalty_redemptions d JOIN loyalty_rewards r ON r.reward_id = d.reward_id
      WHERE d.business_id = $1 AND d.status = 'REDEEMED' AND d.created_at >= ${since} AND ($2::int IS NULL OR r.programme_id = $2)
      GROUP BY r.reward_id, r.name ORDER BY claims DESC, r.reward_id LIMIT 5`, [businessId, programmeId])).rows;
  const series = (await db.query(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*) FILTER (WHERE kind = 'EARN')::int AS earns, COUNT(*) FILTER (WHERE kind = 'REDEEM')::int AS redeems
       FROM points_ledger WHERE business_id = $1 AND membership_id IS NOT NULL AND kind IN ('EARN','REDEEM') AND created_at >= ${since} AND ($2::int IS NULL OR programme_id = $2)
      GROUP BY 1 ORDER BY 1`, [businessId, programmeId])).rows;

  const sum = (k) => cards.reduce((a, c) => a + Number(c[k]), 0);
  const members = sum('members'); const active = sum('active');
  return {
    days: n, cards, top_rewards: topRewards, series,
    totals: { members, joined: sum('joined'), consented: sum('consented'), active, visits: sum('visits'), spend_paise: String(sum('spend_paise')), claims: sum('claims'), claim_paise: String(sum('claim_paise')), owed_paise: String(sum('owed_paise')), repeaters: sum('repeaters') },
    // a plain share, or null when there is nothing to divide by (never a fake 0%)
    active_share: members ? Math.round((active / members) * 100) : null
  };
};

/** Each entry: { code, text, ids }. Empty list = nothing wrong. */
export const problems = async (db, businessId) => {
  const checks = [
    ['NEGATIVE_BALANCE', 'A member has a negative balance', `SELECT m.membership_id AS id FROM loyalty_memberships m JOIN points_ledger l ON l.membership_id = m.membership_id AND l.voided_at IS NULL
        WHERE m.business_id = $1 GROUP BY m.membership_id HAVING SUM(l.points) < 0`],
    ['OVER_REVERSED', 'An entry has been reversed by more than it was worth', `SELECT o.entry_id AS id FROM points_ledger o JOIN points_ledger r ON r.reverses_entry_id = o.entry_id
        WHERE o.business_id = $1 GROUP BY o.entry_id, o.points HAVING ABS(SUM(r.points)) > ABS(o.points)`],
    ['CLAIM_REVERSED', 'A reward still shows as claimed but its points were given back', `SELECT d.redemption_id AS id FROM loyalty_redemptions d
        WHERE d.business_id = $1 AND d.status = 'REDEEMED' AND EXISTS (SELECT 1 FROM points_ledger x WHERE x.reverses_entry_id = d.ledger_entry_id)`],
    ['CLAIM_ON_CANCELLED_BILL', 'A reward is held against a bill that was cancelled', `SELECT d.redemption_id AS id FROM loyalty_redemptions d JOIN invoices i ON i.invoice_id = d.applied_invoice_id
        WHERE d.business_id = $1 AND i.status = 'CANCELLED'`],
    ['WRONG_OWNER', 'A ledger entry belongs to a different customer than its card', `SELECT l.entry_id AS id FROM points_ledger l JOIN loyalty_memberships m ON m.membership_id = l.membership_id
        WHERE l.business_id = $1 AND (m.customer_id <> l.customer_id OR m.business_id <> l.business_id)`]
  ];
  const out = [];
  for (const [code, text, sql] of checks) {
    const ids = (await db.query(`${sql} LIMIT 50`, [businessId])).rows.map((r) => r.id);
    if (ids.length) out.push({ code, text, ids });
  }
  return out;
};
