/**
 * Unread notification count.
 *
 * Exported on its own so the dashboard module can consume it without pulling
 * in the notification list.
 *
 * FIXED (audit item: "DashboardHeader notification badge has no count") — the
 * Flutter dashboard rendered a bare `Badge(Icons.notifications_none)` with no
 * label, because `fetchUnreadCount` only ran inside `NotificationsController`
 * and the header never read it. The count now has its own query key, so the
 * header and the notifications screen share one cached value and the
 * optimistic read-marking in `useMarkRead` updates both at once.
 *
 * Usage from the dashboard header:
 *   const { count } = useUnreadCount();
 *   {count > 0 ? <Badge value={count > 99 ? '99+' : String(count)} /> : null}
 */
import { useQuery } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { getUnreadCount } from '../api/notificationsApi';

export interface UnreadCountResult {
  /** 0 while loading or on failure — a badge must never render undefined. */
  count: number;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
}

export function useUnreadCount(options: { enabled?: boolean } = {}): UnreadCountResult {
  const query = useQuery<number>({
    queryKey: qk.notificationsUnreadCount,
    queryFn: getUnreadCount,
    enabled: options.enabled ?? true,
  });

  return {
    count: query.data ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}
