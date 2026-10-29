/**
 * Cooperatives + financing endpoints — ported from
 * modules/cooperatives/data/repository/cooperatives_remote_repository_impl.dart
 *
 * Every call goes through `api` from core/api/client.ts, which unwraps the
 * `ServerResponse` envelope and throws `AppError`.
 *
 * Changes from the Dart repository:
 *
 *  - `fetchCooperatives` interpolated `?page=&pageSize=` into the URL string
 *    rather than passing `queryParameters` (the only call in the app that did),
 *    and carried a Hive cache side effect that silently dropped any page past
 *    the first when the cache happened to be null. Query params are params, and
 *    caching belongs to TanStack Query.
 *  - `financingRequestsEndpoint` and `financingHistoryEndpoint` were two
 *    constants with the identical value `/agent/financing-requests`; there is
 *    one here (`endpoints.financingRequests`).
 *  - `getFinancingHistoryByFarmerId` declared `pageSize = 100` on the abstract
 *    repository and `pageSize = 20` on the implementation. Both variants now
 *    take the same default.
 */
import { api } from '../../../core/api/client';
import { LIMITS } from '../../../core/api/domainConstants';
import { endpoints } from '../../../core/api/endpoints';
import type { ListQuery, Paginated } from '../../../core/api/types';
import { parseFarmer, type Farmer } from '../../farmers/model/farmer';
import { parseCooperative, type Cooperative } from '../model/cooperative';
import {
  parseFinancingHistoryItem,
  toFinancingRequestBody,
  type FinancingHistoryItem,
} from '../model/financing';
import type { FinancingRequestForm } from '../model/validation';

/** Shared page-size default. */
const PAGE_SIZE = LIMITS.pageSize.default;

function mapPage<T>(page: Paginated<unknown>, parse: (raw: unknown) => T): Paginated<T> {
  return { items: page.items.map(parse), meta: page.meta };
}

// ------------------------------------------------------------ cooperatives
export interface CooperativeListParams extends ListQuery {
  search?: string;
  state?: string;
  lga?: string;
  crop?: string;
}

/** `GET /agent/cooperatives` */
export async function fetchCooperatives(
  params: CooperativeListParams = {},
): Promise<Paginated<Cooperative>> {
  const page = await api.getPaginated<unknown>(endpoints.cooperatives, {
    pageSize: PAGE_SIZE,
    ...params,
  });
  return mapPage(page, parseCooperative);
}

/** `POST /agent/cooperatives` — body shaped by `toCooperativeBody`. */
export async function createCooperative(
  body: Record<string, unknown>,
): Promise<Cooperative> {
  return parseCooperative(await api.post<unknown>(endpoints.cooperatives, body));
}

/**
 * `GET /agent/cooperatives/:id`
 *
 * This endpoint is new to the client: the Flutter app had no "get one"
 * repository method and passed the whole `Cooperative` object through the
 * route arguments instead, which is why every cooperative screen force-cast
 * `settings.arguments! as Cooperative` and threw on a cold deep link. It also
 * meant an edit never refreshed the detail screen. Screens take an id and
 * read the record from here.
 */
export async function fetchCooperative(id: string): Promise<Cooperative> {
  return parseCooperative(await api.get<unknown>(endpoints.cooperativeById(id)));
}

/** `PATCH /agent/cooperatives/:id` — `updateCooperative` validator. */
export async function updateCooperative(
  id: string,
  body: Record<string, unknown>,
): Promise<Cooperative> {
  return parseCooperative(
    await api.patch<unknown>(endpoints.cooperativeById(id), body),
  );
}

/**
 * `DELETE /agent/cooperatives/:id`
 *
 * Supported by the backend (`cooperatives.controller.js` `remove`) and
 * implemented in the Dart repository, but its only call site — the
 * `Delete Cooperative` row and its confirmation sheet — was commented out, so
 * the flow was unreachable. It is wired up again here.
 */
export async function deleteCooperative(id: string): Promise<void> {
  await api.delete<unknown>(endpoints.cooperativeById(id));
}

/**
 * `GET /agent/cooperatives/:id/farmers`
 *
 * Rows are shaped by the backend's `shapeFarmers`, so they parse with the
 * farmers module's `parseFarmer`.
 */
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

// --------------------------------------------------------------- financing
export interface FinancingListParams extends ListQuery {
  cooperativeId?: string;
  farmerId?: string;
  status?: string;
}

/** `GET /agent/financing-requests` */
export async function fetchFinancingRequests(
  params: FinancingListParams = {},
): Promise<Paginated<FinancingHistoryItem>> {
  const page = await api.getPaginated<unknown>(endpoints.financingRequests, {
    pageSize: PAGE_SIZE,
    ...params,
  });
  return mapPage(page, parseFinancingHistoryItem);
}

/** `getFinancingHistory(cooperativeId)` — the by-cooperative variant. */
export function fetchFinancingRequestsByCooperative(
  cooperativeId: string,
  params: ListQuery = {},
): Promise<Paginated<FinancingHistoryItem>> {
  return fetchFinancingRequests({ ...params, cooperativeId });
}

/** `getFinancingHistoryByFarmerId(farmerId)` — the by-farmer variant. */
export function fetchFinancingRequestsByFarmer(
  farmerId: string,
  params: ListQuery = {},
): Promise<Paginated<FinancingHistoryItem>> {
  return fetchFinancingRequests({ ...params, farmerId });
}

/** `POST /agent/financing-requests` — `createFinancingRequest` validator. */
export async function createFinancingRequest(
  cooperativeId: string,
  form: FinancingRequestForm,
): Promise<FinancingHistoryItem> {
  return parseFinancingHistoryItem(
    await api.post<unknown>(
      endpoints.financingRequests,
      toFinancingRequestBody(cooperativeId, form),
    ),
  );
}

/**
 * `GET /agent/financing-requests/:id`
 *
 * Another endpoint the Flutter app never called — `FinancingDetailsView` was
 * handed the list row through route arguments, so the detail screen could only
 * show the subset of columns the list query selected and never saw an update.
 */
export async function fetchFinancingRequest(
  id: string,
): Promise<FinancingHistoryItem> {
  return parseFinancingHistoryItem(
    await api.get<unknown>(endpoints.financingRequestById(id)),
  );
}
