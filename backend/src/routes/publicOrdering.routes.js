/*
 * Public, unauthenticated — a customer's own phone calls these with no
 * session at all, identified only by the table's qr_token in the URL. See
 * publicOrdering.controller.js and the identical reasoning for the delivery
 * webhook route in integrations.routes.js. Mounted in routes/index.js
 * BEFORE any requireAuth-gated router, never behind one.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as publicOrdering from '../controllers/publicOrdering.controller.js';
import * as publicBill from '../controllers/publicBill.controller.js';
import { idempotent } from '../middleware/idempotency.js';
import * as publicSalon from '../controllers/salonPublic.controller.js';

const router = Router();

/* The bill link in a customer's message. The token is 128 random bits; the limit is only there to blunt guessing. */
const billLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests. Try again shortly.' } });
router.get('/bill/:token', billLimiter, publicBill.bill);

/* A bill is rated once or twice at most (submit, maybe change your mind) — tighter than the order limiter below. */
const feedbackLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests. Try again shortly.' } });
router.post('/bill/:token/feedback', feedbackLimiter, publicBill.submitFeedback);

/* Generous relative to the login limiter — a real table can place several
   rounds over a meal — but still bounded, since nothing past the token itself stops a request. */
const placeOrderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many orders from here. Ask a staff member for help.' }
});

/* A card lookup tells a phone number's owner (or anyone with the table's link) how many visits it has, so it is limited harder than the menu. */
const loyaltyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookups. Try again in a few minutes.' }
});

router.get('/menu/:token', publicOrdering.getMenu);
router.post('/menu/:token/loyalty', loyaltyLimiter, publicOrdering.loyaltyCard);
router.post('/menu/:token/order', placeOrderLimiter, idempotent((req) => `t:${req.params.token}`), publicOrdering.placeOrder);

/* Online booking for a salon, found by the address its owner chose. Reading is generous; booking is tight, since each
   one holds a stylist's time. */
const salonReadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests. Try again shortly.' } });
const salonBookLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many bookings from here. Please call the salon.' } });
router.get('/salon/:slug', salonReadLimiter, publicSalon.info);
router.get('/salon/:slug/availability', salonReadLimiter, publicSalon.availability);
router.post('/salon/:slug/appointments', salonBookLimiter, publicSalon.book);

export default router;
