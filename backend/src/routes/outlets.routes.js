import { Router } from 'express';
import { requireAuth, requireGroupUser, requireOwner, requirePermission, withBusiness } from '../middleware/auth.js';
import * as outlets from '../controllers/outlets.controller.js';
import * as staff from '../controllers/staff.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness()];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('settings'), requireGroupUser];

router.get('/outlets', ...authed, outlets.list);
router.get('/outlets/compare', ...authed, requirePermission('reports'), requireGroupUser, outlets.compare);
router.post('/outlets', ...write, outlets.create);
router.put('/outlets/:id', ...write, outlets.update);

router.get('/staff', ...authed, requirePermission('settings'), staff.list);
router.post('/staff', ...write, staff.invite);
router.put('/staff/:userId', ...write, staff.update);
router.get('/staff/:userId/permissions', ...authed, requireOwner, staff.getPermissions);
router.put('/staff/:userId/permissions', requireAuth, withBusiness({ requireActive: true }), requireOwner, staff.putPermissions);

export default router;
