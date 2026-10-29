/**
 * Farmers API — ported from
 * modules/farmers/data/repository/farmers_remote_repository_impl.dart
 *
 * Every call goes through `api` from core/api/client.ts, which unwraps the
 * `ServerResponse` envelope and throws `AppError`.
 *
 * Changes from the Dart repository:
 *
 *  - Five endpoints were declared in `api_constants.dart` but shadowed by
 *    hardcoded path strings in the repo impl (`/agent/market-access`,
 *    `/agent/field-notes`, `/agent/productions/:id`, the two farmer-scoped
 *    list paths). All of them use `endpoints.*` here.
 *  - `verifyFarmerNin`, `mapFarm`, `getRepayments` and `getImports` were
 *    implemented but had no call site anywhere in the app. They are wired to
 *    real screens now.
 *  - The bulk-upload FormData had `// 'cooperativeId': cooperativeId,`
 *    commented out while the caller passed `''`. The backend's
 *    `imports.bulkImport` derives the cooperative from the CSV's
 *    `cooperative_name` column and ignores a `cooperativeId` field entirely,
 *    so the parameter is dropped rather than resurrected.
 *  - List endpoints are not wrapped for paging: `usePaginatedList` owns that
 *    and takes a url + row parser from `farmerLists` below.
 */
import { Platform } from 'react-native';

import { api, http } from '../../../core/api/client';
import { LIMITS } from '../../../core/api/domainConstants';
import { endpoints } from '../../../core/api/endpoints';
import type { ListQuery, Paginated, ServerResponse } from '../../../core/api/types';
import {
  parseBulkImportResult,
  parseFarmer,
  parseFarmerCreditScoreDetail,
  parseMapFarmResult,
  parseNinVerificationResult,
  toFarmerBody,
  toUpdateFarmerBody,
  type BulkImportResult,
  type Farmer,
  type FarmerCreditScoreDetail,
  type FarmerFormInput,
  type GpsPoint,
  type MapFarmResult,
  type NinVerificationResult,
} from '../model/farmer';
import {
  parseFieldNote,
  toFieldNoteBody,
  toUpdateFieldNoteBody,
  type FieldNote,
  type FieldNoteFormInput,
} from '../model/fieldNote';
import {
  parseMarketAccess,
  toMarketAccessBody,
  toUpdateMarketAccessBody,
  type MarketAccess,
  type MarketAccessFormInput,
} from '../model/marketAccess';
import {
  parseProductionYield,
  parseSeasonalYield,
  toProductionBody,
  toUpdateProductionBody,
  type ProductionFormInput,
  type ProductionYield,
  type SeasonalYield,
} from '../model/productionYield';
import {
  parseFarmerFinancingRequest,
  parseRepayment,
  parseRepaymentResult,
  toRepaymentBody,
  type FarmerFinancingRequest,
  type Repayment,
  type RepaymentFormInput,
  type RepaymentResult,
} from '../model/repayment';

const PAGE_SIZE = LIMITS.pageSize.default;

function mapPage<T>(page: Paginated<unknown>, parse: (raw: unknown) => T): Paginated<T> {
  return { items: page.items.map(parse), meta: page.meta };
}

// ----------------------------------------------------------------- farmers
export interface FarmerListParams extends ListQuery {
  search?: string;
  cooperativeId?: string;
  lga?: string;
  state?: string;
  /** `listQuery.tier` is `valid('A','B','C','D')` — uppercase only. */
  tier?: string;
}

/** `GET /agent/farmers` */
export async function fetchFarmers(
  params: FarmerListParams = {},
): Promise<Paginated<Farmer>> {
  const page = await api.getPaginated<unknown>(endpoints.farmers, {
    pageSize: PAGE_SIZE,
    ...params,
  });
  return mapPage(page, parseFarmer);
}

