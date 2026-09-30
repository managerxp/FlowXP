/*
 * Super admin routes — mounted at /api/admin. Every route past login sits
 * behind requireAuth + requireSuperAdmin, the same two-step gate the rest of
 * the API uses for requireAuth + withBusiness, just checking a platform-level
 * flag instead of a tenant membership.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import * as admin from '../controllers/admin.controller.js';
import * as settings from '../controllers/settings.controller.js';

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
router.patch('/businesses/:id/plan', admin.updateBusinessPlan);
router.get('/businesses/:id/history', admin.businessHistory);
router.get('/businesses/:id/overrides', admin.listBusinessOverrides);
router.post('/businesses/:id/overrides', admin.setBusinessOverride);
router.delete('/businesses/:id/overrides/:feature', admin.removeBusinessOverride);

router.get('/plans', admin.listPlans);
router.patch('/plans/:code', admin.updatePlan);
router.get('/plans/:code/versions', admin.listPlanVersions);
router.get('/plan-features', admin.planFeatureCatalog);
router.get('/business-type-features', admin.listBusinessTypeFeatures);
router.patch('/business-type-features/:type/:plan', admin.updateBusinessTypeFeature);

router.get('/businesses/:id/payment-links', admin.listPaymentLinks);
router.post('/businesses/:id/payment-link', idempotent((req) => `admin:${req.auth.userId}`), admin.createPaymentLink);

router.get('/addons', admin.listAddons);
router.post('/addons', admin.createAddon);
router.patch('/addons/:key', admin.updateAddon);
router.delete('/addons/:key', admin.deleteAddon);
router.get('/businesses/:id/addon-links', admin.listAddonLinks);
router.post('/businesses/:id/addon-link', idempotent((req) => `admin:${req.auth.userId}`), admin.createAddonLink);

router.get('/settings/payment-gateway', settings.getPaymentGateway);
router.put('/settings/payment-gateway', settings.updatePaymentGateway);
router.get('/settings/email', settings.getEmailSettings);
router.put('/settings/email', settings.updateEmailSettings);
router.get('/settings/messaging', settings.getMessagingSettings);
router.put('/settings/messaging', settings.updateMessagingSettings);

export default router;
