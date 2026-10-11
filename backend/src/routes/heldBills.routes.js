/*
 * Bills on hold at the till. Everything is for the outlet being billed at, so
 * writes need a concrete outlet (not the "All outlets" view).
 */
import { Router } from 'express';
import { idempotent } from '../middleware/idempotency.js';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as held from '../controllers/heldBills.controller.js';

const router = Router();
const read = [requireAuth, withBusiness(), requirePermission('billing')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('billing'), requireOutlet];

router.get('/held-bills', ...read, held.list);
router.post('/held-bills', ...write, idempotent(), held.hold);
router.delete('/held-bills/:id', ...write, held.remove);

export default router;
