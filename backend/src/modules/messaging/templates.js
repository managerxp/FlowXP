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
/* The closing line of a bill message: the shop's own words when it has saved them (the receipt footer in Settings), else one that suits its kind of business. WhatsApp allows no line breaks in a variable. */
export const CLOSING = {
  RESTAURANT: 'We hope you enjoyed your meal.', CLOUD_KITCHEN: 'We hope you enjoyed your meal.', CAFE: 'We hope you enjoyed your coffee and your time with us.',
  RETAIL: 'We hope you found everything you were looking for.', SUPERMARKET: 'We hope you found everything you were looking for.', ELECTRONICS: 'We hope you enjoy your new purchase.', CLOTHING: 'We hope you love what you picked.',
  PHARMACY: 'Wishing you good health.', SALON: 'We hope you love your new look.', GYM: 'Keep going, we will see you at the gym.', HOTEL: 'We hope you enjoyed your stay.',
  GAMING_CAFE: 'Thanks for playing, see you again.', AUTO_PARTS: 'Drive safe, and see you again soon.', RACING: 'Thanks for racing with us.',
  WHOLESALE: 'We value your business and look forward to your next order.', DISTRIBUTOR: 'We value your business and look forward to your next order.',
  SERVICES: 'It was a pleasure to serve you.', OTHER: 'We hope to serve you again soon.'
};
export const closingLine = (businessType, shopFooter) => {
  const own = String(shopFooter ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return own || CLOSING[String(businessType || '').toUpperCase()] || CLOSING.OTHER;
};

export const TEMPLATES = {
  /* The bill as a payment receipt: one template for every shop and every kind of business (`closing` is the line that changes: the shop's own words, or one for its kind of business, see closingLine in index.js).
     No header; the shop's name and the amount in the body (bold italics); the fixed footer "Billing powered by FlowXP"; two buttons, both ending in the bill's link token:
       View Bill   https://YOUR-DOMAIN/bill/{{1}}   the bill
       Rate Us     https://YOUR-DOMAIN/r/{{1}}      the shop's Google review page (backend publicBill.reviewRedirect), or the bill when the shop has no review link
     `status` says Paid in full, Part paid with what is due, or what is due. */
  BILL: {
    name: 'flowxp_bill', promo: false,
    vars: ['name', 'business', 'total', 'number', 'when', 'status', 'closing'],   // the seven values in the WhatsApp message body
    urlButtons: ['token', 'token'],
    also: ['link'],                                                    // the whole link, for the recorded and SMS wording
    body: (p) => `Hi ${p.name},\n\nThank you for your order at *_${p.business}_*.\n\nYour bill of *_${p.total}_* is ready.\n\n*Invoice No.:* ${p.number}\n*Date & Time:* ${p.when}\n*Payment Status:* ${p.status}\n\nTap View Invoice below to see every item and the GST.\n\n${p.closing}\n\nThank you for choosing us.`,
    text: (p) => `Hi ${p.name}, thank you for your order at ${p.business}. Your bill of ${p.total} is ready. Invoice ${p.number}, ${p.when}. Payment status: ${p.status}. View it here: ${p.link} ${p.closing} Thank you for choosing us.`
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
    text: (p) => `Hi ${p.name}, your order ${p.order} from ${p.business} has been dispatched with invoice ${p.invoice}${p.vehicle === '-' ? '' : ` on vehicle ${p.vehicle}`}. Thank you.`
  },
  WS_INVOICE: {
    name: 'flowxp_ws_invoice', promo: false,
    vars: ['name', 'business', 'number', 'total', 'due', 'link'],
    text: (p) => `Hi ${p.name}, invoice ${p.number} from ${p.business} for ${p.total} is due on ${p.due}. View it here: ${p.link} Thank you.`
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
  WS_DELIVERY_UPDATE: {
    name: 'flowxp_ws_delivery_update', promo: false,
    vars: ['name', 'business', 'order', 'status'],
    text: (p) => `Hi ${p.name}, update on your order ${p.order} from ${p.business}: ${p.status}. Thank you.`
  },
  BALANCE_DUE: {
    name: 'flowxp_balance_due', promo: false,
    vars: ['name', 'business', 'amount', 'bills'],
    text: (p) => `Hi ${p.name}, a gentle reminder from ${p.business}: ${p.amount} is due on your account. Unpaid: ${p.bills}. Please pay when you can. Thank you!`
  },
  REVIEW_REPLY: {
    name: 'flowxp_review_reply', promo: false,
    vars: ['name', 'business', 'reply'],
    text: (p) => `Hi ${p.name}, ${p.business}: ${p.reply} Thank you for your feedback.`
  },
  // Gym. Kinds stay within the messages.kind column (24 characters). The sign-in code is never stored in the messages table.
  GYM_OTP: {
    name: 'flowxp_gym_otp', promo: false,
    vars: ['business', 'code'],
    text: (p) => `Your ${p.business} sign-in code is ${p.code}. It works for 10 minutes. Do not share it with anyone.`
  },
  GYM_WELCOME: {
    name: 'flowxp_gym_welcome', promo: false,
    vars: ['name', 'business', 'code'],
    text: (p) => `Welcome to ${p.business}, ${p.name}! Your member code is ${p.code}. We are glad to have you.`
  },
  GYM_EXPIRY: {
    name: 'flowxp_gym_expiry', promo: false,
    vars: ['name', 'business', 'plan', 'date'],
    body: (p) => `Hi ${p.name},\n\nYour membership at *_${p.business}_* is ending soon.\n\n*Plan:* ${p.plan}\n*Ends on:* ${p.date}\n\nRenew at the desk to keep training without a break.\n\nThank you for training with us.`,
    text: (p) => `Hi ${p.name}, your ${p.plan} membership at ${p.business} ends on ${p.date}. Renew at the desk to keep training without a break.`
  },
  GYM_MONTH_START: {
    name: 'flowxp_gym_month_start', promo: false,
    vars: ['name', 'business', 'plan', 'date', 'amount'],
    body: (p) => `Hi ${p.name},\n\nA new month begins at *_${p.business}_*. Here is your membership renewal.\n\n*Plan:* ${p.plan}\n*Ends on:* ${p.date}\n*Renewal amount:* ${p.amount}\n\nPlease renew at the desk to keep training without a break.\n\nThank you for training with us.`,
    text: (p) => `Hi ${p.name}, a new month begins at ${p.business}. Your ${p.plan} membership ends on ${p.date}. Renewal is ${p.amount}. Please renew at the desk to keep training without a break. Thank you.`
  },
  GYM_EXPIRED: {
    name: 'flowxp_gym_expired', promo: false,
    vars: ['name', 'business', 'plan', 'date'],
    body: (p) => `Hi ${p.name},\n\nYour membership at *_${p.business}_* has ended.\n\n*Plan:* ${p.plan}\n*Ended on:* ${p.date}\n\nRenew at the desk whenever you are ready to come back.\n\nWe would be glad to see you again.`,
    text: (p) => `Hi ${p.name}, your ${p.plan} membership at ${p.business} ended on ${p.date}. Renew at the desk when you are ready to come back.`
  },
  GYM_PAYMENT_DUE: {
    name: 'flowxp_gym_payment_due', promo: false,
    vars: ['name', 'business', 'plan', 'amount'],
    body: (p) => `Hi ${p.name},\n\nThis is a payment reminder from *_${p.business}_*.\n\n*Plan:* ${p.plan}\n*Amount due:* ${p.amount}\n\nPlease pay at the desk to keep your access.\n\nThank you for your support.`,
    text: (p) => `Hi ${p.name}, ${p.amount} is still due on your ${p.plan} membership at ${p.business}. Please pay at the desk to keep your access.`
  },
  GYM_CLASS: {
    name: 'flowxp_gym_class', promo: false,
    vars: ['name', 'business', 'class', 'when'],
    text: (p) => `Hi ${p.name}, a reminder: ${p.class} at ${p.business} on ${p.when}. See you there.`
  },
  GYM_REWARD: {
    name: 'flowxp_gym_reward', promo: false,
    vars: ['name', 'business', 'points'],
    text: (p) => `Hi ${p.name}, you now have ${p.points} reward points at ${p.business}. Ask at the desk what they can get you.`
  },
  JOB_RECEIVED: {
    name: 'flowxp_job_received', promo: false,
    vars: ['name', 'business', 'vehicle', 'job_no', 'when'],
    text: (p) => `Hi ${p.name}, we have received your ${p.vehicle} at ${p.business}. Job card ${p.job_no}. Expected ready: ${p.when}. We will keep you updated. Thank you.`
  },
  JOB_ESTIMATE: {
    name: 'flowxp_job_estimate', promo: false,
    vars: ['name', 'business', 'vehicle', 'job_no', 'total'],
    text: (p) => `Hi ${p.name}, the estimate for your ${p.vehicle} at ${p.business} (job card ${p.job_no}) is ${p.total} including GST. Please reply to approve the work. Thank you.`
  },
  JOB_READY: {
    name: 'flowxp_job_ready', promo: false,
    vars: ['name', 'business', 'vehicle', 'job_no'],
    text: (p) => `Hi ${p.name}, your ${p.vehicle} is ready at ${p.business} (job card ${p.job_no}). You can collect it now. Thank you.`
  },
  SERVICE_DUE: {
    name: 'flowxp_service_due', promo: false,
    vars: ['name', 'business', 'vehicle', 'date'],
    text: (p) => `Hi ${p.name}, your ${p.vehicle} is due for its next service on ${p.date}. Call or visit ${p.business} to book it. Thank you.`
  },
  GYM_INACTIVE: {
    name: 'flowxp_gym_inactive', promo: true,
    vars: ['name', 'business', 'days'],
    text: (p) => `Hi ${p.name}, we have not seen you at ${p.business} for ${p.days} days. We would love to have you back! Reply STOP to opt out.`
  }
};

export const KINDS = Object.keys(TEMPLATES);

/** { text, template: { name, params } } for a message of `kind`; a missing variable is an error, not a blank in the customer's phone. */
export const render = (kind, values) => {
  const t = TEMPLATES[kind];
  if (!t) throw new Error(`Unknown message kind ${kind}`);
  for (const v of [...t.vars, ...(t.urlButtons || []), ...(t.also || []), ...(t.headerVar ? [t.headerVar] : [])]) if (values[v] == null || String(values[v]).trim() === '') throw new Error(`Message ${kind} needs ${v}`);
  return { text: t.text(values), promo: t.promo, template: { name: t.name, params: t.vars.map((v) => String(values[v])), ...(t.headerVar ? { header: String(values[t.headerVar]) } : {}), ...(t.urlButtons ? { buttons: t.urlButtons.map((v) => String(values[v])) } : {}) } };
};

/** The template as the owner pastes it into Meta: variables as {{1}}, {{2}}... */
export const metaBody = (kind) => {
  const t = TEMPLATES[kind];
  const placeholders = Object.fromEntries(t.vars.map((v, i) => [v, `{{${i + 1}}}`]));
  return (t.body || t.text)(placeholders);
};
