'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validate, requireParamUuid } = require('../middleware/validate');
const { imageUpload } = require('../middleware/upload');
const v = require('../validators/domain');

const dashboard = require('../controllers/dashboard.controller');
const agents = require('../controllers/admin.agents.controller');
const partners = require('../controllers/admin.partners.controller');
const cooperatives = require('../controllers/cooperatives.controller');
const farmers = require('../controllers/farmers.controller');
const deliveries = require('../controllers/deliveries.controller');
const financing = require('../controllers/financing.controller');
const repayments = require('../controllers/repayments.controller');
const credit = require('../controllers/credit.controller');
const productions = require('../controllers/productions.controller');
const marketAccess = require('../controllers/marketAccess.controller');
const fieldNotes = require('../controllers/fieldNotes.controller');
const changeRequests = require('../controllers/changeRequests.controller');
const benchmarks = require('../controllers/benchmarks.controller');
const adminWallet = require('../controllers/admin.wallet.controller');
const activity = require('../controllers/activity.controller');
const notifications = require('../controllers/notifications.controller');
const uploads = require('../controllers/uploads.controller');
const profile = require('../controllers/profile.controller');

const router = express.Router();
router.use(requireAuth(), requireAdmin);

// --- Dashboard / analytics ---
router.get('/dashboard', asyncHandler(dashboard.adminDashboard));

// --- Profile ---
router.patch('/profile', validate(v.updateProfile), asyncHandler(profile.updateProfile));

// --- Agent applications + agents ---
router.get('/agent-applications', validate(v.listQuery, 'query'), asyncHandler(agents.listApplications));
router.get('/agent-applications/:applicationId', requireParamUuid('applicationId'), asyncHandler(agents.getApplication));
router.post('/agent-applications/:applicationId/decision', requireParamUuid('applicationId'), validate(v.decideAgentApplication), asyncHandler(agents.decideApplication));
router.get('/agents', validate(v.listQuery, 'query'), asyncHandler(agents.listAgents));
router.get('/agents/:agentId', requireParamUuid('agentId'), asyncHandler(agents.getAgent));
router.post('/agents/:agentId/suspend', requireParamUuid('agentId'), validate(v.suspendAgent), asyncHandler(agents.suspendAgent));
router.post('/agents/:agentId/reactivate', requireParamUuid('agentId'), asyncHandler(agents.reactivateAgent));

// --- Partners (lenders/investors) — admin-controlled onboarding only ---
router.get('/partners', validate(v.listQuery, 'query'), asyncHandler(partners.listPartners));
router.post('/partners', validate(v.createPartner), asyncHandler(partners.createPartner));
router.get('/partners/:partnerId', requireParamUuid('partnerId'), asyncHandler(partners.getPartner));
router.patch('/partners/:partnerId', requireParamUuid('partnerId'), validate(v.updatePartner), asyncHandler(partners.updatePartner));
router.post('/partners/:partnerId/suspend', requireParamUuid('partnerId'), asyncHandler(partners.suspendPartner));
router.post('/partners/:partnerId/reactivate', requireParamUuid('partnerId'), asyncHandler(partners.reactivatePartner));
router.post('/partners/:partnerId/reset-password', requireParamUuid('partnerId'), asyncHandler(partners.resetPartnerPassword));

