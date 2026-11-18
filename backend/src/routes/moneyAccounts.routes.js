import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requirePlanFeature } from '../middleware/auth.js';
import * as accounts from '../controllers/moneyAccounts.controller.js';

/* Cash, bank and loan accounts. Seeing them is reports; setting them up is settings; moving money is payments. */
const router = Router();
const feature = requirePlanFeature('money_accounts');
const read = [requireAuth, withBusiness(), feature, requirePermission('reports')];
const setup = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('settings')];
const move = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('payments')];

router.get('/', ...read, accounts.list);
router.post('/', ...setup, accounts.create);
router.put('/methods', ...setup, accounts.setMethods);
router.post('/transfers', ...move, accounts.createTransfer);
router.post('/transfers/:id/void', ...move, accounts.voidTransfer);
router.patch('/:id', ...setup, accounts.update);
router.get('/:id/statement', ...read, accounts.accountStatement);

export default router;
