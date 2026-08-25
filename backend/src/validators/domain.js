'use strict';

const Joi = require('joi');

const uuid = Joi.string().guid({ version: ['uuidv4', 'uuidv1'] });
const gpsLat = Joi.number().min(-90).max(90);
const gpsLng = Joi.number().min(-180).max(180);

// =============================================================================
// COOPERATIVES
// =============================================================================
const createCooperative = Joi.object({
  name: Joi.string().min(2).max(150).required(),
  registrationNumber: Joi.string().max(60).optional(),
  leaderName: Joi.string().max(120).optional(),
  leaderPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  cropsSupported: Joi.array().items(Joi.string()).default([]),
  state: Joi.string().required(),
  lga: Joi.string().required(),
  address: Joi.string().max(500).optional(),
  estimatedLandSize: Joi.number().min(0).optional(),
  logoUrl: Joi.string().uri().optional(),
  gpsLat: gpsLat.optional(),
  gpsLng: gpsLng.optional(),
  gpsPolygon: Joi.array().items(Joi.object({ lat: gpsLat, lng: gpsLng })).optional(),
});

const updateCooperative = createCooperative.fork(Object.keys(createCooperative.describe().keys), (s) => s.optional());

// =============================================================================
// FARMERS
// =============================================================================
const createFarmer = Joi.object({
  cooperativeId: uuid.required(),
  fullName: Joi.string().min(2).max(150).required(),
  dateOfBirth: Joi.date().iso().less('now').optional(),
  gender: Joi.string().lowercase().valid('male', 'female', 'other').optional(),
  phone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  altPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  address: Joi.string().max(500).optional(),
  state: Joi.string().optional(),
  lga: Joi.string().optional(),
  householdSize: Joi.number().integer().min(1).default(1),
  dependents: Joi.number().integer().min(0).default(0),
  educationLevel: Joi.string().max(60).optional(),
  nin: Joi.string().pattern(/^\d{11}$/).optional(),
  bvn: Joi.string().pattern(/^\d{11}$/).optional(),
  idImageUrl: Joi.string().uri().optional(),
  farmerPhotoUrl: Joi.string().uri().optional(),
  memberSince: Joi.date().iso().optional(),
  // Nested farm profile
  farm: Joi.object({
    farmSizeAcres: Joi.number().min(0).required(),
    plotCount: Joi.number().integer().min(1).default(1),
    cropType: Joi.string().required(),
    secondaryCrops: Joi.array().items(Joi.string()).max(7).optional(),
    // Soil type & water source are stored as free TEXT. Canonical values are
    // documented (soil: sandy | lateritic_red_brown | forest | alluvial |
    // hydromorphic_fadama; water: rain_fed | artificial_irrigation |
    // river_stream | well) and chosen in the apps, but we accept any label so
    // a slightly different option never 422s a farmer onboarding.
    soilType: Joi.string().max(60).optional(),
    irrigationAccess: Joi.boolean().default(false),
    waterSource: Joi.string().max(60).default('rain_fed'),
    landOwnership: Joi.string().optional(),
    yearsExperience: Joi.number().integer().min(0).default(0),
    gpsLat: gpsLat.optional(),
    gpsLng: gpsLng.optional(),
    gpsPolygon: Joi.array().items(Joi.object({ lat: gpsLat, lng: gpsLng })).optional(),
    landDocumentUrl: Joi.string().uri().optional(),
    landDocumentType: Joi.string().optional(),
    farmPhotoUrls: Joi.array().items(Joi.string().uri()).optional(),
  }).optional(),
});

// Map / re-measure a farm boundary. Server computes the area from the polygon.
const mapFarm = Joi.object({
  gpsPolygon: Joi.array().items(Joi.object({ lat: gpsLat.required(), lng: gpsLng.required() })).min(3).required(),
  overrideSizeAcres: Joi.number().min(0).optional(), // optional manual override
});

const updateFarmer = createFarmer.fork(Object.keys(createFarmer.describe().keys), (s) => s.optional());

