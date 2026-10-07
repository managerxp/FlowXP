import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as sync from '../controllers/sync.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('billing'), requireOutlet];

router.get('/head', ...authed, sync.getHead);
router.get('/changes', ...authed, sync.changes);

export default router;
