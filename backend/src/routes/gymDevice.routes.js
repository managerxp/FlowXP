/*
 * /api/device/v1/* — what a gate or reader device calls. No staff session: every request is signed with the device's own secret (see modules/gym/devices.js and
 * GYM_DEVICES.md). A request that is not signed correctly, is too old, or comes from a switched-off device or a gym without the feature gets the same 401.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { access, ack, batch, deviceAuth, heartbeat } from '../controllers/gymDevices.controller.js';

const router = Router();
// per device, not per address: a gym's readers share one connection. The key is the device's public id.
const perDevice = rateLimit({
  windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `device:${String(req.headers['x-device-key'] || 'none').slice(0, 30)}`,
  message: { success: false, message: 'Too many requests' }
});

router.use(perDevice);
router.post('/access', deviceAuth, access);
router.post('/ack', deviceAuth, ack);
router.post('/heartbeat', deviceAuth, heartbeat);
router.post('/events/batch', deviceAuth, batch);

export default router;
