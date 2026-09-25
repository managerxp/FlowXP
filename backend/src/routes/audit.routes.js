import { Router } from 'express';
import { requireAuth, requirePermission, withBusiness } from '../middleware/auth.js';
import * as audit from '../controllers/audit.controller.js';

const router = Router();

/* The activity log is for the people who manage the business (owners and admins hold 'settings'). */
router.get('/', requireAuth, withBusiness(), requirePermission('settings'), audit.list);

export default router;
