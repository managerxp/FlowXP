import { Router } from 'express';
import { requireAuth, withBusiness, requireAnyPermission, requireOutlet } from '../middleware/auth.js';
import * as sync from '../controllers/sync.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requireAnyPermission('billing', 'sales_orders', 'fulfilment'), requireOutlet];   // a cashier, a field rep who takes orders on the phone, or a warehouse worker who scans while picking

router.get('/head', ...authed, sync.getHead);
router.get('/changes', ...authed, sync.changes);

export default router;
