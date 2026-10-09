import { Router } from 'express';
import { requireAuth, withBusiness } from '../middleware/auth.js';
import * as notifications from '../controllers/notifications.controller.js';

const router = Router();
// Any member of the business, including after the trial ends: reading your own notifications is never gated.
const member = [requireAuth, withBusiness()];

// a phone belongs to a person, not to one business: no business needs to be chosen
router.post('/devices', requireAuth, notifications.addDevice);
router.delete('/devices', requireAuth, notifications.dropDevice);

router.get('/', ...member, notifications.index);
router.get('/count', ...member, notifications.count);
router.get('/preferences', ...member, notifications.getPreferences);
router.put('/preferences', ...member, notifications.putPreferences);
router.post('/read-all', ...member, notifications.readAll);
router.post('/:id/read', ...member, notifications.read);

export default router;
