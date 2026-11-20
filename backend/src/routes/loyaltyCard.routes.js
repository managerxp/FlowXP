import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from '../controllers/loyaltyCard.controller.js';
import { requireAppHeader } from '../controllers/gymPublic.controller.js';

const router = Router();
const limiter = (max, minutes, message, options = {}) => rateLimit({ windowMs: minutes * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, ...options });
const read = limiter(300, 15, 'Too many requests from here.');
const joinLimit = limiter(20, 60, 'Too many sign-ups from here. Try again later.');
const guess = limiter(60, 15, 'Too many attempts from here. Try again in a few minutes.');   // a wrong token counts the same as a right one: it is the secret

router.use(requireAppHeader);
router.get('/join/:code', read, c.joinInfo);
router.post('/join/:code', joinLimit, c.join);
router.get('/bill/:token', read, c.billInfo);
router.post('/bill/:token', joinLimit, c.billClaimIt);
router.get('/:token', guess, c.card);
router.get('/:token/google-wallet', guess, c.googleWallet);

export default router;
