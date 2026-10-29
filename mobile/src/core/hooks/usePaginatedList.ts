/**
 * Infinite list hook — replaces the hand-rolled pagination copied into
 * `FarmersController`, `FinancingHistoryController`,
 * `FarmerCooperativeController`, `WalletController`,
 * `SettlementHistoryController`, `NotificationsController` and
 * `ActivitiesController`.
 *
 * All seven shared this shape:
 *
 *   if (refresh) { page = 1; list = []; hasMore = true; }
 *   if (!hasMore && !refresh && list.isNotEmpty) return;
 *   res = repo.getX(page: page);
 *   list = page == 1 ? res.items : list + res.items;
 *   hasMore = page < (meta?.totalPages ?? 1);
 *   if (hasMore) page++;          // <-- the bug
 *
 * That last line only advances the cursor while more pages remain, so once the
 * final page loads the page number stays put and every further scroll re-fetches
 * the same page, appending duplicates. `useInfiniteQuery` derives the next page
 * from the server's own `meta`, so the cursor can't drift.
 */
import {
  useInfiniteQuery,
  type QueryKey,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '../api/client';
import { LIMITS } from '../api/domainConstants';
import type { Paginated } from '../api/types';

export interface PaginatedListOptions<T> {
  /** Cache key — use a `qk.*` helper. */
  queryKey: QueryKey;
  /** Endpoint path. */
  url: string;
  /**
   * Extra query params (search, status, tier, cooperativeId…).
   * Typed as a plain object so feature modules can pass their own named
   * filter interfaces without declaring an index signature on each.
   */
  params?: object;
  /** Maps a raw API row to the domain model. */
  select?: (raw: unknown) => T;
  pageSize?: number;
  enabled?: boolean;
}

export interface PaginatedListResult<T> {
  /** Every loaded page, flattened. */
  items: T[];
  total: number;
  isLoading: boolean;
  /** True only for a background refresh, so the list doesn't flash a spinner. */
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  /** Safe to call on every scroll event; no-ops when inappropriate. */
  loadMore: () => void;
  refresh: () => void;
  query: UseInfiniteQueryResult<unknown, unknown>;
}

export function usePaginatedList<T = unknown>({
  queryKey,
  url,
  params,
  select,
  pageSize = LIMITS.pageSize.default,
  enabled = true,
}: PaginatedListOptions<T>): PaginatedListResult<T> {
  // Empty strings are stripped: the backend's `listQuery` uses `.empty('')`,
  // but `tier` is a strict enum so sending a stray value would 422.
  const cleanParams = useMemo(() => {
    const out: Record<string, unknown> = {};
    Object.entries(params ?? {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    });
    return out;
  }, [params]);

  const query = useInfiniteQuery({
    queryKey: [...queryKey, cleanParams, pageSize],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.getPaginated<unknown>(url, {
        ...cleanParams,
        page: pageParam,
        pageSize: Math.min(pageSize, LIMITS.pageSize.max),
      }),
    getNextPageParam: (lastPage) => {
      const meta = (lastPage as Paginated<unknown>).meta;
      if (!meta) return undefined;
      return meta.page < meta.totalPages ? meta.page + 1 : undefined;
    },
  });

  const items = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const raw = pages.flatMap((p) => (p as Paginated<unknown>).items ?? []);
    return select ? raw.map(select) : (raw as T[]);
  }, [query.data, select]);

  const total = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const last = pages[pages.length - 1] as Paginated<unknown> | undefined;
    return last?.meta?.total ?? items.length;
  }, [query.data, items.length]);

  return {
    items,
    total,
    // Only the very first load blocks the UI.
    isLoading: query.isLoading,
    isRefetching: query.isRefetching && !query.isFetchingNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    error: query.error,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    refresh: () => void query.refetch(),
    query: query as UseInfiniteQueryResult<unknown, unknown>,
  };
}
