/**
 * Dashboard query — replaces `DashboardController` + `DashboardListener`.
 *
 * The Dart version fired an un-awaited fetch in the controller constructor,
 * wrote the result into Hive, and rendered from a `ValueListenableBuilder` on
 * that box — so the screen read cache while the network write happened
 * out of band. The query cache does both jobs, and MMKV still backs it so a
 * cold start shows the last known numbers before the refetch lands.
 */
import { useQuery } from '@tanstack/react-query';

import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import { qk } from '../../../core/api/queryClient';
import { storage, StorageKeys } from '../../../core/storage/storage';
import { parseDashboard, type DashboardData } from '../model/dashboard';

export function useDashboard() {
  // Offline-first, as the Hive-backed Dart screen was.
  const cached = storage.readJson<DashboardData>(StorageKeys.dashboardData);

  const query = useQuery({
    queryKey: qk.dashboard,
    queryFn: async () => {
      const raw = await api.get<unknown>(endpoints.dashboard);
      const data = parseDashboard(raw);
      storage.writeJson(StorageKeys.dashboardData, data);
      return data;
    },
    initialData: cached,
  });

  return {
    data: query.data,
    isLoading: query.isLoading && !cached,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}
