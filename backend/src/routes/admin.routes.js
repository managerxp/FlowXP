/*
 * Super admin routes — mounted at /api/admin. Every route past login sits
 * behind requireAuth + requireSuperAdmin, the same two-step gate the rest of
 * the API uses for requireAuth + withBusiness, just checking a platform-level
 * flag instead of a tenant membership.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import * as admin from '../controllers/admin.controller.js';

const router = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' }
});

router.post('/login', adminLoginLimiter, admin.login);

router.use(requireAuth, requireSuperAdmin);

router.get('/me', admin.me);
router.get('/stats', admin.getStats);

router.get('/businesses', admin.listBusinesses);
router.get('/businesses/:id', admin.getBusiness);
router.patch('/businesses/:id/status', admin.updateBusinessStatus);

router.get('/plans', admin.listPlans);
router.patch('/plans/:code', admin.updatePlan);

export default router;
