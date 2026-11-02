'use strict';

const Joi = require('joi');

const { ENUM_LABELS } = require('../utils/enums');

const uuid = Joi.string().guid({ version: ['uuidv4', 'uuidv1'] });
const gpsLat = Joi.number().min(-90).max(90);
const gpsLng = Joi.number().min(-180).max(180);

// =============================================================================
// COOPERATIVES
// =============================================================================
const createCooperative = Joi.object({
  /**
   * Idempotency key: one UUID per form session, resent on every retry
   * (v2 flow: "duplicate-safe client UUID"). A repeat submission returns the
   * record that already exists instead of creating a second one. Optional —
   * an older app build that sends none behaves exactly as before.
   */
  clientRequestId: uuid.optional(),
  // Issued by POST /agent/consent. The gate in cooperatives.create requires
  // it: a cooperative cannot be registered without a completed Flow A.
  consentId: uuid.optional(),
  name: Joi.string().min(2).max(150).required(),
  registrationNumber: Joi.string().max(60).optional(),
  leaderName: Joi.string().max(120).optional(),
  leaderPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  /**
   * The cooperative's main crop (v2 flow: "exactly one primary crop with
   * secondaries that cannot duplicate it").
   *
   * `cooperatives.primary_crop` has existed all along, is read by the credit
   * report and is listed as an approvable field on change requests — but no
   * endpoint ever wrote it, because it was missing from this schema. Every
   * cooperative in the database therefore has a NULL primary crop.
   */
  primaryCrop: Joi.string().max(60).optional(),
  /** The other crops the cooperative supports. */
  cropsSupported: Joi.array().items(Joi.string()).default([]),
  state: Joi.string().required(),
  lga: Joi.string().required(),
  address: Joi.string().max(500).optional(),
  // DEPRECATED (v2 user flow, section "Register Cooperative"): "Do not show
  // or ask for cooperative land size... Land total is derived from eligible
  // linked farmer farm records."
  //
  // `.strip()` rather than `.forbidden()` or removal: an app build still in
  // the field sends this field, and both alternatives would break those
  // installs — `forbidden()` with a 422 on every cooperative registration,
  // removal with a silently ignored key that still looked accepted. Stripping
  // accepts the request and discards the value, so the column is never
  // written again while old clients keep working. `cooperatives.controller`
  // no longer maps it either, so this is belt and braces.
  estimatedLandSize: Joi.any().strip(),
  logoUrl: Joi.string().uri().optional(),
  gpsLat: gpsLat.optional(),
  gpsLng: gpsLng.optional(),
  gpsPolygon: Joi.array().items(Joi.object({ lat: gpsLat, lng: gpsLng })).optional(),
})
  .custom((value, helpers) => {
    // The primary crop must not also appear among the secondaries. Allowing
    // it would double-count the cooperative's main crop in every list built
    // from `[primary_crop, ...crops_supported]` — including the one on the
    // lender's report.
    const primary = (value.primaryCrop || '').trim().toLowerCase();
    if (!primary) return value;
    const duplicated = (value.cropsSupported || []).some(
      (crop) => String(crop).trim().toLowerCase() === primary
    );
    if (duplicated) {
      return helpers.message(
        'The primary crop must not be repeated in the other crops supported'
      );
    }
    return value;
  });

/**
 * FIXED — two bugs in every `createX.fork(...)` update schema.
 *
 *  1. `fork()` makes keys optional but KEEPS their `.default()`. Joi therefore
 *     injected the creation defaults into every PATCH body, and the controller
 *     wrote them. `PATCH /cooperatives/:id {"name":"X"}` also wrote
 *     `crops_supported: []` — wiping the crop list. `PATCH /farmers/:id`
 *     reset `household_size` to 1 and `dependents` to 0; a nested farm patch
 *     reset `plot_count`, `irrigation_access`, `water_source` and
 *     `years_experience`. Silent, every time. `noDefaults: true` is the Joi
 *     switch for "this is a patch, not a creation".
 *
 *  2. Because the defaults were injected, the body was never empty, so an
 *     empty PATCH reached the database as a write of default values instead of
 *     being rejected. With defaults off, `.min(1)` now catches it.
 */
