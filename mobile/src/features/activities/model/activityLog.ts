/**
 * Activity log entry — the `RecentActivity` DTO from
 * modules/dashboard/domain/dto/dashboard_data.dart, which is what
 * `RecentActivityLogsView` rendered.
 *
 * Declared here, in the activities module, because this is the only screen
 * that consumes it; the dashboard module parses its own `DashboardData`.
 *
 * Keys are snake_case — `activity_logs` rows are returned verbatim by
 * backend/src/controllers/dashboard.controller.js:
 *   sb.from('activity_logs').select('*').eq('actor_id', userId)
 *     .order('created_at', { ascending: false }).limit(15)
 *
 * NOTE — there is **no** `/agent/activity-logs` route. `activity.controller.js`
 * is mounted only on `/admin/activity-logs`, so an agent's own log is
 * available solely as the `recentActivity` array inside the dashboard payload,
 * capped at 15 rows and unpaginated. That is why the screen has no infinite
 * scroll and filters client-side.
 */
import { nullableStr, obj, pick, str, type Raw } from './primitives';

export interface ActivityLog {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | null;
}

/** `RecentActivity.fromJson` */
export function parseActivityLog(raw: unknown): ActivityLog {
  const a: Raw = obj(raw);
  return {
    id: str(a.id),
    actorId: str(pick(a, 'actor_id', 'actorId')),
    // Dart declared actorRole/action/entityType/entityId non-nullable with
    // no fallback, so a null column threw. They default to '' here.
    actorRole: str(pick(a, 'actor_role', 'actorRole')),
    action: str(a.action),
    entityType: str(pick(a, 'entity_type', 'entityType')),
    entityId: str(pick(a, 'entity_id', 'entityId')),
    metadata:
      a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata)
        ? (a.metadata as Record<string, unknown>)
        : null,
    ipAddress: nullableStr(pick(a, 'ip_address', 'ipAddress')),
    userAgent: nullableStr(pick(a, 'user_agent', 'userAgent')),
    createdAt: nullableStr(pick(a, 'created_at', 'createdAt')),
  };
}

/**
 * `_filterLogs` — a case-insensitive contains over `action`, `ipAddress`,
 * `entityType` and `actorRole`, exactly the four fields the Dart screen
 * searched.
 */
export function filterActivityLogs(logs: ActivityLog[], search: string): ActivityLog[] {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return logs;

  return logs.filter(
    (log) =>
      log.action.toLowerCase().includes(term) ||
      (log.ipAddress?.toLowerCase().includes(term) ?? false) ||
      log.entityType.toLowerCase().includes(term) ||
      log.actorRole.toLowerCase().includes(term),
  );
}
