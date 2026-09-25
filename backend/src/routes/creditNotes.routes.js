import { Router } from 'express';
import { requireAuth, requirePermission, withBusiness } from '../middleware/auth.js';
import * as notes from '../controllers/creditNotes.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
const read = [requireAuth, withBusiness(), requirePermission('billing')];

/* Issuing one changes revenue and GST, so it needs the same permission as refunds. */
router.get('/invoices/:id/credit-notes/options', ...read, notes.options);
router.post('/invoices/:id/credit-notes', requireAuth, withBusiness({ requireActive: true }), requirePermission('refunds'), idempotent(), notes.create);
router.get('/credit-notes', ...read, notes.list);
router.get('/credit-notes/:id', ...read, notes.get);

export default router;