const patchOptions = { noDefaults: true };

const updateCooperative = createCooperative
  .fork(Object.keys(createCooperative.describe().keys), (s) => s.optional())
  .min(1)
  .options(patchOptions);

// =============================================================================
// FARMERS
// =============================================================================
const createFarmer = Joi.object({
  /**
   * Idempotency key: one UUID per form session, resent on every retry
   * (v2 flow: "duplicate-safe client UUID"). A repeat submission returns the
   * record that already exists instead of creating a second one. Optional —
   * an older app build that sends none behaves exactly as before.
   */
  clientRequestId: uuid.optional(),
  // Issued by POST /agent/consent. The gate in farmers.create requires it:
  // a farmer profile cannot be submitted without a completed Flow B.
  consentId: uuid.optional(),
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
  // Nested farm profile — the farmer's PRIMARY farm. Further farms are added
  // through POST /agent/farmers/:farmerId/farms (see `createFarm` below).
  farm: Joi.object({
    // The agent's own name for the plot ("Cassava plot"). Optional: the API
    // labels an unnamed farm by position.
    farmLabel: Joi.string().max(80).allow('', null).optional(),
    /**
     * FIXED — this was `min(0)`, so a 0-acre farm was accepted. Land size is
     * the DENOMINATOR of the production score: a zero made the farmer
     * permanently unscoreable, and the engine's divide-by-zero guard then
     * scored them 0 on production with nothing on screen explaining why. The
     * user flow lists "missing farm area" as an exception to handle, and
     * refusing it at the door is the handling. `map-farm` already rejected a
     * zero override for exactly this reason; the create path did not.
     */
    farmSizeAcres: Joi.number().greater(0).required(),
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
    /**
     * Farm photos. The v2 flow asks for 10–20 per farm.
     *
     * The MAXIMUM is enforced (20): an unbounded array behind one farmer is
     * how a buggy retry loop fills the bucket and makes the record slow to
     * read. The MINIMUM deliberately is not. A hard floor of ten would block
     * a farmer whose onboarding is otherwise complete — an agent on a weak
     * connection gets six photos up and then cannot save the person at all,
     * and the flow's own exception list treats a stalled upload as something
     * to recover from rather than a reason to lose the record. The app asks
     * for ten and says how many are still wanted; the server does not refuse
     * a farmer over it.
     */
    farmPhotoUrls: Joi.array().items(Joi.string().uri()).max(20).optional(),
  }).optional(),
});

// Map / re-measure a farm boundary. Server computes the area from the polygon.
const mapFarm = Joi.object({
  gpsPolygon: Joi.array().items(Joi.object({ lat: gpsLat.required(), lng: gpsLng.required() })).min(3).required(),
  overrideSizeAcres: Joi.number().min(0).optional(), // optional manual override
  // Which of the farmer's farms this boundary belongs to. Omitted means the
  // primary farm, which is what the single-farm map screen means. Without
  // this a farmer with several plots could have farm 2's boundary saved onto
  // farm 1.
  farmId: uuid.optional(),
});

// FIXED — `fork()` only reaches TOP-LEVEL keys, so `farm.farmSizeAcres` and
// `farm.cropType` stayed `.required()` on update. Any PATCH that touched the
// farm at all ("change the soil type") was rejected with
// "farm.farmSizeAcres is required" unless the client re-sent the whole farm
// object. The nested schema is forked explicitly here.
const farmUpdateSchema = createFarmer
  .extract('farm')
  .fork(Object.keys(createFarmer.extract('farm').describe().keys), (s) => s.optional())
  .min(1);

const updateFarmer = createFarmer
  .fork(Object.keys(createFarmer.describe().keys), (s) => s.optional())
  .keys({ farm: farmUpdateSchema.optional() })
  .min(1)
  .options(patchOptions);

