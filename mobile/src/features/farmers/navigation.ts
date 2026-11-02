/**
 * Farmer route paths this module navigates to.
 *
 * Thin aliases over `core/navigation/routes.ts`, plus the query-string
 * variants that put an edit target on an otherwise-shared add screen (the Dart
 * screens took a nullable DTO argument to switch between add and edit).
 */
import type { Href } from 'expo-router';

import { routes } from '../../core/navigation/routes';

/** Query-string variants are built at runtime, so they cannot be statically typed. */
const href = (path: string): Href => path as Href;

export const farmersRoutes = {
  list: routes.farmersTab,
  add: routes.farmerAdd,
  /** `/farmers/add?cooperativeId=…` when opened from a cooperative. */
  addForCooperative: (cooperativeId: string): Href =>
    href(`${routes.farmerAdd}?cooperativeId=${cooperativeId}`),
  bulkUpload: routes.farmerBulkUpload,
  details: routes.farmerDetails,
  edit: routes.farmerEdit,
  recordYields: routes.farmerRecordYields,
  /** `/farmers/[id]/yields/record?productionId=…` */
  editYield: (farmerId: string, productionId: string): Href =>
    href(`/farmers/${farmerId}/yields/record?productionId=${productionId}`),
  productionYields: routes.farmerProductionYields,
  productionYieldDetails: routes.productionYieldDetails,
  marketAccess: routes.farmerMarketAccess,
  marketAccessAdd: routes.farmerMarketAccessAdd,
  /** `/farmers/[id]/market-access/add?recordId=…` */
  marketAccessEdit: (farmerId: string, recordId: string): Href =>
    href(`/farmers/${farmerId}/market-access/add?recordId=${recordId}`),
  fieldNotes: routes.farmerFieldNotes,
  fieldNoteAdd: routes.farmerFieldNoteAdd,
  /** `/farmers/[id]/field-notes/add?noteId=…` */
  fieldNoteEdit: (farmerId: string, noteId: string): Href =>
    href(`/farmers/${farmerId}/field-notes/add?noteId=${noteId}`),

  /** Boundary capture — new; no Dart equivalent. */
  captureBoundary: routes.farmerBoundary,
  /** The farmer's farms (v2 "Add Another Farm"). */
  farms: routes.farmerFarms,
  farmAdd: routes.farmerFarmAdd,
  farmEdit: routes.farmerFarmEdit,

  /** Farmer-scoped: the screen loads that farmer's repayable requests. */
  recordRepayment: routes.recordRepayment,
  /** The v2 Update Record hub, and the delivery form it opens. */
  updateRecord: routes.farmerUpdateRecord,
  map: routes.farmerMap,
  logDelivery: routes.farmerLogDelivery,
} as const;
