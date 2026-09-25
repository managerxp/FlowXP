import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import * as customers from '../controllers/customers.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness()];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('customers')];
// Billing needs to find a customer without holding customer-record edit rights.
const read = requireAnyPermission('customers', 'billing');

router.get('/', ...authed, read, customers.list);
router.get('/:id', ...authed, read, customers.get);
router.get('/:id/invoices', ...authed, read, customers.invoiceHistory);
router.post('/', ...write, customers.create);
router.patch('/:id', ...write, customers.update);

export default router;