// =============================================================================
// DELIVERIES
// =============================================================================
const createDelivery = Joi.object({
  farmerId: uuid.required(),
  cooperativeId: uuid.optional(),
  crop: Joi.string().required(),
  quantityKg: Joi.number().positive().required(),
  qualityGrade: Joi.string().valid('A', 'B', 'C', 'D').optional(),
  pricePerKg: Joi.number().min(0).optional(),
  dateDelivered: Joi.date().iso().max('now').optional(),
  buyerName: Joi.string().max(150).optional(),
  warehouse: Joi.string().max(150).optional(),
  receiptNumber: Joi.string().max(60).optional(),
  proofPhotoUrls: Joi.array().items(Joi.string().uri()).optional(),
  notes: Joi.string().max(500).optional(),
});

// =============================================================================
// FINANCING
// =============================================================================
const createFinancingRequest = Joi.object({
  cooperativeId: uuid.required(),
  farmerId: uuid.optional(),
  loanAmount: Joi.number().positive().required(),
  purpose: Joi.string().max(500).required(),
  season: Joi.string().valid('wet', 'dry', 'all_year').required(),
  repaymentWindowDays: Joi.number().integer().min(30).max(540).default(180),
});

const adminDecideFinancing = Joi.object({
  decision: Joi.string().valid('approved', 'rejected', 'disbursed').required(),
  approvedAmount: Joi.number().positive().optional(),
  rejectionReason: Joi.string().max(500).when('decision', { is: 'rejected', then: Joi.required() }),
  adminComments: Joi.string().max(500).optional(),
  forwardToPartnerId: uuid.optional(),
  dueDate: Joi.date().iso().optional(),
  // Manual payment flow: admin attaches the recipient account to the request
  // (the bank account the field agent/farmer provided) and, at disbursement,
  // the transfer reference + proof image(s).
  disbursementAccountDetails: Joi.string().max(500).optional(),
  disbursementReference: Joi.string().max(120).optional(),
  disbursementProofUrls: Joi.array().items(Joi.string().uri()).optional(),
});

const partnerDecideFinancing = Joi.object({
  decision: Joi.string().valid('approved', 'rejected').required(),
  approvedAmount: Joi.number().positive().optional(),
  partnerComments: Joi.string().max(500).optional(),
  rejectionReason: Joi.string().max(500).when('decision', { is: 'rejected', then: Joi.required() }),
});

// =============================================================================
// REPAYMENTS
// =============================================================================
const createRepayment = Joi.object({
  financingRequestId: uuid.required(),
  farmerId: uuid.required(),
  amountPaid: Joi.number().positive().required(),
  paymentDate: Joi.date().iso().max('now').optional(),
  paymentMethod: Joi.string().lowercase().valid('cash', 'bank_transfer', 'mobile_money', 'card', 'pos', 'cheque', 'in_kind').required(),
  referenceNumber: Joi.string().max(100).optional(),
  proofPhotoUrl: Joi.string().uri().optional(),
  contextFlag: Joi.string().valid('none', 'weather', 'market', 'health').default('none'),
  contextNotes: Joi.string().max(500).optional(),
});

// =============================================================================
// PRODUCTION (seasonal yield) + YIELD VERIFICATION
// =============================================================================
const createProduction = Joi.object({
  farmerId: uuid.required(),
  cycleNumber: Joi.number().integer().min(1).default(1),
  season: Joi.string().required(),
  crop: Joi.string().required(),
  farmSizeAcres: Joi.number().min(0).optional(),
  expectedPlantingDate: Joi.date().iso().optional(),
  expectedHarvestDate: Joi.date().iso().optional(),
  expectedYieldTonnes: Joi.number().min(0).optional(),
  actualYieldTonnes: Joi.number().min(0).optional(),
  benchmarkYieldTonnes: Joi.number().min(0).optional(),
  // Yield-verification module (the actual-harvest evidence)
  harvestDate: Joi.date().iso().optional(),
  harvestPhotoUrls: Joi.array().items(Joi.string().uri()).optional(),
  warehouseReceiptUrl: Joi.string().uri().optional(),
  buyerReceiptUrl: Joi.string().uri().optional(),
  agentSignatureUrl: Joi.string().uri().optional(),
  verificationNotes: Joi.string().max(500).optional(),
  // Input usage (Yield-history tab)
  seedType: Joi.string().max(120).optional(),
  fertilizerUsed: Joi.string().max(120).optional(),
  herbicideUsed: Joi.boolean().optional(),
  postHarvestStorage: Joi.string().max(120).optional(),
  estimatedFarmIncome: Joi.number().min(0).optional(),
  notes: Joi.string().max(500).optional(),
});

