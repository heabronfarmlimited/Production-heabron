/**
 * Notifications API — ported from
 * modules/notifications/data/repository/notifications_remote_repository_impl.dart
 *
 * Routes, from backend/src/routes/agent.routes.js:
 *   GET    /agent/notifications                   list (validate listQuery)
 *   GET    /agent/notifications/unread-count      -> { count }
 *   PATCH  /agent/notifications/:id/read
 *   PATCH  /agent/notifications/read-all
 *   DELETE /agent/notifications                   clears every row for the user
 *
 * The list itself is fetched by `usePaginatedList`; only the one-shot calls
 * live here.
 *
 * NOTE — the controller supports `?unread=true`, but the route validates the
 * query against `listQuery`, which is declared `.options({ stripUnknown: true })`
 * and does not list `unread`. The flag is therefore stripped before the
 * controller sees it and unread-only filtering is impossible from the client.
 * No screen needs it, so nothing here sends it; flagged in the build report as
 * a backend fix.
 */
import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import { parseNotificationItem, parseUnreadCount } from '../model/notificationItem';

/** `GET /agent/notifications/unread-count` */
export async function getUnreadCount(): Promise<number> {
  return parseUnreadCount(await api.get<unknown>(endpoints.notificationsUnreadCount));
}

/** `PATCH /agent/notifications/:id/read` */
export async function markRead(id: string): Promise<void> {
  await api.patch<unknown>(endpoints.notificationRead(id));
}

/** `PATCH /agent/notifications/read-all` */
export async function markAllRead(): Promise<void> {
  await api.patch<unknown>(endpoints.notificationsReadAll);
}

/** `DELETE /agent/notifications` — deletes every notification for the user. */
export async function clearAll(): Promise<void> {
  await api.delete<unknown>(endpoints.notifications);
}

/** The url + row parser `usePaginatedList` needs for the list. */
export const notificationsList = {
  url: endpoints.notifications,
  parse: parseNotificationItem,
} as const;