/** `GET /agent/cooperatives/:id/farmers` */
export async function fetchCooperativeFarmers(
  cooperativeId: string,
  params: ListQuery = {},
): Promise<Paginated<Farmer>> {
  const page = await api.getPaginated<unknown>(
    endpoints.cooperativeFarmers(cooperativeId),
    { pageSize: PAGE_SIZE, ...params },
  );
  return mapPage(page, parseFarmer);
}

/** `GET /agent/farmers/:id` — returns the hydrated farmer with `farm`. */
export async function fetchFarmer(id: string): Promise<Farmer> {
  return parseFarmer(await api.get<unknown>(endpoints.farmerById(id)));
}

/** `POST /agent/farmers` — returns the created, hydrated farmer. */
export async function createFarmer(input: FarmerFormInput): Promise<Farmer> {
  return parseFarmer(await api.post<unknown>(endpoints.farmers, toFarmerBody(input)));
}

/**
 * `POST /agent/farmers` from an already-built body.
 * Used by the offline queue, which persisted the body rather than the form.
 */
export async function createFarmerFromBody(
  body: Record<string, unknown>,
): Promise<Farmer> {
  return parseFarmer(await api.post<unknown>(endpoints.farmers, body));
}

/** `PATCH /agent/farmers/:id` */
export async function updateFarmer(
  id: string,
  input: FarmerFormInput,
): Promise<Farmer> {
  return parseFarmer(
    await api.patch<unknown>(endpoints.farmerById(id), toUpdateFarmerBody(input)),
  );
}

/**
 * `DELETE /agent/farmers/:id`
 *
 * The backend has supported this all along (`farmers.remove`, which also
 * refreshes the cooperative's member count and rescores it); the Flutter UI
 * for it was ~86 commented-out lines.
 */
export async function deleteFarmer(id: string): Promise<void> {
  await api.delete<unknown>(endpoints.farmerById(id));
}

/**
 * `POST /agent/farmers/:farmerId/verify-nin`
 *
 * Re-runs the NIN provider check against the farmer's stored NIN and
 * date of birth, and returns `verified` | `mismatch` | `failed`. Documented
 * backend feature with no UI at all in Flutter.
 */
export async function verifyFarmerNin(
  farmerId: string,
): Promise<NinVerificationResult> {
  return parseNinVerificationResult(
    await api.post<unknown>(endpoints.verifyFarmerNin(farmerId)),
  );
}

/**
 * `POST /agent/farmers/:farmerId/map-farm`
 *
 * The server computes the area and centroid from the walked boundary, so the
 * agent never has to type acreage. `gpsPolygon` is
 * `array().items({lat, lng}).min(3).required()`.
 */
export async function mapFarm(
  farmerId: string,
  gpsPolygon: GpsPoint[],
  overrideSizeAcres?: number,
): Promise<MapFarmResult> {
  if (gpsPolygon.length < LIMITS.minPolygonPoints) {
    throw new Error(
      `A farm boundary needs at least ${LIMITS.minPolygonPoints} points.`,
    );
  }

  return parseMapFarmResult(
    await api.post<unknown>(endpoints.mapFarm(farmerId), {
      gpsPolygon,
      ...(overrideSizeAcres != null ? { overrideSizeAcres } : {}),
    }),
  );
}

/** `GET /agent/farmers/:farmerId/credit-score` → `{ current, history }`. */
export async function fetchFarmerCreditScore(
  farmerId: string,
): Promise<FarmerCreditScoreDetail> {
  return parseFarmerCreditScoreDetail(
    await api.get<unknown>(endpoints.farmerCreditScore(farmerId)),
  );
}

/**
 * `GET /agent/farmers/:farmerId/seasonal-yield` → `{ seasons, summary }`.
 * `farmerSeasonalYieldEndpoint` existed in Dart and was never used.
 */
export async function fetchSeasonalYield(farmerId: string): Promise<SeasonalYield> {
  return parseSeasonalYield(
    await api.get<unknown>(endpoints.farmerSeasonalYield(farmerId)),
  );
}

