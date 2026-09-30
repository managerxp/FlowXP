/*
 * All reads. The GST report is gated separately on 'gst' rather than
 * 'reports' — MANAGER holds 'reports' but not 'gst' in ROLE_PERMISSIONS,
 * because filing exposure is an owner/admin concern even on a team where a
 * manager runs every other report.
 */
import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as reports from '../controllers/reports.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('reports')];

router.get('/sales', ...authed, reports.sales);
router.get('/waiters', ...authed, reports.waiters);
router.get('/purchases', ...authed, reports.purchases);
router.get('/expenses', ...authed, reports.expenses);
router.get('/outstanding', ...authed, reports.outstanding);
router.get('/inventory', ...authed, reports.inventory);
router.get('/customers', ...authed, reports.customers);
router.get('/gst', requireAuth, withBusiness(), requirePermission('gst'), reports.gst);
router.get('/gst/register', requireAuth, withBusiness(), requirePermission('gst'), reports.gstRegister);

export default router;
