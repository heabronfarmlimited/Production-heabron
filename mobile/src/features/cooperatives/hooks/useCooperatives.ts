/**
 * Cooperative queries + mutations — replace `CooperativesController`,
 * `CreateCooperativeController`, `EditCooperativeController` and the
 * `CooperativesListener` Hive bridge.
 *
 * In the Dart app the cooperatives list reached the screen through a
 * `ValueListenableBuilder` over a Hive box that the *repository* wrote to as a
 * side effect of fetching. Three layers owned the same list, and the
 * controllers re-implemented pagination on top (with the off-by-one bug noted
 * in CONVENTIONS.md). The query cache replaces all of it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { endpoints } from '../../../core/api/endpoints';
import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import { parseFarmer, type Farmer } from '../../farmers/model/farmer';
import * as cooperativesApi from '../api/cooperativesApi';
import { parseCooperative, type Cooperative } from '../model/cooperative';

/**
 * `usePaginatedList`'s `select` is a dependency of a `useMemo`, so it must be
 * referentially stable — a module-level binding rather than an inline lambda.
 */
const parseFarmerRow = (raw: unknown): Farmer => parseFarmer(raw);

/**
 * Every cooperative list key starts with this segment. `usePaginatedList`
 * appends the cleaned params and the page size to the key it is given, so
 * invalidating `qk.cooperatives(filters)` would only match the one filter
 * combination currently on screen. The root is derived from `qk` so a rename
 * there follows through.
 */
const cooperativesRoot = [qk.cooperatives()[0]] as const;

// -------------------------------------------------------------------- list
export interface CooperativesFilters {
  search?: string;
}

/** `GET /agent/cooperatives`, paginated. */
export function useCooperatives(filters: CooperativesFilters = {}) {
  const params = useMemo(() => ({ search: filters.search }), [filters.search]);

  return usePaginatedList<Cooperative>({
    queryKey: qk.cooperatives(params),
    url: endpoints.cooperatives,
    params,
    select: parseCooperative,
  });
}

// ------------------------------------------------------------------ detail
/**
 * `GET /agent/cooperatives/:id`
 *
 * New to the client. Flutter passed the whole `Cooperative` through route
 * arguments, so the detail screen showed whatever the list query had selected
 * and never reflected an edit.
 */
export function useCooperative(id: string) {
  return useQuery({
    queryKey: qk.cooperative(id),
    enabled: id.length > 0,
    queryFn: () => cooperativesApi.fetchCooperative(id),
  });
}

// ----------------------------------------------------------------- farmers
/**
 * `GET /agent/cooperatives/:id/farmers`, paginated.
 *
 * FIXED — `FarmerCooperativeController` was a non-autoDispose global that
 * `CooperativeDetailsView` populated and `FinancingRequestView` then read.
 * Any entry path that skipped the detail screen left the financing form's
 * farmer dropdown empty. Each screen calls this hook for itself now; the cache
 * key is the cooperative, so they still share one request.
 */
export function useCooperativeFarmers(cooperativeId: string) {
  return usePaginatedList<Farmer>({
    queryKey: qk.cooperativeFarmers(cooperativeId),
    url: endpoints.cooperativeFarmers(cooperativeId),
    select: parseFarmerRow,
    enabled: cooperativeId.length > 0,
  });
}

// --------------------------------------------------------------- mutations
/** `POST /agent/cooperatives` — toast copy from `CreateCooperativeController`. */
export function useCreateCooperative() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      cooperativesApi.createCooperative(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cooperativesRoot });
      // The dashboard shows a cooperative count.
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      showSuccess('Cooperative created successfully');
    },
    onError: showApiError,
  });
}

/**
 * `PATCH /agent/cooperatives/:id`
 *
 * FIXED — `EditCooperativeController.submit` called `fetchMore()` instead of
 * `fetchInitial()`, so an edit appended the *next* page to the cache and left
 * the edited record stale on both the list and the detail screen. It then
 * popped with the magic number `popUntil(3)`. Here the single record and the
 * lists are invalidated, and the screen decides where to go.
 */
export function useUpdateCooperative(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      cooperativesApi.updateCooperative(id, body),
    onSuccess: (updated: Cooperative) => {
      // Seed the detail cache so the screen behind us repaints immediately.
      queryClient.setQueryData(qk.cooperative(id), updated);
      void queryClient.invalidateQueries({ queryKey: qk.cooperative(id) });
      void queryClient.invalidateQueries({ queryKey: cooperativesRoot });
      showSuccess('Cooperative updated successfully');
    },
    onError: showApiError,
  });
}

/**
 * `DELETE /agent/cooperatives/:id`
 *
 * Re-enabled: the backend has always supported it and the Dart repository
 * implemented it, but the only call site — the `Delete Cooperative` row plus
 * its ~120-line confirmation sheet — was commented out.
 */
export function useDeleteCooperative() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => cooperativesApi.deleteCooperative(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: qk.cooperative(id) });
      queryClient.removeQueries({ queryKey: qk.cooperativeFarmers(id) });
      void queryClient.invalidateQueries({ queryKey: cooperativesRoot });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      showSuccess('Cooperative deleted successfully');
    },
    onError: showApiError,
  });
}
