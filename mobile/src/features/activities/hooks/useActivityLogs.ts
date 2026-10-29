/**
 * The agent's own activity log — replaces the `DashboardListener` the Flutter
 * `RecentActivityLogsView` read from.
 *
 * The Dart screen rendered straight out of the Hive cache that
 * `DashboardController` wrote, so it showed nothing at all until the dashboard
 * had been visited once. A query of its own means the screen loads whether or
 * not the dashboard has run, and the result is cached for both.
 *
 * NOTE — this calls `GET /agent/dashboard` and reads only `recentActivity`,
 * because no agent-scoped activity-log route exists (see model/activityLog.ts).
 * It deliberately uses its own key rather than `qk.dashboard`, so the
 * dashboard module can keep its own parsed `DashboardData` under that key
 * without the two query functions fighting over one cache entry. The cost is
 * one extra request; the payload is five small aggregates plus 15 rows.
 */
import { useQuery } from '@tanstack/react-query';

import { listActivityLogs } from '../api/activitiesApi';
import type { ActivityLog } from '../model/activityLog';

/** Query key for the agent's activity log. */
export const activityLogsKey = ['activity-logs'] as const;

export function useActivityLogs() {
  const query = useQuery<ActivityLog[]>({
    queryKey: activityLogsKey,
    queryFn: listActivityLogs,
  });

  return {
    logs: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}
