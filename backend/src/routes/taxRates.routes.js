import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission } from '../middleware/auth.js';
import * as taxRates from '../controllers/taxRates.controller.js';

/* Named GST rates: anyone who works with products may read the list (the product form and the till pick from it); changing it is settings. */
const router = Router();
router.get('/', requireAuth, withBusiness(), taxRates.list);
router.post('/', requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), taxRates.create);
router.patch('/:id', requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), taxRates.update);

export default router;
