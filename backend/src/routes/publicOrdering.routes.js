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
import { idempotent } from '../middleware/idempotency.js';

const router = Router();

/* The one unauthenticated write in this whole API. Generous relative to the
   login limiter — a real table can place several rounds over a meal — but
   still bounded, since nothing past the token itself stops a request. */
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

export default router;
