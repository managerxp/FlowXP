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
