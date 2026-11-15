export const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/* One plain reading of a client's subscription: what it is, when it ends, how long is left. */
export const lifeOf = (s) => {
  const days = s.ends_at ? Math.ceil((new Date(s.ends_at) - Date.now()) / 864e5) : null;
  const length = s.status === 'TRIAL' ? 'Free trial' : s.billing_cycle === 'YEARLY' ? '1 year' : s.billing_cycle === 'MONTHLY' ? '1 month' : '';
  if (s.status === 'EXPIRED' || (days != null && days < 0)) return { label: 'Ended', badge: 'danger', left: days != null ? `${-days} days ago` : '', tone: 'text-danger', length };
  const left = days == null ? '' : days === 0 ? 'Ends today' : `${days} days left`;
  const tone = days != null && days <= 7 ? 'font-semibold text-danger' : days != null && days <= 30 ? 'text-warning' : 'text-ink-400';
  return { label: s.status === 'TRIAL' ? 'On trial' : s.status === 'ACTIVE' ? 'Paid' : s.status[0] + s.status.slice(1).toLowerCase(), badge: s.status === 'ACTIVE' ? 'success' : s.status === 'TRIAL' ? 'brand' : 'neutral', left, tone, length };
};
