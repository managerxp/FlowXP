import { Router } from 'express';
import { requireAuth, requireGroupUser, requirePermission, withBusiness } from '../middleware/auth.js';
import * as loyalty from '../controllers/loyalty.controller.js';
import * as points from '../controllers/points.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness()];
const till = requirePermission('billing');
const settingsRead = [...authed, requirePermission('settings')];
const settingsWrite = [requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), requireGroupUser];

/* The till: look a customer up by mobile, see their card, check a coupon. */
router.get('/loyalty/lookup', ...authed, till, loyalty.lookup);
router.get('/loyalty/customers/:id', ...authed, till, loyalty.customerCard);
router.post('/coupons/check', ...authed, till, loyalty.checkCoupon);
router.get('/loyalty/customers/:id/points', ...authed, till, points.customerPoints);

/* The owner: set the program, see how it is doing, manage coupons. */
router.get('/loyalty/program', ...authed, till, loyalty.getProgramSettings);
router.put('/loyalty/program', ...settingsWrite, loyalty.putProgram);
router.get('/loyalty/summary', ...settingsRead, loyalty.summary);
router.get('/loyalty/points-program', ...authed, till, points.getProgram);
router.put('/loyalty/points-program', ...settingsWrite, points.putProgram);
router.get('/loyalty/points-summary', ...settingsRead, points.summary);
router.post('/loyalty/customers/:id/points/adjust', ...settingsWrite, points.adjust);
router.get('/coupons', ...settingsRead, loyalty.listCoupons);
router.post('/coupons', ...settingsWrite, loyalty.createCoupon);
router.put('/coupons/:id', ...settingsWrite, loyalty.updateCoupon);

export default router;
