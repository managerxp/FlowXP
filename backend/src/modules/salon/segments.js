/*
 * Customer segments, defined once so the client list, the segment counts, reminders and campaigns all mean
 * the same thing by "VIP" or "inactive for 60 days".
 *
 * Each segment is a SQL condition over the customer (alias c) joined to salon_customer_stats (alias st),
 * parameterised by the business's own rules (settings.segment_rules) and its local "today". Segments overlap
 * by design: a VIP can also be frequent and, six months later, inactive.
 */

export const SEGMENTS = {
  NEW: 'New customers',
  RETURNING: 'Returning customers',
  VIP: 'VIP',
  HIGH_SPENDER: 'High spenders',
  FREQUENT: 'Frequent visitors',
  MEMBER: 'Members',
  INACTIVE: 'Inactive'          // INACTIVE_30, INACTIVE_60 ... per the configured windows
};

/** Accepts "VIP", "inactive_60" etc.; returns { key, days? } or null when it is not a segment this business has. */
export const parseSegment = (value, rules) => {
  const v = String(value || '').toUpperCase();
  const m = v.match(/^INACTIVE_(\d+)$/);
  if (m) return rules.inactive_days.includes(Number(m[1])) ? { key: 'INACTIVE', days: Number(m[1]) } : null;
  return SEGMENTS[v] && v !== 'INACTIVE' ? { key: v } : null;
};

/**
 * The condition for a segment, pushing its parameters onto `values`. `today` is the business's local date
 * (YYYY-MM-DD) so "30 days ago" is 30 of the salon's days, not the server's.
 */
export const segmentCondition = (segment, rules, today, values) => {
  const p = (v) => { values.push(v); return `$${values.length}`; };
  switch (segment.key) {
    case 'NEW': return `COALESCE(st.first_visit, c.created_at::date) >= ${p(today)}::date - ${p(rules.new_days)}::int`;
    case 'RETURNING': return `st.visits >= 2`;
    case 'VIP': return `(st.spend_paise >= ${p(rules.vip_spend_paise)}::bigint OR st.visits >= ${p(rules.vip_visits)}::int)`;
    case 'HIGH_SPENDER': return `(st.visits > 0 AND st.spend_paise / st.visits >= ${p(rules.high_spender_paise)}::bigint)`;
    case 'FREQUENT': {
      const d = p(today); const n = p(rules.frequent_visits_90d);
      return `(SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.customer_id AND i.status = 'ISSUED' AND i.invoice_date >= ${d}::date - 90) >= ${n}::int`;
    }
    case 'MEMBER': {
      const d = p(today);
      return `EXISTS (SELECT 1 FROM salon_customer_memberships m WHERE m.customer_id = c.customer_id AND m.status = 'ACTIVE' AND m.expiry_date >= ${d}::date)`;
    }
    case 'INACTIVE': return `(st.visits > 0 AND st.last_visit < ${p(today)}::date - ${p(segment.days)}::int)`;
    default: throw new Error(`Unknown segment ${segment.key}`);
  }
};

/** Labels a client carries on screen, from the numbers already loaded for the row (no extra queries). */
export const labelsFor = (row, rules, today) => {
  const labels = [];
  const visits = Number(row.visits || 0); const spend = Number(row.spend_paise || 0);
  const first = row.first_visit ? String(row.first_visit).slice(0, 10) : null;
  const last = row.last_visit ? String(row.last_visit).slice(0, 10) : null;
  const daysAgo = (d) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
  if ((first ? daysAgo(first) : 0) <= rules.new_days && (visits <= 1)) labels.push('NEW');
  if (visits >= 2) labels.push('RETURNING');
  if (spend >= rules.vip_spend_paise || visits >= rules.vip_visits) labels.push('VIP');
  if (visits > 0 && spend / visits >= rules.high_spender_paise) labels.push('HIGH_SPENDER');
  if (row.has_membership) labels.push('MEMBER');
  if (visits > 0 && last) {
    const gap = daysAgo(last);
    const window = [...rules.inactive_days].sort((a, b) => b - a).find((n) => gap > n);
    if (window) labels.push(`INACTIVE_${window}`);
  }
  return labels;
};