const updateProduction = createProduction
  .fork(['farmerId', 'season', 'crop'], (s) => s.optional())
  .keys({ farmerId: uuid.optional() });

// Admin verifies or rejects a submitted actual-yield record.
const verifyProduction = Joi.object({
  decision: Joi.string().valid('verify', 'reject').required(),
  verificationNotes: Joi.string().max(500).when('decision', { is: 'reject', then: Joi.required() }),
});

// =============================================================================
// MARKET ACCESS (offtake history)
// =============================================================================
const createMarketAccess = Joi.object({
  farmerId: uuid.required(),
  seasonYear: Joi.number().integer().min(2000).max(2100).optional(),
  buyerName: Joi.string().max(150).required(),
  pricePerTon: Joi.number().min(0).optional(),
  priceContext: Joi.string().valid('distress', 'market', 'confirmed', 'pre_agreed').optional(),
  isConfirmed: Joi.boolean().default(false),
  harvestWindow: Joi.string().max(120).optional(),
  notes: Joi.string().max(500).optional(),
});
const updateMarketAccess = createMarketAccess.fork(['farmerId', 'buyerName'], (s) => s.optional());

// =============================================================================
// FIELD NOTES (timeline)
// =============================================================================
const createFieldNote = Joi.object({
  farmerId: uuid.required(),
  cooperativeId: uuid.optional(),
  noteType: Joi.string().valid('assessment', 'disbursement', 'repayment', 'registration', 'visit', 'general').default('general'),
  title: Joi.string().max(160).optional(),
  body: Joi.string().max(2000).required(),
  tagLabel: Joi.string().max(60).optional(),
  tagVariant: Joi.string().valid('green', 'amber', 'neutral').default('green'),
  eventDate: Joi.date().iso().optional(),
});

const updateFieldNote = Joi.object({
  noteType: Joi.string().valid('assessment', 'disbursement', 'repayment', 'registration', 'visit', 'general').optional(),
  title: Joi.string().max(160).allow(null, '').optional(),
  body: Joi.string().max(2000).optional(),
  tagLabel: Joi.string().max(60).allow(null, '').optional(),
  tagVariant: Joi.string().valid('green', 'amber', 'neutral').optional(),
  eventDate: Joi.date().iso().optional(),
}).min(1);

// =============================================================================
// CHANGE REQUESTS (field-agent edits awaiting admin approval)
// =============================================================================
const createChangeRequest = Joi.object({
  entityType: Joi.string().valid('farmer', 'cooperative', 'farm_profile').required(),
  entityId: uuid.required(),
  changeType: Joi.string().valid('update', 'delete').default('update'),
  proposedChanges: Joi.object().min(1).required(),
});
const decideChangeRequest = Joi.object({
  decision: Joi.string().valid('approve', 'reject').required(),
  reviewNotes: Joi.string().max(500).when('decision', { is: 'reject', then: Joi.required() }),
});

// Void (correct) a repayment — admin only.
const voidRepayment = Joi.object({
  reason: Joi.string().min(3).max(500).required(),
});

// =============================================================================
// MANUAL PAYMENT FLOW (admin)
// =============================================================================
const decideSettlement = Joi.object({
  decision: Joi.string().valid('approve', 'reject').required(),
  adminNotes: Joi.string().max(500).when('decision', { is: 'reject', then: Joi.required() }),
});

const recordAgentDisbursement = Joi.object({
  agentId: uuid.required(),
  amount: Joi.number().positive().required(),
  source: Joi.string().max(60).optional(),
  description: Joi.string().max(500).optional(),
  referenceNumber: Joi.string().max(100).optional(),
  recipientName: Joi.string().max(150).optional(),
  paymentMethod: Joi.string().valid('cash', 'bank_transfer', 'mobile_money', 'in_kind').default('bank_transfer'),
  receiptImageUrl: Joi.string().uri().optional(),
  proofImageUrls: Joi.array().items(Joi.string().uri()).optional(),
  relatedFinancingId: uuid.optional(),
});

const confirmCashPurchase = Joi.object({
  decision: Joi.string().valid('confirm', 'reject').required(),
  adminNotes: Joi.string().max(500).optional(),
});

