/**
 * Read-marking and clearing — replaces `markSingleAsRead`, `markAllAsRead` and
 * `clearAllNotifications` on `NotificationsController`.
 *
 * All three are **optimistic with rollback**, which is what the Dart
 * controller did by hand:
 *
 *   _notifications[index] = item.copyWith(isRead: true);
 *   if (_unreadCount > 0) _unreadCount--;
 *   notifyListeners();
 *   try { await repo.markSingleAsRead(id); }
 *   on AppException { ...; _notifications[index] = item; _unreadCount++; }
 *
 * The cached pages hold **raw API rows**, not parsed models — `usePaginatedList`
 * applies its `select` at render time — so the updaters patch `is_read` on the
 * raw row. `parseNotificationItem` reads `is_read` first, so the patch shows up
 * immediately and is overwritten by the server's own value on the next fetch.
 *
 * `qk.notifications()` is `['notifications', {}]`, which prefix-matches the
 * list query (`['notifications', {}, {}, 20]`) but **not**
 * `qk.notificationsUnreadCount` (`['notifications', 'unread-count']`), so the
 * count is updated separately and never clobbered by a page updater.
 */
import type { InfiniteData} from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { AppError } from '../../../core/api/AppError';
import { qk } from '../../../core/api/queryClient';
import type { Paginated } from '../../../core/api/types';
import { showError, showSuccess } from '../../../core/utils/toast';
import { clearAll, markAllRead, markRead } from '../api/notificationsApi';
import type { NotificationItem } from '../model/notificationItem';

/** The shape `usePaginatedList` stores under a notifications query key. */
type NotificationPages = InfiniteData<Paginated<unknown>, number>;

/** Every cached notifications-list query, for snapshot and restore. */
type Snapshot = [readonly unknown[], NotificationPages | undefined][];

function patchRows(
  pages: NotificationPages | undefined,
  patch: (row: Record<string, unknown>) => Record<string, unknown>,
): NotificationPages | undefined {
  if (!pages) return pages;
  return {
    ...pages,
    pages: pages.pages.map((page) => ({
      ...page,
      items: (page.items ?? []).map((row) =>
        row && typeof row === 'object' ? patch(row as Record<string, unknown>) : row,
      ),
    })),
  };
}

/**
 * `markSingleAsRead` — optimistic, with the Dart guard that a notification
 * already marked read performs no request at all.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, unknown, string, { snapshot: Snapshot; count?: number }>({
    mutationFn: markRead,

    onMutate: (id) => {
      const snapshot = queryClient.getQueriesData<NotificationPages>({
        queryKey: qk.notifications(),
      }) as Snapshot;
      const count = queryClient.getQueryData<number>(qk.notificationsUnreadCount);

      queryClient.setQueriesData<NotificationPages>(
        { queryKey: qk.notifications() },
        (pages) =>
          patchRows(pages, (row) => (row.id === id ? { ...row, is_read: true } : row)),
      );

      // Dart: `if (_unreadCount > 0) _unreadCount--;`
      queryClient.setQueryData<number>(qk.notificationsUnreadCount, (current) =>
        Math.max(0, (current ?? 0) - 1),
      );

      return { snapshot, count };
    },

    onError: (err, _id, context) => {
      context?.snapshot.forEach(([key, value]) => {
        queryClient.setQueryData(key, value);
      });
      if (context?.count !== undefined) {
        queryClient.setQueryData(qk.notificationsUnreadCount, context.count);
      }
      showError(
        `Failed to mark notification as read: ${AppError.from(err).message}`,
      );
    },
  });

  return {
    /** Skips the request when the item is already read, as the Dart code did. */
    markAsRead: (item: NotificationItem) => {
      if (item.isRead || !item.id) return;
      mutation.mutate(item.id);
    },
    isPending: mutation.isPending,
  };
}

/** `markAllAsRead` — optimistic across every cached page plus the badge. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, unknown, void, { snapshot: Snapshot; count?: number }>({
    mutationFn: markAllRead,

    onMutate: () => {
      const snapshot = queryClient.getQueriesData<NotificationPages>({
        queryKey: qk.notifications(),
      }) as Snapshot;
      const count = queryClient.getQueryData<number>(qk.notificationsUnreadCount);

      queryClient.setQueriesData<NotificationPages>(
        { queryKey: qk.notifications() },
        (pages) => patchRows(pages, (row) => ({ ...row, is_read: true })),
      );
      queryClient.setQueryData<number>(qk.notificationsUnreadCount, 0);

      return { snapshot, count };
    },

    onError: (err, _vars, context) => {
      context?.snapshot.forEach(([key, value]) => {
        queryClient.setQueryData(key, value);
      });
      if (context?.count !== undefined) {
        queryClient.setQueryData(qk.notificationsUnreadCount, context.count);
      }
      showError(`Failed to mark all as read: ${AppError.from(err).message}`);
    },
  });

  return { markAllAsRead: () => mutation.mutate(), isPending: mutation.isPending };
}

/**
 * `clearAllNotifications` — `DELETE /agent/notifications`.
 *
 * NOTE — this is destructive and irreversible server-side; the screen asks for
 * confirmation before calling it, which the Flutter screen did not.
 */
export function useClearAll() {
  const queryClient = useQueryClient();

  const mutation = useMutation<void, unknown, void>({
    mutationFn: clearAll,

    onSuccess: () => {
      queryClient.setQueryData<number>(qk.notificationsUnreadCount, 0);
      void queryClient.invalidateQueries({ queryKey: qk.notifications() });
      void queryClient.invalidateQueries({ queryKey: qk.notificationsUnreadCount });
      showSuccess('All notifications cleared');
    },

    onError: (err) => {
      showError(`Failed to clear notifications: ${AppError.from(err).message}`);
    },
  });

  return { clearAllNotifications: () => mutation.mutate(), isPending: mutation.isPending };
}
