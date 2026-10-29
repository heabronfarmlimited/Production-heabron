/**
 * TanStack Query setup — replaces the `ChangeNotifier` controllers plus the
 * Hive-cache-as-view-model pattern (`DashboardListener`, `CooperativesListener`).
 *
 * The Dart app hand-rolled caching, pagination and refresh in each controller,
 * which is where the off-by-one page bug and the stuck loading states came
 * from. A query cache handles all three.
 */
import { QueryClient } from '@tanstack/react-query';

import { AppError } from './AppError';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Field agents work on poor connections; keep data usable while refetching.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error) => {
        const err = AppError.from(error);
        // Never retry an auth or validation failure — only transport blips.
        if (err.status && err.status < 500 && err.status !== 429) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * Query keys, centralised so invalidation after a mutation is exact rather
 * than a guess. The Dart code called `fetchInitial()` / `fetchMore()` by hand
 * and sometimes the wrong one (EditCooperative called `fetchMore`, so edits
 * never refreshed).
 */
export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,

  cooperatives: (filters?: object) =>
    ['cooperatives', filters ?? {}] as const,
  cooperative: (id: string) => ['cooperative', id] as const,
  cooperativeFarmers: (id: string) => ['cooperative', id, 'farmers'] as const,

  farmers: (filters?: object) => ['farmers', filters ?? {}] as const,
  farmer: (id: string) => ['farmer', id] as const,
  farmerCreditScore: (id: string) => ['farmer', id, 'credit-score'] as const,
  farmerSeasonalYield: (id: string) => ['farmer', id, 'seasonal-yield'] as const,
  farmerMarketAccess: (id: string) => ['farmer', id, 'market-access'] as const,
  farmerFieldNotes: (id: string) => ['farmer', id, 'field-notes'] as const,

  productions: (filters?: object) =>
    ['productions', filters ?? {}] as const,
  production: (id: string) => ['production', id] as const,

  financingRequests: (filters?: object) =>
    ['financing-requests', filters ?? {}] as const,
  financingRequest: (id: string) => ['financing-request', id] as const,

  repayments: (filters?: object) =>
    ['repayments', filters ?? {}] as const,

  deliveries: (filters?: object) =>
    ['deliveries', filters ?? {}] as const,

  wallet: ['wallet'] as const,
  walletTransactions: (filters?: object) =>
    ['wallet', 'transactions', filters ?? {}] as const,
  walletTransaction: (id: string) => ['wallet', 'transaction', id] as const,
  settlements: (filters?: object) =>
    ['wallet', 'settlements', filters ?? {}] as const,

  notifications: (filters?: object) =>
    ['notifications', filters ?? {}] as const,
  notificationsUnreadCount: ['notifications', 'unread-count'] as const,

  bankAccount: ['bank-account'] as const,
  imports: (filters?: object) => ['imports', filters ?? {}] as const,
  changeRequests: (filters?: object) =>
    ['change-requests', filters ?? {}] as const,
} as const;

/** Clears all cached server state — call on logout. */
export function clearQueryCache(): void {
  queryClient.clear();
}