// --- Cooperatives ---
router.get('/cooperatives', validate(v.listQuery, 'query'), asyncHandler(cooperatives.list));
router.get('/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), asyncHandler(cooperatives.getById));
router.patch('/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), validate(v.updateCooperative), asyncHandler(cooperatives.update));
router.delete('/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), asyncHandler(cooperatives.remove));

// --- Farmers ---
router.get('/farmers', validate(v.listQuery, 'query'), asyncHandler(farmers.list));
router.get('/farmers/:farmerId', requireParamUuid('farmerId'), asyncHandler(farmers.getById));
router.patch('/farmers/:farmerId', requireParamUuid('farmerId'), validate(v.updateFarmer), asyncHandler(farmers.update));
router.delete('/farmers/:farmerId', requireParamUuid('farmerId'), asyncHandler(farmers.remove));
router.get('/farmers/:farmerId/financing-history', requireParamUuid('farmerId'), asyncHandler(farmers.getFinancingHistory));
router.get('/farmers/:farmerId/seasonal-yield', requireParamUuid('farmerId'), asyncHandler(productions.farmerSeasonalYield));
router.get('/farmers/:farmerId/market-access', requireParamUuid('farmerId'), asyncHandler(marketAccess.listByFarmer));
router.get('/farmers/:farmerId/field-notes', requireParamUuid('farmerId'), asyncHandler(fieldNotes.listByFarmer));
router.post('/farmers/:farmerId/map-farm', requireParamUuid('farmerId'), validate(v.mapFarm), asyncHandler(farmers.mapFarm));

// --- Seasonal yield / productions + verification ---
router.get('/productions', validate(v.listQuery, 'query'), asyncHandler(productions.list));
router.get('/productions/:productionId', requireParamUuid('productionId'), asyncHandler(productions.getById));
router.patch('/productions/:productionId', requireParamUuid('productionId'), validate(v.updateProduction), asyncHandler(productions.update));
router.post('/productions/:productionId/verify', requireParamUuid('productionId'), validate(v.verifyProduction), asyncHandler(productions.verify));
router.get('/cooperatives/:cooperativeId/yield-volume', requireParamUuid('cooperativeId'), asyncHandler(productions.cooperativeYieldVolume));

// --- Pending changes (review + decide) ---
router.get('/change-requests', validate(v.listQuery, 'query'), asyncHandler(changeRequests.list));
router.get('/change-requests/:changeRequestId', requireParamUuid('changeRequestId'), asyncHandler(changeRequests.getById));
router.post('/change-requests/:changeRequestId/decision', requireParamUuid('changeRequestId'), validate(v.decideChangeRequest), asyncHandler(changeRequests.decide));

// --- Deliveries ---
router.get('/deliveries', validate(v.listQuery, 'query'), asyncHandler(deliveries.list));

// --- Financing ---
router.get('/financing-requests', validate(v.listQuery, 'query'), asyncHandler(financing.list));
router.get('/financing-requests/:requestId', requireParamUuid('requestId'), asyncHandler(financing.getById));
router.post('/financing-requests/:requestId/decision', requireParamUuid('requestId'), validate(v.adminDecideFinancing), asyncHandler(financing.adminDecide));

// --- Repayments ---
router.get('/repayments', validate(v.listQuery, 'query'), asyncHandler(repayments.list));
router.get('/repayments/:repaymentId', requireParamUuid('repaymentId'), asyncHandler(repayments.getById));
router.post('/repayments/:repaymentId/void', requireParamUuid('repaymentId'), validate(v.voidRepayment), asyncHandler(repayments.voidRepayment));

// --- Credit scoring ---
router.get('/credit/farmers', validate(v.listQuery, 'query'), asyncHandler(credit.listFarmerScores));
router.get('/credit/farmers/:farmerId', requireParamUuid('farmerId'), asyncHandler(credit.getFarmerScore));
router.post('/credit/farmers/:farmerId/recalculate', requireParamUuid('farmerId'), asyncHandler(credit.recalcFarmer));
router.get('/credit/farmers/:farmerId/report', requireParamUuid('farmerId'), asyncHandler(credit.farmerCreditReport));
router.get('/credit/cooperatives', validate(v.listQuery, 'query'), asyncHandler(credit.listCooperativeScores));
router.get('/credit/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), asyncHandler(credit.getCooperativeScore));
router.post('/credit/cooperatives/:cooperativeId/recalculate', requireParamUuid('cooperativeId'), asyncHandler(credit.recalcCooperative));
router.get('/credit/cooperatives/:cooperativeId/report', requireParamUuid('cooperativeId'), asyncHandler(credit.cooperativeCreditReport));

// --- Benchmarks ---
router.get('/benchmarks', validate(v.listQuery, 'query'), asyncHandler(benchmarks.list));
router.post('/benchmarks', asyncHandler(benchmarks.upsert));

// --- Wallet / settlements / manual payment flow ---
router.get('/wallets', validate(v.listQuery, 'query'), asyncHandler(adminWallet.listAllWallets));
router.get('/settlements', validate(v.listQuery, 'query'), asyncHandler(adminWallet.listSettlements));
router.post('/settlements/:settlementId/decision', requireParamUuid('settlementId'), validate(v.decideSettlement), asyncHandler(adminWallet.decideSettlement));
// NEW — admin records a manual transfer of cash to a field agent with receipt proof
router.post('/disbursements', validate(v.recordAgentDisbursement), asyncHandler(adminWallet.recordAgentDisbursement));
router.get('/transactions', validate(v.listQuery, 'query'), asyncHandler(adminWallet.listAllTransactions));
// NEW — field-agent purchase proofs: list + confirm/reject
router.get('/cash-purchases', validate(v.listQuery, 'query'), asyncHandler(adminWallet.listCashPurchases));
router.post('/cash-purchases/:transactionId/confirm', requireParamUuid('transactionId'), validate(v.confirmCashPurchase), asyncHandler(adminWallet.confirmCashPurchase));

// --- Activity logs ---
router.get('/activity-logs', validate(v.listQuery, 'query'), asyncHandler(activity.list));

// --- Notifications (admin's own) ---
router.get('/notifications', asyncHandler(notifications.list));
router.get('/notifications/unread-count', asyncHandler(notifications.unreadCount));
router.patch('/notifications/:notificationId/read', requireParamUuid('notificationId'), asyncHandler(notifications.markRead));
router.patch('/notifications/read-all', asyncHandler(notifications.markAllRead));

// --- Uploads (partner logos, receipt images, proof images, etc.) ---
router.post('/uploads/:kind', imageUpload.single('file'), asyncHandler(uploads.uploadGeneric));

// --- PDF export data (admin can pull any agent / farmer / coop) ---
router.get('/exports/agent', validate(v.listQuery, 'query'), asyncHandler(dashboard.agentExport));
router.get('/exports/farmer/:farmerId', requireParamUuid('farmerId'), asyncHandler(dashboard.farmerExport));
router.get('/exports/cooperative/:cooperativeId', requireParamUuid('cooperativeId'), asyncHandler(dashboard.cooperativeExport));

module.exports = router;
