/**
 * Notification — ported from
 * modules/notifications/domain/dto/notification_item.dart
 *
 * The `is_read` key is dual: the Dart factory read
 * `json['is_read'] ?? json['isRead'] ?? false`. The backend writes `is_read`
 * (notifications.controller.js updates that column directly), but the
 * camelCase spelling is accepted too, and the optimistic read-marking in
 * `useMarkRead` writes `is_read` back into the cached row.
 *
 * `createdAt` is non-nullable in Dart — `DateTime.tryParse(...) ?? now` — so a
 * row with a missing or malformed timestamp sorts as "just now" rather than
 * disappearing from the Today/Earlier split. That is preserved: the parser
 * substitutes the current time, and the ISO string is kept as the field type
 * so the format helpers own the parsing.
 */

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  /** ISO string; never empty — falls back to now, as the Dart factory did. */
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
};

/** `NotificationItem.fromJson` */
export function parseNotificationItem(raw: unknown): NotificationItem {
  const n = (raw ?? {}) as Record<string, unknown>;

  const createdRaw = str(n.created_at ?? n.createdAt);
  const created = createdRaw ? new Date(createdRaw) : null;
  const createdAt =
    created && !Number.isNaN(created.getTime())
      ? created.toISOString()
      : new Date().toISOString();

  return {
    id: str(n.id),
    type: str(n.type),
    title: str(n.title),
    message: str(n.message),
    // Dual key, snake_case first — exactly the Dart `??` chain.
    isRead: bool(n.is_read) ?? bool(n.isRead) ?? false,
    createdAt,
    metadata:
      n.metadata && typeof n.metadata === 'object' && !Array.isArray(n.metadata)
        ? (n.metadata as Record<string, unknown>)
        : null,
  };
}

/**
 * The unread-count payload.
 *
 * `GET /agent/notifications/unread-count` answers `{ count: n }`, but the Dart
 * repository also accepted a bare integer and the `unread_count` /
 * `unreadCount` spellings. All four are tolerated so a backend rename cannot
 * silently zero the badge.
 */
export function parseUnreadCount(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : 0;

  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    for (const key of ['count', 'unread_count', 'unreadCount']) {
      const value = map[key];
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
  }

  return 0;
}

/** True when the notification was created on the device's current local day. */
export function isToday(item: NotificationItem, now: Date = new Date()): boolean {
  const d = new Date(item.createdAt);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
