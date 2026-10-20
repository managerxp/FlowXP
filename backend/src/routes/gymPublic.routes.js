/*
 * /api/public/gym/* — the gym's public pages and the signed-in member's own endpoints. No staff session: a gym is found by its public address or
 * an outlet's entrance QR token, a member by a cookie they earned with a code sent to their phone. See controllers/gymPublic.controller.js.
 *
 * Limits are per address, and a gym's members share the gym's wifi, so they are generous; the real brakes are per phone number (one code a minute,
 * five tries a code, a few codes an hour) in modules/gym/portal.js.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import gym, { memberSession, requireAppHeader } from '../controllers/gymPublic.controller.js';

const router = Router();
const limiter = (max, minutes, message, options = {}) => rateLimit({ windowMs: minutes * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, ...options });
const sendLimiter = limiter(40, 15, 'Too many requests from here. Try again in a few minutes.');
const guessLimiter = limiter(40, 15, 'Too many attempts from here. Try again in a few minutes.', { skipSuccessfulRequests: true });
const readLimiter = limiter(300, 15, 'Too many requests from here.');

router.use(requireAppHeader);

router.get('/in/:token', readLimiter, gym.entrance);
router.get('/me', readLimiter, memberSession, gym.me);
router.get('/me/attendance', readLimiter, memberSession, gym.attendance);
router.get('/me/classes', readLimiter, memberSession, gym.myClasses);
router.post('/me/classes/:id/book', readLimiter, memberSession, gym.myBook);
router.post('/me/bookings/:id/cancel', readLimiter, memberSession, gym.myCancel);
router.get('/me/training', readLimiter, memberSession, gym.myTraining);
router.put('/me/profile', readLimiter, memberSession, gym.profile);
router.post('/me/pass', readLimiter, memberSession, gym.pass);
router.post('/me/switch', readLimiter, memberSession, gym.switchTo);
router.post('/me/checkin', readLimiter, memberSession, gym.checkin);
router.post('/logout', readLimiter, gym.logout);
router.get('/:slug', readLimiter, gym.info);
router.post('/:slug/otp', sendLimiter, gym.requestOtp);
router.post('/:slug/verify', guessLimiter, gym.verifyOtp);

export default router;