// =============================================================================
// SETTLEMENT (agent)
// =============================================================================
const createSettlement = Joi.object({
  amount: Joi.number().positive().required(),
  bankName: Joi.string().required(),
  accountNumber: Joi.string().pattern(/^\d{10}$/).required(),
  accountName: Joi.string().required(),
});

// Save / update the agent's default bank account (mirrors settlement bank rules)
const saveBankAccount = Joi.object({
  bankName: Joi.string().min(2).max(120).required(),
  accountNumber: Joi.string().pattern(/^\d{10}$/).required(),
  accountName: Joi.string().min(2).max(120).required(),
});

// =============================================================================
// PARTNERS
// =============================================================================
const createPartner = Joi.object({
  organizationName: Joi.string().min(2).max(200).required(),
  organizationEmail: Joi.string().email().lowercase().required(),
  contactPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  address: Joi.string().max(500).optional(),
  state: Joi.string().optional(),
  logoUrl: Joi.string().uri().optional(),
  contactName: Joi.string().max(120).optional(),
  website: Joi.string().uri().optional(),
  taxId: Joi.string().max(60).optional(),
});

const updatePartner = createPartner.fork(Object.keys(createPartner.describe().keys), (s) => s.optional());

// Partner editing their OWN organization (email not editable — it is the login).
const updatePartnerSelf = Joi.object({
  organizationName: Joi.string().min(2).max(200).optional(),
  contactPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).empty('').optional(),
  contactName: Joi.string().max(120).empty('').optional(),
  address: Joi.string().max(500).empty('').optional(),
  state: Joi.string().empty('').optional(),
  website: Joi.string().uri().empty('').optional(),
  taxId: Joi.string().max(60).empty('').optional(),
  logoUrl: Joi.string().uri().empty('').optional(),
});

// =============================================================================
// AGENT MANAGEMENT (admin)
// =============================================================================
const decideAgentApplication = Joi.object({
  decision: Joi.string().valid('approve', 'reject').required(),
  rejectionReason: Joi.string().max(500).when('decision', { is: 'reject', then: Joi.required() }),
});

const suspendAgent = Joi.object({
  reason: Joi.string().max(500).required(),
});

// =============================================================================
// PROFILE
// =============================================================================
const updateProfile = Joi.object({
  fullName: Joi.string().min(2).max(120).optional(),
  phone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  state: Joi.string().optional(),
  lga: Joi.string().optional(),
  avatarUrl: Joi.string().uri().optional(),
});

// =============================================================================
// LIST / PAGINATION
// =============================================================================
// =============================================================================
// LIST / PAGINATION
// -----------------------------------------------------------------------------
// The web UI sends empty query params like ?search=&status=&tier= for filters
// the user hasn't set. Joi rejects '' for .string()/.valid()/.uuid() by
// default, which produced spurious 422 "Validation failed" responses on every
// admin list page. `.empty('')` converts an empty string to "absent" BEFORE
// the rule runs, so unset filters are simply ignored.
// =============================================================================
const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(120).empty('').optional(),
  status: Joi.string().empty('').optional(),
  farmerId: uuid.empty('').optional(),
  cooperativeId: uuid.empty('').optional(),
  agentId: uuid.empty('').optional(),
  state: Joi.string().empty('').optional(),
  lga: Joi.string().empty('').optional(),
  crop: Joi.string().empty('').optional(),
  season: Joi.string().max(120).empty('').optional(),
  tier: Joi.string().valid('A', 'B', 'C', 'D').empty('').optional(),
  startDate: Joi.date().iso().empty('').optional(),
  endDate: Joi.date().iso().empty('').optional(),
}).options({ stripUnknown: true });

module.exports = {
  createCooperative,
  updateCooperative,
  createFarmer,
  updateFarmer,
  mapFarm,
  createDelivery,
  createFinancingRequest,
  adminDecideFinancing,
  partnerDecideFinancing,
  createRepayment,
  voidRepayment,
  createProduction,
  updateProduction,
  verifyProduction,
  createMarketAccess,
  updateMarketAccess,
  createFieldNote,
  updateFieldNote,
  createChangeRequest,
  decideChangeRequest,
  createSettlement,
  decideSettlement,
  recordAgentDisbursement,
  confirmCashPurchase,
  saveBankAccount,
  createPartner,
  updatePartner,
  updatePartnerSelf,
  decideAgentApplication,
  suspendAgent,
  updateProfile,
  listQuery,
};