// ---------------------------------------------------------------------------
// Farms within a farmer ("Add Another Farm")
//
// Both schemas are derived from the nested `farm` object rather than written
// out again, so a field added to onboarding is automatically accepted when
// adding a second farm. Writing them twice is how the two drift apart and a
// field ends up storable on farm 1 but not on farm 2.
// ---------------------------------------------------------------------------

/** Body of POST /agent/farmers/:farmerId/farms — a whole new farm. */
const createFarm = createFarmer.extract('farm');

/**
 * Body of PATCH /agent/farmers/:farmerId/farms/:farmId — a partial edit.
 *
 * Same shape as a nested farm patch: every key optional, at least one
 * present, and `noDefaults` so an edit of one field does not write the
 * creation defaults over `plotCount`, `irrigationAccess`, `waterSource` and
 * `yearsExperience`.
 */
const updateFarm = farmUpdateSchema.options(patchOptions);

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
  // The land this season's yield came off. Zero would divide the yield by
  // nothing; the scoring engine falls back to the farm's own size when this
  // is absent, which is the right behaviour for "not recorded".
  farmSizeAcres: Joi.number().greater(0).optional(),
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
  .keys({ farmerId: uuid.optional() })
  .min(1)
  .options(patchOptions);

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
const updateMarketAccess = createMarketAccess
  .fork(['farmerId', 'buyerName'], (s) => s.optional())
  .min(1)
  .options(patchOptions);

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
}).min(1).options(patchOptions);

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

  // FIXED — these two were missing, and the validate middleware runs with
  // `stripUnknown: true`, so they were silently deleted from every request.
  // decideSettlement() writes them into the wallet_transactions row as
  // `reference_number` and `receipt_image_url`, which meant the payout ledger
  // recorded NULL proof every time: the admin uploaded a bank-transfer receipt
  // and typed a reference, both were discarded without error, and neither the
  // agent nor an audit could see what backed the payout.
  // Only meaningful when approving — a rejection transfers no money.
  referenceNumber: Joi.string().max(100).optional(),
  receiptImageUrl: Joi.string().uri().optional(),
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
// MANUAL CASH PURCHASE (agent)
// -----------------------------------------------------------------------------
// The agent-side half of the manual money flow: the agent buys inputs for a
// farmer out of funds the admin disbursed, and files the proof. The admin then
// confirms it via confirmCashPurchase above.
// Mirrors recordAgentDisbursement, minus agentId (taken from the token) and
// recipientName (derived from the farmer record, so it cannot be spoofed).
// =============================================================================
const recordCashPurchase = Joi.object({
  farmerId: uuid.required(),
  financingRequestId: uuid.optional(),
  amount: Joi.number().positive().required(),
  description: Joi.string().max(500).optional(),
  referenceNumber: Joi.string().max(100).optional(),
  paymentMethod: Joi.string().valid('cash', 'bank_transfer', 'mobile_money', 'in_kind').default('cash'),
  receiptImageUrl: Joi.string().uri().optional(),
  proofImageUrls: Joi.array().items(Joi.string().uri()).max(10).optional(),
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

const updatePartner = createPartner
  .fork(Object.keys(createPartner.describe().keys), (s) => s.optional())
  .min(1)
  .options(patchOptions);

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
}).min(1).options(patchOptions);

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
}).min(1).options(patchOptions);

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
// FIXED — `stripUnknown: true` deletes any key not declared here BEFORE the
// controller runs, and several controllers read filters that were never
// declared. The filters simply did nothing, with no error anywhere:
//   • activity.controller  — actorId / action / entityType  (admin audit log
//     filters were inert)
//   • admin.wallet.listAllTransactions — source / transactionType
//   • notifications.list   — unread   (the agent app's "unread only" toggle)
//   • partner.search       — q / type
// They are declared now so the documented filters actually filter.
const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(120).empty('').optional(),
  status: Joi.string().max(60).empty('').optional(),
  /**
   * Repayments: counted rows only, voided only, or (omitted) both.
   *
   * `Joi.boolean()` accepts the strings 'true'/'false' a query string
   * carries, and `.empty('')` keeps an unset filter from arriving as a
   * literal empty string.
   */
  voided: Joi.boolean().empty('').optional(),
  farmerId: uuid.empty('').optional(),
  cooperativeId: uuid.empty('').optional(),
  agentId: uuid.empty('').optional(),
  actorId: uuid.empty('').optional(),
  state: Joi.string().empty('').optional(),
  lga: Joi.string().empty('').optional(),
  crop: Joi.string().empty('').optional(),
  season: Joi.string().max(120).empty('').optional(),
  tier: Joi.string().valid('A', 'B', 'C', 'D').empty('').optional(),
  startDate: Joi.date().iso().empty('').optional(),
  endDate: Joi.date().iso().empty('').optional(),
  // Activity log filters
  action: Joi.string().max(80).empty('').optional(),
  entityType: Joi.string().max(60).empty('').optional(),
  // Wallet transaction filters
  source: Joi.string().max(60).empty('').optional(),
  // `wallet_transactions.transaction_type` is an enum too — same 22P02 trap
  // as `status`, so it is pinned to its labels here rather than per route,
  // since only one endpoint reads it.
  transactionType: Joi.string().valid('credit', 'debit', 'settlement').empty('').optional(),
  // Notification filter
  unread: Joi.string().valid('true', 'false').empty('').optional(),
  // Partner search
  q: Joi.string().max(120).empty('').optional(),
  type: Joi.string().valid('all', 'farmer', 'cooperative').empty('').optional(),
}).options({ stripUnknown: true });

