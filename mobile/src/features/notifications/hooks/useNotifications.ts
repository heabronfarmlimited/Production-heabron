/**
 * Notification list — replaces the list half of `NotificationsController`.
 *
 * FIXED — the Dart controller advanced `_currentPage` only while `_hasMore`
 * was true, so the final page was re-fetched on every further scroll; and
 * `notificationsProvider` was **not** autoDispose, so the accumulated list
 * survived leaving the screen and reappeared stale. `usePaginatedList` derives
 * the cursor from `meta`, and the query cache handles the lifetime.
 */
import { useMemo } from 'react';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { notificationsList } from '../api/notificationsApi';
import { isToday, type NotificationItem } from '../model/notificationItem';

import { useUnreadCount } from './useUnreadCount';

export function useNotifications() {
  const list = usePaginatedList<NotificationItem>({
    queryKey: qk.notifications(),
    url: notificationsList.url,
    select: notificationsList.parse,
  });

  const { count: unreadCount, refresh: refreshUnreadCount } = useUnreadCount();

  /**
   * The Today / Earlier split, computed exactly as the Dart view did: a
   * same-local-day comparison against `DateTime.now()`.
   */
  const { today, earlier } = useMemo(() => {
    const now = new Date();
    const todayItems: NotificationItem[] = [];
    const earlierItems: NotificationItem[] = [];

    list.items.forEach((item) => {
      if (isToday(item, now)) todayItems.push(item);
      else earlierItems.push(item);
    });

    return { today: todayItems, earlier: earlierItems };
  }, [list.items]);

  return {
    ...list,
    today,
    earlier,
    unreadCount,
    /** Pull-to-refresh must refresh the badge too. */
    refreshAll: () => {
      list.refresh();
      refreshUnreadCount();
    },
  };
}
