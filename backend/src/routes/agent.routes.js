'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireFieldAgent } = require('../middleware/auth');
const { validate, requireParamUuid } = require('../middleware/validate');
const { imageUpload, docUpload, csvUpload } = require('../middleware/upload');
const v = require('../validators/domain');

const dashboard = require('../controllers/dashboard.controller');
const cooperatives = require('../controllers/cooperatives.controller');
const farmers = require('../controllers/farmers.controller');
const deliveries = require('../controllers/deliveries.controller');
const financing = require('../controllers/financing.controller');
const repayments = require('../controllers/repayments.controller');
const productions = require('../controllers/productions.controller');
const marketAccess = require('../controllers/marketAccess.controller');
const fieldNotes = require('../controllers/fieldNotes.controller');
const changeRequests = require('../controllers/changeRequests.controller');
const wallet = require('../controllers/wallet.controller');
const notifications = require('../controllers/notifications.controller');
const uploads = require('../controllers/uploads.controller');
const imports = require('../controllers/imports.controller');
const profile = require('../controllers/profile.controller');

const router = express.Router();

// All field-agent routes require auth + active agent status
router.use(requireAuth(), requireFieldAgent);

// --- Dashboard ---
router.get('/dashboard', asyncHandler(dashboard.agentDashboard));

// --- Profile ---
router.patch('/profile', validate(v.updateProfile), asyncHandler(profile.updateProfile));
router.delete('/profile', asyncHandler(profile.deleteAccount));
router.get('/profile/export', asyncHandler(profile.exportMyData));
router.get('/bank-account', asyncHandler(profile.getBankAccount));
router.put('/bank-account', validate(v.saveBankAccount), asyncHandler(profile.saveBankAccount));