// ------------------------------------------------------------- productions
export interface ProductionListParams extends ListQuery {
  farmerId?: string;
  crop?: string;
  season?: string;
}

/** `GET /agent/productions` */
export async function fetchProductions(
  params: ProductionListParams = {},
): Promise<Paginated<ProductionYield>> {
  const page = await api.getPaginated<unknown>(endpoints.productions, {
    pageSize: PAGE_SIZE,
    ...params,
  });
  return mapPage(page, parseProductionYield);
}

/** `GET /agent/productions/:id` */
export async function fetchProduction(id: string): Promise<ProductionYield> {
  return parseProductionYield(await api.get<unknown>(endpoints.productionById(id)));
}

/** `POST /agent/productions` */
export async function createProduction(
  input: ProductionFormInput,
): Promise<ProductionYield> {
  return parseProductionYield(
    await api.post<unknown>(endpoints.productions, toProductionBody(input)),
  );
}

/** `PATCH /agent/productions/:id` */
export async function updateProduction(
  id: string,
  input: ProductionFormInput,
): Promise<ProductionYield> {
  return parseProductionYield(
    await api.patch<unknown>(endpoints.productionById(id), toUpdateProductionBody(input)),
  );
}

/** `DELETE /agent/productions/:id` — UI was commented out in Flutter. */
export async function deleteProduction(id: string): Promise<void> {
  await api.delete<unknown>(endpoints.productionById(id));
}

// ----------------------------------------------------------- market access
/** `GET /agent/farmers/:farmerId/market-access` — a plain array, not paged. */
export async function fetchMarketAccess(farmerId: string): Promise<MarketAccess[]> {
  const data = await api.get<unknown>(endpoints.farmerMarketAccess(farmerId));
  return Array.isArray(data) ? data.map(parseMarketAccess) : [];
}

/** `POST /agent/market-access` */
export async function createMarketAccess(
  input: MarketAccessFormInput,
): Promise<MarketAccess> {
  return parseMarketAccess(
    await api.post<unknown>(endpoints.marketAccess, toMarketAccessBody(input)),
  );
}

/** `PATCH /agent/market-access/:recordId` */
export async function updateMarketAccess(
  recordId: string,
  input: MarketAccessFormInput,
): Promise<MarketAccess> {
  return parseMarketAccess(
    await api.patch<unknown>(
      endpoints.marketAccessById(recordId),
      toUpdateMarketAccessBody(input),
    ),
  );
}

/** `DELETE /agent/market-access/:recordId` — responds 204, no body. */
export async function deleteMarketAccess(recordId: string): Promise<void> {
  await api.delete<unknown>(endpoints.marketAccessById(recordId));
}

// -------------------------------------------------------------- field notes
/** `GET /agent/farmers/:farmerId/field-notes` — a plain array, newest first. */
export async function fetchFieldNotes(farmerId: string): Promise<FieldNote[]> {
  const data = await api.get<unknown>(endpoints.farmerFieldNotes(farmerId));
  return Array.isArray(data) ? data.map(parseFieldNote) : [];
}

/** `POST /agent/field-notes` */
export async function createFieldNote(
  input: FieldNoteFormInput,
): Promise<FieldNote> {
  return parseFieldNote(
    await api.post<unknown>(endpoints.fieldNotes, toFieldNoteBody(input)),
  );
}

/** `PATCH /agent/field-notes/:noteId` */
export async function updateFieldNote(
  noteId: string,
  input: FieldNoteFormInput,
): Promise<FieldNote> {
  return parseFieldNote(
    await api.patch<unknown>(
      endpoints.fieldNoteById(noteId),
      toUpdateFieldNoteBody(input),
    ),
  );
}

/** `DELETE /agent/field-notes/:noteId` — responds 204, no body. */
export async function deleteFieldNote(noteId: string): Promise<void> {
  await api.delete<unknown>(endpoints.fieldNoteById(noteId));
}