// -----------------------------------------------------------------------------
// Status filters, per list endpoint.
//
// `listQuery.status` above is `Joi.string().max(60)` — it accepts anything and
// hands it straight to `.eq('status', …)`. Every one of those columns is a
// Postgres ENUM, and an enum comparison against a label that does not exist is
// error 22P02, which this API maps to a flat 400 "A value had the wrong type".
//
// That is exactly how the admin Yield Verification screen broke: it sent
// `status=unverified`, which is not a label on `yield_verification_status`
// (`pending | verified | rejected`), so the default tab returned 400 with
// nothing naming the offending value — the table simply said there were no
// records, which is also what an empty but working list looks like.
//
// So each list route gets the label set of the column it actually filters.
// A wrong value now fails in Joi with a 422 that names the field and the
// values allowed, before any query is built. The sets below are checked
// against the schema's CREATE TYPE statements by `npm run check:enums`, so
// they cannot drift from the database.
// -----------------------------------------------------------------------------

/**
 * `listQuery` with `status` narrowed to one enum's labels.
 *
 * `.keys()` replaces only that one key, so every other filter — pagination,
 * search, the date range — keeps the definition above.
 */
function listQueryWithStatus(enumType) {
  const labels = ENUM_LABELS[enumType];
  /* istanbul ignore next — a typo here is a programmer error, not input */
  if (!labels) throw new Error(`listQueryWithStatus: unknown enum ${enumType}`);
  return listQuery.keys({
    status: Joi.string()
      .valid(...labels)
      .empty('')
      .optional(),
  });
}

/**
 * Which endpoint filters which column. The key is how routes refer to it; the
 * comment is the table and column, because that is the thing that must match.
 */
const listQueries = {
  // agent_applications.status
  agentApplications: listQueryWithStatus('user_status'),
  // profiles.status
  agents: listQueryWithStatus('user_status'),
  // partners.status
  partners: listQueryWithStatus('user_status'),
  // seasonal_productions.verification_status
  productions: listQueryWithStatus('yield_verification_status'),
  // financing_requests.status
  financing: listQueryWithStatus('financing_status'),
  // change_requests.status
  changeRequests: listQueryWithStatus('change_request_status'),
  // data_consents.status
  consent: listQueryWithStatus('consent_status'),
  // settlement_requests.status
  settlements: listQueryWithStatus('settlement_status'),
  // wallet_transactions.status
  transactions: listQueryWithStatus('transaction_status'),
};

