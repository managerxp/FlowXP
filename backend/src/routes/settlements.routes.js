import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as settlements from '../controllers/settlements.controller.js';

const router = Router();
// Reuses the existing `integrations` feature — reconciliation is squarely part of
// "does this business use delivery-platform integrations", not a separate toggle.
const feature = requirePlanFeature('integrations');
const read = [requireAuth, withBusiness(), feature, requirePermission('settings')];
const write = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('settings')];

router.get('/settlements', ...read, settlements.list);
router.get('/settlements/missing', ...read, settlements.missing);
router.post('/settlements/import', ...write, settlements.importStatement);

export default router;
