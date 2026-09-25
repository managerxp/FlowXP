import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as expenses from '../controllers/expenses.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness(), requirePermission('expenses')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('expenses')];

router.get('/', ...authed, expenses.list);
router.post('/', ...write, requireOutlet, expenses.create);
router.patch('/:id', ...write, expenses.update);
router.delete('/:id', ...write, expenses.remove);

export default router;