// --- Cooperatives ---
router.get('/cooperatives', validate(v.listQuery, 'query'), asyncHandler(cooperatives.list));
router.post('/cooperatives', validate(v.createCooperative), asyncHandler(cooperatives.create));
router.get('/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), asyncHandler(cooperatives.getById));
router.patch('/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), validate(v.updateCooperative), asyncHandler(cooperatives.update));
router.delete('/cooperatives/:cooperativeId', requireParamUuid('cooperativeId'), asyncHandler(cooperatives.remove));
router.get('/cooperatives/:cooperativeId/farmers', requireParamUuid('cooperativeId'), validate(v.listQuery, 'query'), asyncHandler(cooperatives.listFarmers));

// --- Farmers ---
router.get('/farmers', validate(v.listQuery, 'query'), asyncHandler(farmers.list));
router.post('/farmers', validate(v.createFarmer), asyncHandler(farmers.create));
router.get('/farmers/:farmerId', requireParamUuid('farmerId'), asyncHandler(farmers.getById));
router.patch('/farmers/:farmerId', requireParamUuid('farmerId'), validate(v.updateFarmer), asyncHandler(farmers.update));
router.delete('/farmers/:farmerId', requireParamUuid('farmerId'), asyncHandler(farmers.remove));
router.post('/farmers/:farmerId/verify-nin', requireParamUuid('farmerId'), asyncHandler(farmers.verifyNin));
router.post('/farmers/:farmerId/map-farm', requireParamUuid('farmerId'), validate(v.mapFarm), asyncHandler(farmers.mapFarm));
router.get('/farmers/:farmerId/credit-score', requireParamUuid('farmerId'), asyncHandler(farmers.getCreditScore));
router.get('/farmers/:farmerId/seasonal-yield', requireParamUuid('farmerId'), asyncHandler(productions.farmerSeasonalYield));
router.get('/farmers/:farmerId/market-access', requireParamUuid('farmerId'), asyncHandler(marketAccess.listByFarmer));
router.get('/farmers/:farmerId/field-notes', requireParamUuid('farmerId'), asyncHandler(fieldNotes.listByFarmer));

// --- Production / Yield (seasonal) ---
router.get('/productions', validate(v.listQuery, 'query'), asyncHandler(productions.list));
router.post('/productions', validate(v.createProduction), asyncHandler(productions.create));
router.get('/productions/:productionId', requireParamUuid('productionId'), asyncHandler(productions.getById));
router.patch('/productions/:productionId', requireParamUuid('productionId'), validate(v.updateProduction), asyncHandler(productions.update));
router.delete('/productions/:productionId', requireParamUuid('productionId'), asyncHandler(productions.remove));

// --- Market access (offtake history) ---
router.post('/market-access', validate(v.createMarketAccess), asyncHandler(marketAccess.create));
router.patch('/market-access/:recordId', requireParamUuid('recordId'), validate(v.updateMarketAccess), asyncHandler(marketAccess.update));
router.delete('/market-access/:recordId', requireParamUuid('recordId'), asyncHandler(marketAccess.remove));

// --- Field notes (timeline) ---
router.post('/field-notes', validate(v.createFieldNote), asyncHandler(fieldNotes.create));
router.patch('/field-notes/:noteId', requireParamUuid('noteId'), validate(v.updateFieldNote), asyncHandler(fieldNotes.update));
router.delete('/field-notes/:noteId', requireParamUuid('noteId'), asyncHandler(fieldNotes.remove));

// --- Change requests (edits submitted for admin approval) ---
router.get('/change-requests', validate(v.listQuery, 'query'), asyncHandler(changeRequests.list));
router.post('/change-requests', validate(v.createChangeRequest), asyncHandler(changeRequests.create));
router.get('/change-requests/:changeRequestId', requireParamUuid('changeRequestId'), asyncHandler(changeRequests.getById));

// --- Deliveries ---
router.get('/deliveries', validate(v.listQuery, 'query'), asyncHandler(deliveries.list));
router.post('/deliveries', validate(v.createDelivery), asyncHandler(deliveries.create));
router.get('/deliveries/:deliveryId', requireParamUuid('deliveryId'), asyncHandler(deliveries.getById));

// --- Financing ---
router.get('/financing-requests', validate(v.listQuery, 'query'), asyncHandler(financing.list));
router.post('/financing-requests', validate(v.createFinancingRequest), asyncHandler(financing.create));
router.get('/financing-requests/:requestId', requireParamUuid('requestId'), asyncHandler(financing.getById));

// --- Repayments ---
router.get('/repayments', validate(v.listQuery, 'query'), asyncHandler(repayments.list));
router.post('/repayments', validate(v.createRepayment), asyncHandler(repayments.create));

// --- Wallet ---
router.get('/wallet', asyncHandler(wallet.getWallet));
router.get('/wallet/transactions', validate(v.listQuery, 'query'), asyncHandler(wallet.listTransactions));
router.get('/wallet/transactions/:transactionId', requireParamUuid('transactionId'), asyncHandler(wallet.getTransaction));
router.post('/wallet/settlements', validate(v.createSettlement), asyncHandler(wallet.requestSettlement));
router.get('/wallet/settlements', validate(v.listQuery, 'query'), asyncHandler(wallet.listSettlements));

// --- Notifications ---
router.get('/notifications', validate(v.listQuery, 'query'), asyncHandler(notifications.list));
router.get('/notifications/unread-count', asyncHandler(notifications.unreadCount));
router.patch('/notifications/:notificationId/read', requireParamUuid('notificationId'), asyncHandler(notifications.markRead));
router.patch('/notifications/read-all', asyncHandler(notifications.markAllRead));
router.delete('/notifications', asyncHandler(notifications.clearAll));

// --- File uploads ---
router.post('/uploads/:kind', imageUpload.single('file'), asyncHandler(uploads.uploadGeneric));
router.post('/uploads-doc/:kind', docUpload.single('file'), asyncHandler(uploads.uploadGeneric));
router.post('/uploads/sign-url', asyncHandler(uploads.signUrl));

// --- Bulk CSV import ---
router.post('/imports', csvUpload.single('file'), asyncHandler(imports.bulkImport));
router.get('/imports', validate(v.listQuery, 'query'), asyncHandler(imports.listImports));
router.get('/imports/template', asyncHandler(imports.downloadTemplate));

module.exports = router;
