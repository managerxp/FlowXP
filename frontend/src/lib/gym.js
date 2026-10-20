/* Shared by the gym screens: words for states and reasons, the choices on the forms, and small helpers. Dates are plain YYYY-MM-DD strings from the
   server (the gym's own calendar day), never shifted by the browser's time zone. */
import { formatCurrency } from './api.js';

export { addDays, dateText, longDate, qs, useDebounced, useLoad, toNumber } from './salon.js';

export const rs = (rupees) => formatCurrency(rupees || 0);
export const rsPaise = (paise) => formatCurrency((paise || 0) / 100);

/* Where a member stands, as the member list and report work it out. */
export const MEMBER_STATE = {
  ACTIVE: { label: 'Active', tone: 'success' }, EXPIRING: { label: 'Ends soon', tone: 'warning' }, FROZEN: { label: 'Frozen', tone: 'brand' },
  EXPIRED: { label: 'Ended', tone: 'danger' }, UPCOMING: { label: 'Starts soon', tone: 'neutral' }, NONE: { label: 'No membership', tone: 'neutral' }
};

/* One membership: where it is in time, and whether it is paid. */
export const MEMBERSHIP_STATE = {
  ACTIVE: { label: 'Running', tone: 'success' }, GRACE: { label: 'In grace', tone: 'warning' }, FROZEN: { label: 'Frozen', tone: 'brand' }, UPCOMING: { label: 'Not started', tone: 'neutral' },
  EXPIRED: { label: 'Ended', tone: 'danger' }, CANCELLED: { label: 'Cancelled', tone: 'danger' }, TRANSFERRED: { label: 'Transferred', tone: 'neutral' }
};
export const PAYMENT_STATE = {
  PAID: { label: 'Paid', tone: 'success' }, PARTIAL: { label: 'Part paid', tone: 'warning' }, UNPAID: { label: 'Unpaid', tone: 'danger' }, COMPED: { label: 'Free', tone: 'neutral' },
  CARRIED_OVER: { label: 'Transferred in', tone: 'neutral' }, REFUNDED: { label: 'Refunded', tone: 'danger' }, INVOICE_CANCELLED: { label: 'Bill cancelled', tone: 'danger' }, NO_INVOICE: { label: 'No bill', tone: 'warning' }
};

export const MEMBER_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success' }, INACTIVE: { label: 'Inactive', tone: 'neutral' }, SUSPENDED: { label: 'On hold', tone: 'warning' }, ARCHIVED: { label: 'Archived', tone: 'neutral' }
};

/* What the front desk is told, and what to do about it. The server sends its own plain message too; this adds the next step. */
export const REASON = {
  APPROVED: { tone: 'success', title: 'Welcome in', next: '' },
  MEMBER_NOT_FOUND: { tone: 'danger', title: 'No such member', next: 'Check the card or look the member up by name.' },
  INVALID_CREDENTIAL: { tone: 'danger', title: 'Not a valid pass', next: 'Ask for the phone pass again, or look the member up by name.' },
  CREDENTIAL_REVOKED: { tone: 'danger', title: 'This card was cancelled', next: 'It was lost or replaced. Make a new card, or look the member up by name.' },
  CREDENTIAL_EXPIRED: { tone: 'warning', title: 'This pass has run out', next: 'Ask them to open the pass again on their phone.' },
  NO_MEMBERSHIP: { tone: 'danger', title: 'No membership', next: 'Sell them a membership.' },
  MEMBERSHIP_NOT_STARTED: { tone: 'warning', title: 'Membership not started', next: 'It begins on a later date.' },
  MEMBERSHIP_EXPIRED: { tone: 'danger', title: 'Membership ended', next: 'Offer a renewal.' },
  MEMBERSHIP_FROZEN: { tone: 'warning', title: 'Membership is frozen', next: 'End the freeze if they are back.' },
  MEMBERSHIP_SUSPENDED: { tone: 'danger', title: 'Account on hold', next: 'See the member page for why.' },
  PAYMENT_REQUIRES_ATTENTION: { tone: 'warning', title: 'Payment due', next: 'Take the payment, then scan again.' },
  BRANCH_NOT_ALLOWED: { tone: 'warning', title: 'Not valid at this branch', next: 'Their plan is for another branch.' },
  ACCESS_OUTSIDE_ALLOWED_HOURS: { tone: 'warning', title: 'Not allowed at this time', next: 'Their plan or the gym is closed now.' },
  DUPLICATE_SCAN: { tone: 'neutral', title: 'Already checked in', next: '' },
  DEVICE_NOT_AUTHORIZED: { tone: 'danger', title: 'Device not allowed', next: '' },
  VERIFICATION_REQUIRED: { tone: 'warning', title: 'Look at who this is', next: 'Check their face or ID against the details shown, then confirm.' },
  NOT_CHECKED_IN: { tone: 'warning', title: 'No check-in to close', next: '' },
  ACTION_NOT_ALLOWED: { tone: 'neutral', title: 'Check-out is off', next: 'Switch it on in Gym settings.' },
  SERVICE_UNAVAILABLE: { tone: 'danger', title: 'Cannot check right now', next: 'Nobody is let in until this works again. Try once more, or let the manager know.' }
};
export const reasonName = (code) => REASON[code]?.title || String(code || '').toLowerCase().replace(/_/g, ' ');

export const SOURCE_NAME = { RECEPTION: 'Front desk', SELF: 'Own phone', DEVICE: 'Gate' };
export const PLAN_KINDS = [['MEMBERSHIP', 'Gym membership'], ['PT_PACK', 'Personal-training pack'], ['CLASS_PACK', 'Class pack']];
export const AUDIENCES = [['STANDARD', 'Anyone'], ['STUDENT', 'Students'], ['FAMILY', 'Family'], ['CORPORATE', 'Corporate']];
export const PAYMENT_POLICIES = [
  ['FULL_REQUIRED', 'Paid in full before they can come in'],
  ['ANY_PAYMENT', 'Any payment lets them in'],
  ['PAY_LATER', 'Can come in for a few days, then paid in full']
];
export const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank transfer'], ['CHEQUE', 'Cheque'], ['OTHER', 'Other']];
export const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

export const planPrice = (p) => `${rs(p.price)} + ${Number(p.tax_rate)}% GST`;
export const durationText = (days) => {
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`;
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? '' : 's'}`;
  return `${days} days`;
};
export const windowText = (w) => {
  if (!w) return 'Any time the gym is open';
  const days = w.days?.length ? DAYS.filter(([d]) => w.days.includes(d)).map(([, n]) => n).join(', ') : 'Every day';
  return `${days}${w.from ? `, ${w.from} to ${w.to}` : ''}`;
};

export const clockTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const dayTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const hourName = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
