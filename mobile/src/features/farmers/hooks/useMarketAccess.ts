/**
 * Market-access queries and mutations — replaces `MarketAccessController`.
 *
 * Three Dart defects are fixed by moving to a query cache:
 *  - the controller fetched from its own constructor, so building the provider
 *    was a side effect;
 *  - `addMarketAccess` / `updateMarketAccess` had no `finally`, so on success
 *    `AppState.loading` was never cleared and the screen stayed blocked;
 *  - the list refreshed only because each navigation `.then()` called
 *    `fetchMarketAccess()` by hand.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import {
  createMarketAccess,
  deleteMarketAccess,
  fetchMarketAccess,
  updateMarketAccess,
} from '../api/farmersApi';
import type { MarketAccess, MarketAccessFormInput } from '../model/marketAccess';

/** `GET /agent/farmers/:farmerId/market-access` — a plain array, not paged. */
export function useMarketAccessRecords(farmerId: string) {
  const query = useQuery<MarketAccess[]>({
    queryKey: qk.farmerMarketAccess(farmerId),
    queryFn: () => fetchMarketAccess(farmerId),
    enabled: farmerId.length > 0,
  });

  return {
    records: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

function useMarketAccessInvalidation(farmerId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.farmerMarketAccess(farmerId) });
    // Offtake history is a credit-score input.
    void queryClient.invalidateQueries({ queryKey: qk.farmerCreditScore(farmerId) });
  };
}

/** `POST /agent/market-access` */
export function useCreateMarketAccess(farmerId: string) {
  const invalidate = useMarketAccessInvalidation(farmerId);

  const mutation = useMutation<MarketAccess, unknown, MarketAccessFormInput>({
    mutationFn: createMarketAccess,
    onSuccess: () => {
      invalidate();
      showSuccess('Market Access record added');
    },
  });

  return {
    create: mutation.mutate,
    createAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** `PATCH /agent/market-access/:recordId` */
export function useUpdateMarketAccess(farmerId: string, recordId: string) {
  const invalidate = useMarketAccessInvalidation(farmerId);

  const mutation = useMutation<MarketAccess, unknown, MarketAccessFormInput>({
    mutationFn: (input) => updateMarketAccess(recordId, input),
    onSuccess: () => {
      invalidate();
      showSuccess('Market Access record updated');
    },
  });

  return {
    update: mutation.mutate,
    updateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * `DELETE /agent/market-access/:recordId`
 *
 * Re-enabled: the Dart delete button was commented out while `onDelete`
 * remained a *required* prop wired to a live `deleteRecord`, i.e. dead code
 * guarding a working endpoint.
 */
export function useDeleteMarketAccess(farmerId: string) {
  const invalidate = useMarketAccessInvalidation(farmerId);

  const mutation = useMutation<void, unknown, string>({
    mutationFn: deleteMarketAccess,
    onSuccess: () => {
      invalidate();
      showSuccess('Record deleted');
    },
    onError: (err) => showApiError(err, 'Could not delete this record'),
  });

  return {
    remove: mutation.mutate,
    removeAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
