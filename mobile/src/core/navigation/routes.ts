/**
 * Route map — replaces the `static route` constants and the 300-line
 * `switch` in `core/route/generate_route.dart`.
 *
 * The Dart route strings were inconsistent and partly broken: some had a
 * leading slash, some didn't (`'signin-view'`), one used snake_case
 * (`'reset_password_view'`), and `PreAuthView.route` was the literal
 * `'/ preAuthView'` — with a space after the slash, which would be an invalid
 * URL path. expo-router derives paths from the filesystem, so these are now
 * normalised, URL-safe paths. Nothing outside this file referenced the old
 * strings by value, so the rename is safe.
 *
 * Mapping from the Dart constants:
 *   '/splash'                         -> /
 *   '/ preAuthView'                   -> /pre-auth
 *   'signin-view'                     -> /login
 *   'register-view'                   -> /register
 *   'image-verification-view'         -> /register/selfie
 *   'nin-update-view'                 -> /nin-update
 *   '/ProfileUnderreview'             -> /under-review
 *   'forgot-password-view'            -> /forgot-password
 *   'verify-forgot-password-otp-view' -> /forgot-password/verify
 *   'reset_password_view'             -> /forgot-password/reset
 *   '/homeScreen'                     -> /(tabs)
 *   'dashboard-view'                  -> /(tabs)
 *   'recent-activity-logs-view'       -> /activity-logs
 *   '/requestSettlement'              -> /wallet/settlement/request
 *   '/transactionHistory'             -> /wallet/transactions
 *   '/walletTransactionDetails'       -> /wallet/transactions/[id]
 *   '/settlementHistory'              -> /wallet/settlement/history
 *   '/profile'                        -> /profile
 *   '/profile/edit'                   -> /profile/edit
 *   '/bankAccountSettings'            -> /profile/bank-account
 *   '/notifications'                  -> /notifications
 */

import type { Href } from 'expo-router';

/** Dynamic paths are built from runtime ids, so they cannot be statically typed. */
const href = (path: string): Href => path as Href;

export const routes = {
  // ---------------------------------------------------------------- startup
  splash: '/',
  preAuth: '/pre-auth',

  // ------------------------------------------------------------------- auth
  login: '/login',
  register: '/register',
  /** Selfie capture, reached from register step 3. */
  registerSelfie: '/register/selfie',
  underReview: '/under-review',
  ninUpdate: '/nin-update',

  forgotPassword: '/forgot-password',
  forgotPasswordVerify: '/forgot-password/verify',
  forgotPasswordReset: '/forgot-password/reset',

  // -------------------------------------------------------------- tab shell
  home: '/(tabs)',
  dashboard: '/(tabs)',

  /** Data consent capture — the gate before onboarding. */
  consent: '/consent',
  cooperativesTab: '/(tabs)/cooperatives',
  farmersTab: '/(tabs)/farmers',
  activitiesTab: '/(tabs)/activities',
  walletTab: '/(tabs)/wallet',

  // -------------------------------------------------------------- dashboard
  activityLogs: '/activity-logs',

  // ----------------------------------------------------------- cooperatives
  cooperativeCreate: '/cooperatives/create',
  cooperativeDetails: (id: string) => href(`/cooperatives/${id}`),
  cooperativeEdit: (id: string) => href(`/cooperatives/${id}/edit`),
  financingRequest: (cooperativeId: string) =>
    href(`/cooperatives/${cooperativeId}/financing/request`),
  financingHistory: (cooperativeId: string) =>
    href(`/cooperatives/${cooperativeId}/financing`),
  financingDetails: (id: string) => href(`/financing/${id}`),

  // ---------------------------------------------------------------- farmers
  farmerAdd: '/farmers/add',
  farmerBulkUpload: '/farmers/bulk-upload',
  /**
   * The offline queue: what is waiting to sync and what failed. Reached from
   * the home screen's sync tiles (v2).
   */
  syncQueue: '/farmers/sync',
  farmerDetails: (id: string) => href(`/farmers/${id}`),
  farmerEdit: (id: string) => href(`/farmers/${id}/edit`),
  farmerRecordYields: (id: string) => href(`/farmers/${id}/yields/record`),
  farmerProductionYields: (id: string) => href(`/farmers/${id}/yields`),
  productionYieldDetails: (id: string) => href(`/productions/${id}`),
  farmerMarketAccess: (id: string) => href(`/farmers/${id}/market-access`),
  farmerMarketAccessAdd: (id: string) => href(`/farmers/${id}/market-access/add`),
  farmerFieldNotes: (id: string) => href(`/farmers/${id}/field-notes`),
  farmerFieldNoteAdd: (id: string) => href(`/farmers/${id}/field-notes/add`),
  /**
   * Record a repayment. Keyed by **farmer**, not financing request: the Dart
   * route `'recordRepayment'` took a `Farmer` argument and the screen loads
   * that farmer's active financing requests into a dropdown, so the specific
   * request is chosen on-screen rather than carried in the path.
   */
  recordRepayment: (farmerId: string) => href(`/farmers/${farmerId}/repayment`),
  /**
   * Farm boundary capture — new. `mapFarm()` existed in the Dart repository
   * layer with no screen, so there is no Dart route to port.
   */
  farmerBoundary: (id: string) => href(`/farmers/${id}/boundary`),
  /**
   * The farmer's farms (v2 "Add Another Farm"). The list is its own screen
   * rather than a section of the details screen: a farmer with four plots
   * would push the score, the actions and the activity below the fold.
   */
  farmerFarms: (id: string) => href(`/farmers/${id}/farms`),
  /**
   * The Update Record hub (v2): one entry point for the five records an
   * agent captures against a farmer in the field.
   */
  farmerUpdateRecord: (id: string) => href(`/farmers/${id}/update-record`),
  /**
   * The full-screen farm map (v2). A plain route, so closing it returns to
   * the profile underneath with its state and cache intact.
   */
  farmerMap: (id: string) => href(`/farmers/${id}/map`),
  /**
   * Log a produce delivery. The schema, body builder, API call and mutation
   * all existed with no screen; "Log delivery" on the home screen opened the
   * Activities tab, which only lists them.
   */
  farmerLogDelivery: (id: string) => href(`/farmers/${id}/delivery`),
  farmerFarmAdd: (id: string) => href(`/farmers/${id}/farms/add`),
  farmerFarmEdit: (farmerId: string, farmId: string) =>
    href(`/farmers/${farmerId}/farms/${farmId}`),

  // ----------------------------------------------------------------- wallet
  settlementRequest: '/wallet/settlement/request',
  settlementHistory: '/wallet/settlement/history',
  transactionHistory: '/wallet/transactions',
  transactionDetails: (id: string) => href(`/wallet/transactions/${id}`),

  // ---------------------------------------------------------------- profile
  profile: '/profile',
  profileEdit: '/profile/edit',
  bankAccount: '/profile/bank-account',

  // ---------------------------------------------------------- notifications
  notifications: '/notifications',
} as const;

/** Maps a `SessionRoute` from the auth store to a concrete path. */
export const sessionRoutePath = {
  home: routes.dashboard,
  'under-review': routes.underReview,
  'nin-update': routes.ninUpdate,
  'pre-auth': routes.preAuth,
} as const;
