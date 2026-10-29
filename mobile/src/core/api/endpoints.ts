/**
 * API endpoint map — ported from lib/src/core/utils/api_constants.dart and
 * cross-checked line by line against the backend's Express routers
 * (backend/src/routes/{auth,agent}.routes.js) in the Production-heabron repo.
 *
 * Paths are relative to BASE_URL, which already includes `/api`.
 */

export const endpoints = {
  // ---------------------------------------------------------------- auth
  signup: '/auth/signup',
  verifySignupOtp: '/auth/verify-otp',
  resendSignupOtp: '/auth/resend-otp',
  completeSignup: '/auth/signup/complete',
  resubmitNin: '/auth/resubmit-nin',

  login: '/auth/login',
  refreshToken: '/auth/refresh',
  logout: '/auth/logout',
  userProfile: '/auth/me',

  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  changePassword: '/auth/change-password',

  /** Pre-approval upload — accepts a token for a non-active account. */
  uploadWithoutAuth: (kind: UploadKind) => `/auth/uploads/${kind}`,

  // ------------------------------------------------------------- profile
  editProfile: '/agent/profile',
  deleteAccount: '/agent/profile',
  exportMyData: '/agent/profile/export',
  bankAccount: '/agent/bank-account',

  // ----------------------------------------------------------- dashboard
  dashboard: '/agent/dashboard',

  // -------------------------------------------------------- cooperatives
  cooperatives: '/agent/cooperatives',
  cooperativeById: (id: string) => `/agent/cooperatives/${id}`,
  cooperativeFarmers: (id: string) => `/agent/cooperatives/${id}/farmers`,

  // ------------------------------------------------------------- farmers
  farmers: '/agent/farmers',
  farmerById: (id: string) => `/agent/farmers/${id}`,
  verifyFarmerNin: (farmerId: string) => `/agent/farmers/${farmerId}/verify-nin`,
  mapFarm: (farmerId: string) => `/agent/farmers/${farmerId}/map-farm`,
  farmerCreditScore: (farmerId: string) => `/agent/farmers/${farmerId}/credit-score`,
  farmerSeasonalYield: (farmerId: string) => `/agent/farmers/${farmerId}/seasonal-yield`,
  farmerMarketAccess: (farmerId: string) => `/agent/farmers/${farmerId}/market-access`,
  farmerFieldNotes: (farmerId: string) => `/agent/farmers/${farmerId}/field-notes`,

  // --------------------------------------------------------- productions
  productions: '/agent/productions',
  productionById: (id: string) => `/agent/productions/${id}`,

  // ------------------------------------------------------- market access
  marketAccess: '/agent/market-access',
  marketAccessById: (recordId: string) => `/agent/market-access/${recordId}`,

  // ---------------------------------------------------------- field notes
  fieldNotes: '/agent/field-notes',
  fieldNoteById: (noteId: string) => `/agent/field-notes/${noteId}`,

  // ------------------------------------------------------ change requests
  changeRequests: '/agent/change-requests',
  changeRequestById: (id: string) => `/agent/change-requests/${id}`,

  // ---------------------------------------------------------- deliveries
  deliveries: '/agent/deliveries',
  deliveryById: (id: string) => `/agent/deliveries/${id}`,

  // ----------------------------------------------------------- financing
  financingRequests: '/agent/financing-requests',
  financingRequestById: (id: string) => `/agent/financing-requests/${id}`,

  // ---------------------------------------------------------- repayments
  repayments: '/agent/repayments',

  // -------------------------------------------------------------- wallet
  wallet: '/agent/wallet',
  walletTransactions: '/agent/wallet/transactions',
  walletTransactionById: (id: string) => `/agent/wallet/transactions/${id}`,
  walletSettlements: '/agent/wallet/settlements',

  // ------------------------------------------------------- notifications
  notifications: '/agent/notifications',
  notificationsUnreadCount: '/agent/notifications/unread-count',
  notificationsReadAll: '/agent/notifications/read-all',
  notificationRead: (id: string) => `/agent/notifications/${id}/read`,

  // ------------------------------------------------------------- uploads
  upload: (kind: UploadKind) => `/agent/uploads/${kind}`,
  uploadDoc: (kind: UploadKind) => `/agent/uploads-doc/${kind}`,
  uploadSignUrl: '/agent/uploads/sign-url',

  // ------------------------------------------------------------- imports
  imports: '/agent/imports',
  importsTemplate: '/agent/imports/template',
} as const;

/**
 * Storage buckets accepted by `POST /agent/uploads/:kind`.
 *
 * This is the complete `BUCKETS` map from
 * `backend/src/controllers/uploads.controller.js`. An unlisted kind is
 * rejected with `Unknown upload kind: <kind>`.
 *
 * NOTE — the Flutter `UploadService` doc comment listed only seven kinds, so
 * the four yield-verification kinds were undocumented client-side even though
 * `RecordYieldsView` uploaded to them.
 */
export const UPLOAD_KINDS = [
  // Agent identity
  'avatar',
  'selfie',
  'agent_signature',
  // Farmer records
  'farmer_id',
  'farmer_photo',
  'land_doc',
  'farm_photo',
  // Yield verification
  'harvest_photo',
  'warehouse_receipt',
  'buyer_receipt',
  // Transactions and deliveries
  'delivery_proof',
  'transaction_receipt',
  // Public logos
  'cooperative_logo',
  'partner_logo',
] as const;

export type UploadKind = (typeof UPLOAD_KINDS)[number];

/**
 * The only two kinds the pre-approval `/auth/uploads/:kind` route allows —
 * `PRE_ACTIVATION_KINDS` in the uploads controller. Anything else is rejected
 * with `Upload kind not allowed before activation: <kind>`.
 */
export const PRE_AUTH_UPLOAD_KINDS: readonly UploadKind[] = ['avatar', 'selfie'];

/**
 * Kinds stored in a public bucket. Everything else lands in a private bucket
 * and needs a signed URL to display.
 *
 * This matters for cooperative logos: the Flutter app uploaded them as
 * `avatar`, which is a **private** agent-documents bucket, so the logo URL it
 * saved was not publicly readable. `cooperative_logo` is the correct kind and
 * is public.
 */
export const PUBLIC_UPLOAD_KINDS: readonly UploadKind[] = [
  'cooperative_logo',
  'partner_logo',
];
