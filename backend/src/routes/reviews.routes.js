import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as reviews from '../controllers/reviews.controller.js';

const router = Router();
const feature = requirePlanFeature('reviews');
const read = [requireAuth, withBusiness(), feature, requirePermission('settings')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('settings')];

/* AI drafting costs the same as a Flow AI question, so limited the same way as ai.routes.js's chat/briefing. */
const perUser = rateLimit({
  windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.auth?.userId ?? req.ip}`,
  message: { success: false, message: 'Slow down a little — try again in a minute.' }
});

router.get('/reviews', ...read, reviews.list);
router.post('/reviews/:id/draft-reply', ...write, perUser, reviews.draftReply);
router.post('/reviews/:id/reply', ...write, reviews.sendReply);

export default router;
