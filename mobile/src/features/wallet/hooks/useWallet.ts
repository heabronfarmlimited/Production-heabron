/**
 * Wallet balance + transaction queries — replaces `WalletController`.
 *
 * The Dart controller fetched the wallet and page 1 of the transactions in a
 * `Future.wait` from its constructor and kept both in instance fields. Two
 * queries do the same job, and `usePaginatedList` removes the page counter
 * that caused the re-fetch loop (see its header comment).
 */
import { useQuery } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { getTransaction, getWallet, walletLists } from '../api/walletApi';
import type { AgentWallet } from '../model/agentWallet';
import type { WalletTransaction } from '../model/walletTransaction';

/** `GET /agent/wallet` — the balance card. */
export function useWallet() {
  const query = useQuery<AgentWallet>({
    queryKey: qk.wallet,
    queryFn: getWallet,
  });

  return {
    wallet: query.data ?? null,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/** `GET /agent/wallet/transactions` — infinite list. */
export function useWalletTransactions(options: { pageSize?: number } = {}) {
  return usePaginatedList<WalletTransaction>({
    queryKey: qk.walletTransactions(),
    url: walletLists.transactions.url,
    select: walletLists.transactions.parse,
    pageSize: options.pageSize,
  });
}

/**
 * `GET /agent/wallet/transactions/:id`
 *
 * NOTE — the Flutter details screen received the whole `WalletTransaction`
 * through route arguments, which meant a deep link or an app restart landed on
 * "Invalid transaction data.". The by-id endpoint exists, so the screen takes
 * an id and fetches.
 */
export function useWalletTransaction(id: string) {
  const query = useQuery<WalletTransaction>({
    queryKey: qk.walletTransaction(id),
    queryFn: () => getTransaction(id),
    enabled: id.length > 0,
  });

  return {
    transaction: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}
