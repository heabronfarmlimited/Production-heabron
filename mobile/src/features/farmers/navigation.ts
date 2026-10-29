/**
 * Farmer route paths this module navigates to.
 *
 * Thin aliases over `core/navigation/routes.ts`, plus the query-string
 * variants that put an edit target on an otherwise-shared add screen (the Dart
 * screens took a nullable DTO argument to switch between add and edit).
 */
import { routes } from '../../core/navigation/routes';

export const farmersRoutes = {
  list: routes.farmersTab,
  add: routes.farmerAdd,
  /** `/farmers/add?cooperativeId=…` when opened from a cooperative. */
  addForCooperative: (cooperativeId: string): string =>
    `${routes.farmerAdd}?cooperativeId=${cooperativeId}`,
  bulkUpload: routes.farmerBulkUpload,
  details: routes.farmerDetails,
  edit: routes.farmerEdit,
  recordYields: routes.farmerRecordYields,
  /** `/farmers/[id]/yields/record?productionId=…` */
  editYield: (farmerId: string, productionId: string): string =>
    `${routes.farmerRecordYields(farmerId)}?productionId=${productionId}`,
  productionYields: routes.farmerProductionYields,
  productionYieldDetails: routes.productionYieldDetails,
  marketAccess: routes.farmerMarketAccess,
  marketAccessAdd: routes.farmerMarketAccessAdd,
  /** `/farmers/[id]/market-access/add?recordId=…` */
  marketAccessEdit: (farmerId: string, recordId: string): string =>
    `${routes.farmerMarketAccessAdd(farmerId)}?recordId=${recordId}`,
  fieldNotes: routes.farmerFieldNotes,
  fieldNoteAdd: routes.farmerFieldNoteAdd,
  /** `/farmers/[id]/field-notes/add?noteId=…` */
  fieldNoteEdit: (farmerId: string, noteId: string): string =>
    `${routes.farmerFieldNoteAdd(farmerId)}?noteId=${noteId}`,

  /** Boundary capture — new; no Dart equivalent. */
  captureBoundary: routes.farmerBoundary,

  /** Farmer-scoped: the screen loads that farmer's repayable requests. */
  recordRepayment: routes.recordRepayment,
} as const;
