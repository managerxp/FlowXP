/*
 * What each customer message says, and the WhatsApp template it maps to.
 *
 * WhatsApp only lets a business start a conversation with an APPROVED template,
 * so each kind has a fixed template name and an ordered list of variables: the
 * owner creates these once in Meta Business Manager (GET /api/messaging/templates
 * prints the exact text to paste) and FlowXP fills the {{1}}, {{2}}... variables.
 * SMS and the recorded log use the same wording as plain text.
 *
 * `promo` messages (offers, loyalty nudges) are only sent to customers who have not opted out.
 */
export const TEMPLATES = {
  BILL: {
    name: 'flowxp_bill', promo: false,
    vars: ['name', 'business', 'number', 'total', 'link'],
    text: (p) => `Hi ${p.name}, thank you for visiting ${p.business}! Your bill ${p.number} is ${p.total}. View it here: ${p.link}`
  },
  RESERVATION: {
    name: 'flowxp_booking', promo: false,
    vars: ['name', 'business', 'when', 'party'],
    text: (p) => `Hi ${p.name}, your table at ${p.business} is booked for ${p.when}, party of ${p.party}. See you soon!`
  },
  RESERVATION_CANCELLED: {
    name: 'flowxp_booking_cancelled', promo: false,
    vars: ['name', 'business', 'when'],
    text: (p) => `Hi ${p.name}, your booking at ${p.business} for ${p.when} has been cancelled.`
  },
  WAITLIST_ADDED: {
    name: 'flowxp_waitlist_added', promo: false,
    vars: ['name', 'business', 'minutes'],
    text: (p) => `Hi ${p.name}, you are on the waitlist at ${p.business}. Estimated wait: about ${p.minutes} minutes. We will message you when your table is ready.`
  },
  WAITLIST_READY: {
    name: 'flowxp_table_ready', promo: false,
    vars: ['name', 'business'],
    text: (p) => `Hi ${p.name}, your table at ${p.business} is ready. Please come to the host desk.`
  },
  LOYALTY_NEXT: {
    name: 'flowxp_loyalty_next', promo: true,
    vars: ['name', 'business', 'reward'],
    text: (p) => `Hi ${p.name}, your next visit to ${p.business} earns a free ${p.reward}! Reply STOP to opt out.`
  },
  OFFER: {
    name: 'flowxp_offer', promo: true,
    vars: ['name', 'business', 'offer'],
    text: (p) => `Hi ${p.name}, ${p.business}: ${p.offer} Reply STOP to opt out.`
  },
  // Salon. Kinds stay within the messages.kind column (24 characters).
  SALON_APPT_BOOKED: {
    name: 'flowxp_salon_booked', promo: false,
    vars: ['name', 'business', 'when', 'services'],
    text: (p) => `Hi ${p.name}, your appointment at ${p.business} is booked for ${p.when}: ${p.services}. See you soon!`
  },
  SALON_APPT_REMINDER: {
    name: 'flowxp_salon_reminder', promo: false,
    vars: ['name', 'business', 'when', 'services'],
    text: (p) => `Hi ${p.name}, a reminder of your appointment at ${p.business} on ${p.when}: ${p.services}. Reply if you need to change it.`
  },
  SALON_APPT_CANCELLED: {
    name: 'flowxp_salon_cancelled', promo: false,
    vars: ['name', 'business', 'when'],
    text: (p) => `Hi ${p.name}, your appointment at ${p.business} on ${p.when} has been cancelled. Call us to book another time.`
  },
  SALON_BIRTHDAY: {
    name: 'flowxp_salon_birthday', promo: true,
    vars: ['name', 'business', 'offer'],
    text: (p) => `Happy birthday ${p.name}! ${p.business} has a treat for you: ${p.offer} Reply STOP to opt out.`
  },
  SALON_ANNIVERSARY: {
    name: 'flowxp_salon_anniversary', promo: true,
    vars: ['name', 'business', 'offer'],
    text: (p) => `Happy anniversary ${p.name}! ${p.business}: ${p.offer} Reply STOP to opt out.`
  },
  SALON_MEMBER_EXPIRY: {
    name: 'flowxp_salon_member_expiry', promo: false,
    vars: ['name', 'business', 'plan', 'date'],
    text: (p) => `Hi ${p.name}, your ${p.plan} membership at ${p.business} ends on ${p.date}. Renew at your next visit to keep your benefits.`
  },
  SALON_POINTS_EXPIRY: {
    name: 'flowxp_salon_points_expiry', promo: false,
    vars: ['name', 'business', 'points', 'days'],
    text: (p) => `Hi ${p.name}, ${p.points} of your reward points at ${p.business} expire in the next ${p.days} days. Use them on your next visit!`
  },
  SALON_REVISIT: {
    name: 'flowxp_salon_revisit', promo: true,
    vars: ['name', 'business'],
    text: (p) => `Hi ${p.name}, it has been a while since your last visit to ${p.business}. Book your next appointment with us! Reply STOP to opt out.`
  },
  SALON_INACTIVE: {
    name: 'flowxp_salon_inactive', promo: true,
    vars: ['name', 'business', 'offer'],
    text: (p) => `Hi ${p.name}, we miss you at ${p.business}! ${p.offer} Reply STOP to opt out.`
  },
  SALON_PAYMENT_DUE: {
    name: 'flowxp_salon_payment_due', promo: false,
    vars: ['name', 'business', 'number', 'amount'],
    text: (p) => `Hi ${p.name}, a gentle reminder that ${p.amount} is still due on bill ${p.number} at ${p.business}. Thank you!`
  },
  // Wholesale. Kinds stay within the messages.kind column (24 characters).
  WS_ORDER_CONFIRMED: {
    name: 'flowxp_ws_order_confirmed', promo: false,
    vars: ['name', 'business', 'order', 'total'],
    text: (p) => `Hi ${p.name}, ${p.business} has confirmed your order ${p.order} (${p.total}). We will let you know when it is dispatched.`
  },
  WS_ORDER_DISPATCHED: {
    name: 'flowxp_ws_order_dispatched', promo: false,
    vars: ['name', 'business', 'order', 'invoice', 'vehicle'],
    text: (p) => `Hi ${p.name}, your order ${p.order} from ${p.business} has been dispatched with invoice ${p.invoice}${p.vehicle === '-' ? '' : ` on vehicle ${p.vehicle}`}.`
  },
  WS_INVOICE: {
    name: 'flowxp_ws_invoice', promo: false,
    vars: ['name', 'business', 'number', 'total', 'due', 'link'],
    text: (p) => `Hi ${p.name}, invoice ${p.number} from ${p.business} for ${p.total} is due on ${p.due}. View it here: ${p.link}`
  },
  WS_PAYMENT_RECEIVED: {
    name: 'flowxp_ws_payment_received', promo: false,
    vars: ['name', 'business', 'amount', 'receipt'],
    text: (p) => `Hi ${p.name}, ${p.business} has received your payment of ${p.amount} (receipt ${p.receipt}). Thank you!`
  },
  WS_PAYMENT_DUE: {
    name: 'flowxp_ws_payment_due', promo: false,
    vars: ['name', 'business', 'amount', 'number', 'due'],
    text: (p) => `Hi ${p.name}, a reminder from ${p.business}: ${p.amount} on invoice ${p.number} is due on ${p.due}. Thank you!`
  },
  WS_PAYMENT_OVERDUE: {
    name: 'flowxp_ws_payment_overdue', promo: false,
    vars: ['name', 'business', 'amount', 'number', 'days'],
    text: (p) => `Hi ${p.name}, ${p.amount} on invoice ${p.number} to ${p.business} is ${p.days} days overdue. Please arrange payment at the earliest.`
  },
  REVIEW_REPLY: {
    name: 'flowxp_review_reply', promo: false,
    vars: ['name', 'business', 'reply'],
    text: (p) => `Hi ${p.name}, ${p.business}: ${p.reply}`
  }
};

export const KINDS = Object.keys(TEMPLATES);

/** { text, template: { name, params } } for a message of `kind`; a missing variable is an error, not a blank in the customer's phone. */
export const render = (kind, values) => {
  const t = TEMPLATES[kind];
  if (!t) throw new Error(`Unknown message kind ${kind}`);
  for (const v of t.vars) if (values[v] == null || String(values[v]).trim() === '') throw new Error(`Message ${kind} needs ${v}`);
  return { text: t.text(values), promo: t.promo, template: { name: t.name, params: t.vars.map((v) => String(values[v])) } };
};

/** The template as the owner pastes it into Meta: variables as {{1}}, {{2}}... */
export const metaBody = (kind) => {
  const t = TEMPLATES[kind];
  const placeholders = Object.fromEntries(t.vars.map((v, i) => [v, `{{${i + 1}}}`]));
  return t.text(placeholders);
};
