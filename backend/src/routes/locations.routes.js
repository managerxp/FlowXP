import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as locations from '../controllers/locations.controller.js';

const router = Router();

router.get('/pincode/:code', requireAuth, locations.pincode);

export default router;
