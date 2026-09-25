import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireOutlet } from '../middleware/auth.js';
import * as r from '../controllers/reservations.controller.js';

const router = Router();
const read = [requireAuth, withBusiness(), requirePermission('billing')];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('billing')];

router.get('/reservations', ...read, r.list);
router.get('/reservations/availability', ...read, r.availability);
router.post('/reservations', ...write, requireOutlet, r.create);
router.patch('/reservations/:id', ...write, r.update);
router.post('/reservations/:id/status', ...write, r.setStatus);
router.post('/reservations/:id/seat', ...write, r.seat);

router.get('/waitlist', ...read, r.waitlist);
router.post('/waitlist', ...write, requireOutlet, r.waitlistAdd);
router.post('/waitlist/:id/notify', ...write, r.waitlistNotify);
router.post('/waitlist/:id/seat', ...write, r.waitlistSeat);
router.post('/waitlist/:id/leave', ...write, r.waitlistLeave);

export default router;
