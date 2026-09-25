import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import * as menu from '../controllers/menu.controller.js';

const router = Router();
const authed = [requireAuth, withBusiness()];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('products')];
// Choosing modifiers at the till needs read access without catalogue-edit rights.
const read = requireAnyPermission('products', 'billing');

router.get('/modifier-groups', ...authed, read, menu.listGroups);
router.post('/modifier-groups', ...write, menu.createGroup);
router.put('/modifier-groups/:id', ...write, menu.updateGroup);
router.put('/products/:id/modifier-groups', ...write, menu.setProductGroups);

router.get('/products/:id/combo', ...authed, read, menu.getCombo);
router.put('/products/:id/combo', ...write, menu.setCombo);
router.delete('/products/:id/combo', ...write, menu.clearCombo);

router.get('/products/:id/recipe', ...authed, requirePermission('products'), menu.getRecipe);
router.put('/products/:id/recipe', ...write, menu.setRecipe);

export default router;
