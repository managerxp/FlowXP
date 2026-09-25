import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as invoices from '../controllers/invoices.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('billing')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('billing')];

router.get('/', ...authed, invoices.list);
router.get('/:id', ...authed, invoices.get);
router.post('/', ...write, requireOutlet, idempotent(), invoices.create);
router.post('/:id/payments', ...write, idempotent(), invoices.addPayment);
router.post('/:id/refund', requireAuth, withBusiness({ requireActive: true }), requirePermission('refunds'), idempotent(), invoices.refund);
router.post('/:id/cancel', ...write, idempotent(), invoices.cancel);

export default router;
