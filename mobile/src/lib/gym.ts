/* The gym front desk on a phone: let a member in by scanning their pass or looking them up, and see who is in. Every decision (is the membership valid, paid, allowed now) is the server's;
   a refusal comes back with a reason, and if the server cannot be reached nobody is let in. Online only. */

export const GYM_TYPES = ['GYM'];

export type Member = { member_id: number; member_code: string; name: string; phone: string | null; state: string; plan_name: string | null; expires_on: string | null; photo_url?: string | null; last_visit?: string | null };
export type AccessResult = {
  decision: 'APPROVED' | 'DENIED'; reason: string; message?: string; action?: 'IN' | 'OUT'; in_grace?: boolean; unavailable?: boolean;
  member: { member_id: number; member_code: string; name: string; photo_url: string | null; status: string } | null;
  membership: { plan_name: string; end_date: string; days_left: number } | null;
};
export type GymDash = {
  today: string; members: Record<string, number>; visits: { today: number; today_unique: number; open_now: number; last_7_days: number };
  denied_today: { reason_code: string; n: number }[];
};

export type Tone = 'ok' | 'warn' | 'bad' | 'soft';
/** What the desk says for each answer, and what to do next. */
export const REASON: Record<string, { tone: Tone; title: string; next: string }> = {
  APPROVED: { tone: 'ok', title: 'Welcome in', next: '' },
  MEMBER_NOT_FOUND: { tone: 'bad', title: 'No such member', next: 'Check the card or look the member up by name.' },
  INVALID_CREDENTIAL: { tone: 'bad', title: 'Not a valid pass', next: 'Ask for the phone pass again, or look the member up by name.' },
  CREDENTIAL_REVOKED: { tone: 'bad', title: 'This card was cancelled', next: 'It was lost or replaced. Look the member up by name.' },
  CREDENTIAL_EXPIRED: { tone: 'warn', title: 'This pass has run out', next: 'Ask them to open the pass again on their phone.' },
  NO_MEMBERSHIP: { tone: 'bad', title: 'No membership', next: 'Sell them a membership on the website.' },
  MEMBERSHIP_NOT_STARTED: { tone: 'warn', title: 'Membership not started', next: 'It begins on a later date.' },
  MEMBERSHIP_EXPIRED: { tone: 'bad', title: 'Membership ended', next: 'Offer a renewal.' },
  MEMBERSHIP_FROZEN: { tone: 'warn', title: 'Membership is frozen', next: 'End the freeze if they are back.' },
  MEMBERSHIP_SUSPENDED: { tone: 'bad', title: 'Account on hold', next: 'See the member page on the website for why.' },
  PAYMENT_REQUIRES_ATTENTION: { tone: 'warn', title: 'Payment due', next: 'Take the payment, then try again.' },
  BRANCH_NOT_ALLOWED: { tone: 'warn', title: 'Not valid at this branch', next: 'Their plan is for another branch.' },
  ACCESS_OUTSIDE_ALLOWED_HOURS: { tone: 'warn', title: 'Not allowed at this time', next: 'Their plan or the gym is closed now.' },
  DUPLICATE_SCAN: { tone: 'soft', title: 'Already checked in', next: '' },
  DEVICE_NOT_AUTHORIZED: { tone: 'bad', title: 'Device not allowed', next: '' },
  VERIFICATION_REQUIRED: { tone: 'warn', title: 'Look at who this is', next: 'Check their face or ID against the details shown, then confirm.' },
  NOT_CHECKED_IN: { tone: 'warn', title: 'No check-in to close', next: '' },
  ACTION_NOT_ALLOWED: { tone: 'soft', title: 'Check-out is off', next: 'Switch it on in Gym settings on the website.' },
  SERVICE_UNAVAILABLE: { tone: 'bad', title: 'Cannot check right now', next: 'Nobody is let in until this works again. Try once more, or tell the manager.' }
};
export const reasonOf = (code: string): { tone: Tone; title: string; next: string } => REASON[code] ?? { tone: 'soft', title: code.toLowerCase().replace(/_/g, ' '), next: '' };

export const needsConfirm = (r: Pick<AccessResult, 'reason' | 'member'>): boolean => r.reason === 'VERIFICATION_REQUIRED' && Boolean(r.member);
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

/** The two ways in: a scanned code, or a member the desk has looked at. */
export const scanBody = (code: string, key: string, action: 'IN' | 'OUT' = 'IN', confirm = false) => ({ code: code.trim(), action, idempotency_key: key, ...(confirm ? { confirm: true } : {}) });
export const manualBody = (memberId: number, key: string, action: 'IN' | 'OUT' = 'IN') => ({ member_id: memberId, action, confirm: true, idempotency_key: key });
export const membersPath = (q: string, limit = 12): string | null => (q.trim().length >= 2 ? `/gym/members?search=${encodeURIComponent(q.trim())}&limit=${limit}` : null);

export const STATE_LABEL: Record<string, string> = { ACTIVE: 'Active', EXPIRING: 'Ends soon', FROZEN: 'Frozen', EXPIRED: 'Ended', UPCOMING: 'Starts soon', NONE: 'No membership' };
export const STATE_TONE: Record<string, Tone> = { ACTIVE: 'ok', EXPIRING: 'warn', FROZEN: 'warn', EXPIRED: 'bad', UPCOMING: 'soft', NONE: 'soft' };
export const memberSub = (m: Pick<Member, 'member_code' | 'phone' | 'plan_name'>): string => [m.member_code, m.phone, m.plan_name].filter(Boolean).join(' · ');

/** A recent entry for the strip under the result: first name only, as the screen may face other members. */
export type Recent = { at: number; ok: boolean; who: string; what: string };
export const recentOf = (r: AccessResult, label: string, now = Date.now()): Recent => ({ at: now, ok: r.decision === 'APPROVED', who: r.member ? firstName(r.member.name) : label, what: r.decision === 'APPROVED' ? (r.action === 'OUT' ? 'out' : 'in') : reasonOf(r.reason).title });
export const addRecent = (list: Recent[], r: Recent, max = 8): Recent[] => [r, ...list].slice(0, max);
export const deniedTotal = (d: Pick<GymDash, 'denied_today'> | null | undefined): number => (d?.denied_today ?? []).reduce((s, x) => s + x.n, 0);
