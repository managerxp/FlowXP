import { Router } from 'express';
import { requireAuth, withBusiness, requirePermission, requireGroupUser } from '../middleware/auth.js';
import * as gst from '../controllers/gst.controller.js';

const router = Router();
// Filing covers every outlet under a GSTIN, so it is for people who can see the whole business.
const read = [requireAuth, withBusiness(), requirePermission('gst'), requireGroupUser];
const write = [requireAuth, withBusiness({ requireActive: true }), requirePermission('gst'), requireGroupUser];

router.get('/gst/settings', ...read, gst.getSettings);
router.put('/gst/settings', ...write, gst.putSettings);
router.get('/gst/filings', ...read, gst.filings);
router.get('/gst/gstr1', ...read, gst.gstr1);
router.get('/gst/gstr3b', ...read, gst.gstr3b);
router.get('/gst/einvoice', ...read, gst.einvoiceList);
router.get('/gst/invoices/:id/einvoice', ...read, gst.einvoiceOne);
router.post('/gst/invoices/:id/irn', ...write, gst.recordIrn);
router.post('/gst/eway-bill', ...read, gst.ewayBill);
router.post('/gst/invoices/:id/eway-bill', ...write, gst.recordEwayBill);

export default router;
