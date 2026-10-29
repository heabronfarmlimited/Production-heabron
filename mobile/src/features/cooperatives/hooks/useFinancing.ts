/**
 * Financing queries + mutations — replace `FinancingHistoryController` and
 * `FinancingRequestController`.
 *
 * Both Dart controllers were non-autoDispose globals that screens expected a
 * *different* screen to have populated, and `FinancingHistoryView` never
 * requested page 2 even though its controller supported pagination.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { endpoints } from '../../../core/api/endpoints';
import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import * as cooperativesApi from '../api/cooperativesApi';
import {
  parseFinancingHistoryItem,
  type FinancingHistoryItem,
} from '../model/financing';
import type { FinancingRequestForm } from '../model/validation';

/** Root segment of every financing-request list key — see useCooperatives.ts. */
const financingRoot = [qk.financingRequests()[0]] as const;

/** Stable `select` reference for `usePaginatedList`. */
const parseItem = (raw: unknown): FinancingHistoryItem =>
  parseFinancingHistoryItem(raw);

// -------------------------------------------------------------------- list
export interface FinancingHistoryFilters {
  /** `''` for the "All" tab — `usePaginatedList` strips empty params. */
  status?: string;
}

/**
 * `GET /agent/financing-requests?cooperativeId=…`, paginated.
 *
 * FIXED — the Flutter screen fetched exactly one page and filtered the four
 * tabs client-side over that page, so "Approved" showed only the approved
 * requests that happened to fall in the first 20 rows. `status` is a
 * server-side filter (`financing.controller.js` `list`), so each tab is its
 * own correctly-paginated query.
 */
export function useFinancingHistory(
  cooperativeId: string,
  filters: FinancingHistoryFilters = {},
) {
  const params = useMemo(
    () => ({ cooperativeId, status: filters.status }),
    [cooperativeId, filters.status],
  );

  return usePaginatedList<FinancingHistoryItem>({
    queryKey: qk.financingRequests(params),
    url: endpoints.financingRequests,
    params,
    select: parseItem,
    enabled: cooperativeId.length > 0,
  });
}

/**
 * The by-farmer variant — `getFinancingHistoryByFarmerId`. Used by the
 * farmers module's repayment flow to list a farmer's active requests.
 *
 * FIXED — the Dart abstract declared `pageSize = 100` and the implementation
 * `pageSize = 20`, so the page size depended on which type the caller held.
 */
export function useFarmerFinancingHistory(
  farmerId: string,
  filters: FinancingHistoryFilters = {},
) {
  const params = useMemo(
    () => ({ farmerId, status: filters.status }),
    [farmerId, filters.status],
  );

  return usePaginatedList<FinancingHistoryItem>({
    queryKey: qk.financingRequests(params),
    url: endpoints.financingRequests,
    params,
    select: parseItem,
    enabled: farmerId.length > 0,
  });
}

// ------------------------------------------------------------------ detail
/**
 * `GET /agent/financing-requests/:id`
 *
 * `FinancingDetailsView` was handed the list row through route arguments. The
 * list query selects a subset of columns, so fields the detail screen renders
 * (`repayment_records`, the full cooperative) were never present.
 */
export function useFinancingRequest(id: string) {
  return useQuery({
    queryKey: qk.financingRequest(id),
    enabled: id.length > 0,
    queryFn: () => cooperativesApi.fetchFinancingRequest(id),
  });
}

// --------------------------------------------------------------- mutations
/** `POST /agent/financing-requests`. */
export function useCreateFinancingRequest(cooperativeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (form: FinancingRequestForm) =>
      cooperativesApi.createFinancingRequest(cooperativeId, form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financingRoot });
      // The cooperative's `stats.financingRequests` count changes.
      void queryClient.invalidateQueries({
        queryKey: qk.cooperative(cooperativeId),
      });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      showSuccess('Financing request submitted successfully');
    },
    onError: showApiError,
  });
}
