import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePermission, withBusiness } from '../middleware/auth.js';
import { uploadMenuPhotos } from '../middleware/upload.js';
import * as menuImport from '../controllers/menuImport.controller.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('products')];

/* Each scan costs an AI request, so a person is limited on top of the plan's monthly allowance. */
const scanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.auth?.userId ?? req.ip}`,
  message: { success: false, message: 'Too many scans in a short time. Try again in a few minutes.' }
});

router.post('/scan', ...write, scanLimiter, uploadMenuPhotos, menuImport.scan,
  // multer's own errors (wrong type, too large) use the same response shape as everything else
  (error, _req, res, _next) => res.status(400).json({ success: false, message: error.message || 'Could not read that photo' }));
router.post('/confirm', ...write, idempotent(), menuImport.confirm);

export default router;