// =============================================================================
// DATA CONSENT (agent + admin)
// -----------------------------------------------------------------------------
// Shapes only. The decisions with legal weight — which items are required,
// whether sharing is granted, whether a farmer may override their
// cooperative's refusal — live in services/consent/rules.js and are applied in
// the controller, so there is one place to read them and one place to test
// them.
// =============================================================================
const consentEntityType = Joi.string().valid('cooperative', 'farmer');

/** C1..C4 or F1..F3, each an explicit boolean. */
const consentItemResponses = Joi.object()
  .pattern(/^[CF][1-9]$/, Joi.boolean().required())
  .min(1)
  .required();

const recordConsent = Joi.object({
  entityType: consentEntityType.required(),
  // Absent for a farmer: consent is captured BEFORE the farmer row exists,
  // and the controller links them once it does.
  entityId: uuid.optional(),
  // Required for a farmer so the cooperative's sharing decision can be applied.
  cooperativeId: uuid.optional(),

  agreementVersion: Joi.string().max(20).default('v1.0'),
  language: Joi.string().max(10).default('en'),
  itemResponses: consentItemResponses,

  signerName: Joi.string().min(2).max(150).required(),
  signerRole: Joi.string().max(80).optional(),
  signerPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  signerEmail: Joi.string().email().optional(),

  secondOfficerName: Joi.string().max(150).optional(),
  secondOfficerPhone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
  secondOfficerEmail: Joi.string().email().optional(),

  signatureFile: Joi.string().max(500).optional(),
  voiceFile: Joi.string().max(500).optional(),
  voiceDurationSeconds: Joi.number().min(0).max(600).optional(),
  unableToSign: Joi.boolean().default(false),

  // The device clock as the agent saw it; the server records its own too.
  timestampDevice: Joi.date().iso().optional(),
  gpsLatitude: Joi.number().min(-90).max(90).optional(),
  gpsLongitude: Joi.number().min(-180).max(180).optional(),
});

const verifyConsentOtp = Joi.object({
  code: Joi.string().pattern(/^[0-9]{6}$/).required(),
});

const withdrawConsent = Joi.object({
  reason: Joi.string().min(3).max(500).required(),
});

// =============================================================================
// REGIONAL BENCHMARKS (admin)
// -----------------------------------------------------------------------------
// FIXED — POST /admin/benchmarks had NO validator at all. Every farmer's yield
// score is divided by `benchmark_yield_tonnes_per_hectare`, so an admin typo
// ("4,5", "", null) wrote a non-numeric or zero benchmark and silently zeroed
// the production score of every farmer growing that crop in that state.
// =============================================================================
const upsertBenchmark = Joi.object({
  crop: Joi.string().min(2).max(60).required(),
  state: Joi.string().min(2).max(60).required(),
  lga: Joi.string().max(60).allow(null, '').optional(),
  season: Joi.string().max(60).allow(null, '').optional(),
  benchmarkYieldTonnesPerHectare: Joi.number().greater(0).max(1000).required(),
  source: Joi.string().max(120).optional(),
});

// Mint a signed URL for a stored object.
const signUrl = Joi.object({
  bucket: Joi.string().max(80).required(),
  path: Joi.string().max(400).required(),
});

module.exports = {
  createCooperative,
  updateCooperative,
  createFarmer,
  updateFarmer,
  createFarm,
  updateFarm,
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
  recordCashPurchase,
  upsertBenchmark,
  signUrl,
  saveBankAccount,
  createPartner,
  updatePartner,
  updatePartnerSelf,
  decideAgentApplication,
  suspendAgent,
  updateProfile,
  listQuery,
  listQueries,
  ENUM_LABELS,
  recordConsent,
  verifyConsentOtp,
  withdrawConsent,
};
