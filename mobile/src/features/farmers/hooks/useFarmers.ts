/**
 * Farmer list + detail queries — replaces `FarmersController` and
 * `FarmerCooperativeController.fetchFarmers`.
 *
 * The Dart controller hand-rolled pagination with the off-by-one cursor
 * documented in `usePaginatedList`, re-requested the last page forever once it
 * was reached, and kept filters as four mutable fields that `setFilters`
 * overwrote wholesale — so typing in the search box silently cleared the LGA,
 * tier and cooperative filters. Here the filters are the query key, so each
 * combination caches independently and a search keystroke cannot clear them.
 */
import { useQuery } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import {
  fetchCooperativeFarmers,
  fetchFarmer,
  fetchFarmerCreditScore,
  fetchSeasonalYield,
  farmerLists,
} from '../api/farmersApi';
import type { Farmer, FarmerCreditScoreDetail } from '../model/farmer';
import type { SeasonalYield } from '../model/productionYield';

export interface FarmerFilters {
  search?: string;
  lga?: string;
  /** `A` | `B` | `C` | `D` — validated server-side. */
  tier?: string;
  cooperativeId?: string;
}

/**
 * `GET /agent/farmers` — infinite list.
 *
 * `usePaginatedList` strips empty values before they reach the wire, which
 * matters for `tier` and `cooperativeId`: `listQuery` validates them as an
 * enum and a UUID, so an empty string would 422 were it sent.
 */
export function useFarmers(filters: FarmerFilters = {}) {
  return usePaginatedList<Farmer>({
    queryKey: qk.farmers(filters),
    url: farmerLists.farmers.url,
    params: filters,
    select: farmerLists.farmers.parse,
  });
}

/**
 * `GET /agent/farmers/:id`
 *
 * NOTE — every Flutter farmer screen received the whole `Farmer` through route
 * arguments (`settings.arguments as Farmer?`), so a deep link or a process
 * restart landed on a blank screen, and an edit elsewhere never refreshed the
 * details view. The screens here take an id and read the cache, which the
 * mutations invalidate.
 */
export function useFarmer(id: string, options: { initialData?: Farmer } = {}) {
  const query = useQuery<Farmer>({
    queryKey: qk.farmer(id),
    queryFn: () => fetchFarmer(id),
    enabled: id.length > 0,
    initialData: options.initialData,
  });

  return {
    farmer: query.data ?? null,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/** `GET /agent/cooperatives/:id/farmers` — the cooperative's member list. */
export function useCooperativeFarmers(cooperativeId: string) {
  const query = useQuery({
    queryKey: qk.cooperativeFarmers(cooperativeId),
    queryFn: () => fetchCooperativeFarmers(cooperativeId),
    enabled: cooperativeId.length > 0,
  });

  return {
    farmers: query.data?.items ?? [],
    total: query.data?.meta?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/**
 * `GET /agent/farmers/:id/credit-score` → `{ current, history }`.
 *
 * The details screen reads `repaymentScore` from here. The Flutter screen
 * showed `creditScoreObj.productionScore` in *both* the Production and the
 * Repayment card — a copy/paste bug, so the repayment figure was never shown.
 */
export function useFarmerCreditScore(farmerId: string, enabled = true) {
  const query = useQuery<FarmerCreditScoreDetail>({
    queryKey: qk.farmerCreditScore(farmerId),
    queryFn: () => fetchFarmerCreditScore(farmerId),
    enabled: enabled && farmerId.length > 0,
  });

  return {
    score: query.data?.current ?? null,
    history: query.data?.history ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/**
 * `GET /agent/farmers/:id/seasonal-yield` → `{ seasons, summary }`.
 * The endpoint constant existed in Dart; nothing ever called it.
 */
export function useSeasonalYield(farmerId: string, enabled = true) {
  const query = useQuery<SeasonalYield>({
    queryKey: qk.farmerSeasonalYield(farmerId),
    queryFn: () => fetchSeasonalYield(farmerId),
    enabled: enabled && farmerId.length > 0,
  });

  return {
    seasons: query.data?.seasons ?? [],
    summary: query.data?.summary ?? null,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}
