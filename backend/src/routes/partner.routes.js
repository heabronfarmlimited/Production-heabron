'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requirePartner } = require('../middleware/auth');
const { validate, requireParamUuid } = require('../middleware/validate');
const v = require('../validators/domain');

const dashboard = require('../controllers/dashboard.controller');
const partner = require('../controllers/partner.controller');
const credit = require('../controllers/credit.controller');
const financing = require('../controllers/financing.controller');
const productions = require('../controllers/productions.controller');
const marketAccess = require('../controllers/marketAccess.controller');
const fieldNotes = require('../controllers/fieldNotes.controller');
const notifications = require('../controllers/notifications.controller');
const profile = require('../controllers/profile.controller');
const uploads = require('../controllers/uploads.controller');
const { imageUpload } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth(), requirePartner);

router.get('/dashboard', asyncHandler(dashboard.partnerDashboard));
router.patch('/profile', validate(v.updateProfile), asyncHandler(profile.updateProfile));
router.delete('/profile', asyncHandler(profile.deleteAccount));

// Partner organisation — view + self-edit (in case admin made a mistake at
// onboarding). Email is NOT editable here (it is the login identity).
router.get('/organization', asyncHandler(partner.getMyOrganization));
router.patch('/organization', validate(v.updatePartnerSelf), asyncHandler(partner.updateMyOrganization));

// Logo / image upload for the partner's own organisation
router.post('/uploads/:kind', imageUpload.single('file'), asyncHandler(uploads.uploadGeneric));

// Borrower search + portfolio + watchlist — all SCOPED to the partner's
// forwarded data only (enforced in partner.controller.js).
router.get('/search', asyncHandler(partner.search));
router.get('/portfolio', asyncHandler(partner.portfolio));
router.get('/watchlist', asyncHandler(partner.watchlist));

// Full-directory browse — partners can view ALL cooperatives & farmers (not
// just those forwarded to them), optionally filtered by the managing field agent.
router.get('/field-agents', asyncHandler(partner.fieldAgents));
router.get('/cooperatives', asyncHandler(partner.browseCooperatives));
router.get('/cooperatives/:cooperativeId/farmers', requireParamUuid('cooperativeId'), asyncHandler(partner.browseCooperativeFarmers));
router.get('/farmers', asyncHandler(partner.browseFarmers));

// Credit reports — partner-scoped (enforced in credit.controller.js).
router.get('/credit/farmers/:farmerId/report', requireParamUuid('farmerId'), asyncHandler(credit.farmerCreditReport));
router.get('/credit/cooperatives/:cooperativeId/report', requireParamUuid('cooperativeId'), asyncHandler(credit.cooperativeCreditReport));

// Borrower profile tabs (read-only) — seasonal yield, offtake history, field notes.
router.get('/farmers/:farmerId/seasonal-yield', requireParamUuid('farmerId'), asyncHandler(productions.farmerSeasonalYield));
router.get('/farmers/:farmerId/market-access', requireParamUuid('farmerId'), asyncHandler(marketAccess.listByFarmer));
router.get('/farmers/:farmerId/field-notes', requireParamUuid('farmerId'), asyncHandler(fieldNotes.listByFarmer));

// Financing requests forwarded to this partner only
router.get('/financing-requests', validate(v.listQuery, 'query'), asyncHandler(financing.list));
router.get('/financing-requests/:requestId', requireParamUuid('requestId'), asyncHandler(financing.getById));
router.post('/financing-requests/:requestId/decision', requireParamUuid('requestId'), validate(v.partnerDecideFinancing), asyncHandler(financing.partnerDecide));

// Notifications
router.get('/notifications', asyncHandler(notifications.list));
router.get('/notifications/unread-count', asyncHandler(notifications.unreadCount));
router.patch('/notifications/:notificationId/read', requireParamUuid('notificationId'), asyncHandler(notifications.markRead));
router.patch('/notifications/read-all', asyncHandler(notifications.markAllRead));

module.exports = router;
