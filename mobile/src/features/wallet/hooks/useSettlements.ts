/**
 * Settlement list + request mutation — replaces `SettlementHistoryController`
 * and the `requestSettlement` half of `RequestSettlementController`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { requestSettlement, walletLists } from '../api/walletApi';
import type {
  SettlementRequest,
  SettlementRequestInput,
} from '../model/settlementRequest';

/** `GET /agent/wallet/settlements` — infinite list. */
export function useSettlements() {
  return usePaginatedList<SettlementRequest>({
    queryKey: qk.settlements(),
    url: walletLists.settlements.url,
    select: walletLists.settlements.parse,
  });
}

/**
 * `POST /agent/wallet/settlements`
 *
 * Invalidates the wallet balance as well as the settlement list: the request
 * does not move money yet, but the Dart controller refreshed both and an
 * admin approval between screens would otherwise leave a stale balance.
 */
export function useRequestSettlement() {
  const queryClient = useQueryClient();

  const mutation = useMutation<SettlementRequest, unknown, SettlementRequestInput>({
    mutationFn: requestSettlement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.settlements() });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: qk.walletTransactions() });
    },
  });

  return {
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