// --------------------------------------------------------------- repayments
/** `POST /agent/repayments` — returns the row plus the outstanding balance. */
export async function createRepayment(
  input: RepaymentFormInput,
): Promise<RepaymentResult> {
  return parseRepaymentResult(
    await api.post<unknown>(endpoints.repayments, toRepaymentBody(input)),
  );
}

/** `GET /agent/repayments` — implemented in Dart, never called. */
export async function fetchRepayments(
  params: ListQuery = {},
): Promise<Paginated<Repayment>> {
  const page = await api.getPaginated<unknown>(endpoints.repayments, {
    pageSize: PAGE_SIZE,
    ...params,
  });
  return mapPage(page, parseRepayment);
}

/**
 * `GET /agent/financing-requests?farmerId=…`
 *
 * Feeds the Record Repayment picker. Only `approved` / `disbursed` requests
 * can take a payment (`repayments.controller.create`), so the caller filters
 * with `isRepayable`.
 */
export async function fetchFarmerFinancingRequests(
  farmerId: string,
  params: ListQuery = {},
): Promise<Paginated<FarmerFinancingRequest>> {
  const page = await api.getPaginated<unknown>(endpoints.financingRequests, {
    pageSize: PAGE_SIZE,
    farmerId,
    ...params,
  });
  return mapPage(page, parseFarmerFinancingRequest);
}

// ------------------------------------------------------------- bulk import
/**
 * `POST /agent/imports` — multipart CSV upload.
 *
 * The field name must be `file` (`csvUpload.single('file')`), and the limit is
 * 10 MB.
 */
export async function bulkImportFarmers(input: {
  uri: string;
  fileName?: string;
  mimeType?: string;
}): Promise<BulkImportResult> {
  const form = new FormData();
  form.append('file', {
    uri: input.uri,
    name: input.fileName ?? 'farmers.csv',
    type: input.mimeType ?? 'text/csv',
  } as unknown as Blob);

  return parseBulkImportResult(
    await api.post<unknown>(endpoints.imports, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'x-platform': Platform.OS === 'ios' ? 'ios' : 'android',
      },
    }),
  );
}

/** `GET /agent/imports` — the agent's past import runs. */
export async function fetchImports(
  params: ListQuery = {},
): Promise<Paginated<unknown>> {
  return api.getPaginated<unknown>(endpoints.imports, {
    pageSize: PAGE_SIZE,
    ...params,
  });
}

/**
 * `GET /agent/imports/template` — the official CSV template.
 *
 * NOTE — this is the one endpoint in the app that does **not** return the
 * `ServerResponse` envelope: `imports.downloadTemplate` sends raw
 * `text/csv` with a `Content-Disposition` header. `api.get` would unwrap
 * `body.data` off a string and resolve to null, so the shared axios instance
 * (same base URL, same bearer token, same 401 refresh) is used directly with
 * `responseType: 'text'`. It is not a bypass of the client — just of the
 * envelope that this response does not have.
 */
export async function fetchImportTemplateCsv(): Promise<string> {
  const response = await http.get<ServerResponse<unknown> | string>(
    endpoints.importsTemplate,
    { responseType: 'text', transformResponse: [(data: unknown) => data] },
  );

  return typeof response.data === 'string' ? response.data : '';
}

/**
 * List endpoint descriptors for `usePaginatedList` — the url plus the row
 * parser each paginated hook needs, so the path stays declared in one place.
 */
export const farmerLists = {
  /** `GET /agent/farmers` */
  farmers: { url: endpoints.farmers, parse: parseFarmer },
  /** `GET /agent/productions` */
  productions: { url: endpoints.productions, parse: parseProductionYield },
  /** `GET /agent/repayments` */
  repayments: { url: endpoints.repayments, parse: parseRepayment },
  /** `GET /agent/financing-requests` */
  financingRequests: {
    url: endpoints.financingRequests,
    parse: parseFarmerFinancingRequest,
  },
  /** `GET /agent/imports` */
  imports: { url: endpoints.imports, parse: (raw: unknown) => raw },
} as const;
