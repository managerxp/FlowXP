import { Router } from 'express';
import { requireAuth, requireGroupUser, requirePermission, requirePlanFeature, withBusiness } from '../middleware/auth.js';
import * as l from '../controllers/loyaltyEngine.controller.js';

const router = Router();
const feature = requirePlanFeature('loyalty_programmes');
const till = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('billing')];   // staff at the till: find a member, credit, redeem
const owner = [requireAuth, withBusiness({ requireActive: true }), feature, requirePermission('settings'), requireGroupUser];   // making and changing programmes, switching a member off, reversing

router.get('/loyalty/programme-kinds', ...till, l.kinds);
router.get('/loyalty/programmes', ...till, l.listProgrammes);
router.post('/loyalty/programmes', ...owner, l.createProgramme);
router.put('/loyalty/programmes/:id', ...owner, l.updateProgramme);

router.get('/loyalty/members/lookup', ...till, l.lookup);
router.post('/loyalty/members', ...till, l.enrol);
router.get('/loyalty/members/:id', ...till, l.getMembership);
router.put('/loyalty/members/:id/status', ...owner, l.setMembershipStatus);
router.post('/loyalty/members/:id/earn', ...till, l.earn);
router.post('/loyalty/members/:id/redeem', ...till, l.redeem);
router.post('/loyalty/ledger/:entryId/reverse', ...owner, l.reverse);

router.get('/loyalty/rewards', ...till, l.listRewards);
router.post('/loyalty/rewards', ...owner, l.createReward);
router.put('/loyalty/rewards/:id', ...owner, l.updateReward);
router.get('/loyalty/members/:id/rewards', ...till, l.memberRewards);
router.get('/loyalty/customers/:id/claims', ...till, l.customerClaims);
router.post('/loyalty/members/:id/claim', ...till, l.claimReward);
router.post('/loyalty/claims/:id/cancel', ...owner, l.cancelClaim);

export default router;
