import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireOwner, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import * as ai from '../controllers/ai.controller.js';

const router = Router();
const feature = requirePlanFeature('ai');
const read = [requireAuth, withBusiness(), feature, requirePermission('ai')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('ai')];

/* Each question costs money, so a person is limited on top of the plan's monthly allowance. */
const perUser = rateLimit({
  windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.auth?.userId ?? req.ip}`,
  message: { success: false, message: 'Slow down a little — try again in a minute.' }
});

router.get('/status', ...read, ai.status);
router.get('/conversations', ...read, ai.conversations);
router.get('/conversations/:id', ...read, ai.conversation);
router.post('/chat', ...write, perUser, ai.chat);
router.post('/briefing', ...write, perUser, ai.briefing);
router.post('/onboarding-chat', ...write, perUser, ai.onboardingChat);
router.put('/settings', requireAuth, withBusiness({ requireActive: true }), feature, requireOwner, ai.setEnabled);

export default router;
