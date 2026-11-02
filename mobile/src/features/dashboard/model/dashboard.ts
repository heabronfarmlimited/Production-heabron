/**
 * Dashboard models — ported from
 * modules/dashboard/domain/dto/dashboard_data.dart
 *
 * `GET /agent/dashboard` returns camelCase at the top level but the
 * `recentActivity` rows are raw Postgres rows in snake_case.
 */

export interface FinancingStats {
  pending: number;
  approved: number;
  rejected: number;
  disbursed: number;
  completed: number;
}

export interface RecentActivity {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: string | null;
}

export interface DashboardData {
  cooperatives: number;
  farmers: number;
  deliveries: number;
  financing: FinancingStats;
  recentActivity: RecentActivity[];
  /**
   * Land the agent has recorded, and the gaps in it (v2 home tiles).
   *
   * The two "without" figures are separate on purpose: a farmer with no farm
   * record needs onboarding finished, a farmer whose farms carry no acreage
   * needs a measurement. Both block credit scoring, and they are different
   * jobs. Null when talking to a server that predates them.
   */
  land: DashboardLand | null;
}

export interface DashboardLand {
  totalLandAcres: number;
  farmCount: number;
  farmersWithFarms: number;
  farmersWithoutFarms: number;
  farmersWithoutArea: number;
}

function parseDashboardLand(raw: unknown): DashboardLand | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  return {
    totalLandAcres: num(l.total_land_acres ?? l.totalLandAcres),
    farmCount: int(l.farm_count ?? l.farmCount),
    farmersWithFarms: int(l.farmers_with_farms ?? l.farmersWithFarms),
    farmersWithoutFarms: int(l.farmers_without_farms ?? l.farmersWithoutFarms),
    farmersWithoutArea: int(l.farmers_without_area ?? l.farmersWithoutArea),
  };
}

const int = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** Acreage keeps its decimals, unlike the counts `int` handles. */
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

export function parseFinancingStats(raw: unknown): FinancingStats {
  const f = (raw ?? {}) as Record<string, unknown>;
  return {
    pending: int(f.pending),
    approved: int(f.approved),
    rejected: int(f.rejected),
    disbursed: int(f.disbursed),
    completed: int(f.completed),
  };
}

export function parseRecentActivity(raw: unknown): RecentActivity {
  const a = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(a.id),
    actorId: str(a.actor_id ?? a.actorId),
    actorRole: str(a.actor_role ?? a.actorRole),
    action: str(a.action),
    entityType: str(a.entity_type ?? a.entityType),
    entityId: str(a.entity_id ?? a.entityId),
    metadata:
      a.metadata && typeof a.metadata === 'object'
        ? (a.metadata as Record<string, unknown>)
        : null,
    ipAddress: nullableStr(a.ip_address ?? a.ipAddress),
    userAgent: nullableStr(a.user_agent ?? a.userAgent),
    createdAt: nullableStr(a.created_at ?? a.createdAt),
  };
}

/**
 * The Dart repository unwrapped `data['data'] ?? data` because the controller
 * is sometimes handed the envelope and sometimes the payload. The shared
 * client already unwraps the envelope, but the defensive `.data` check is kept
 * in case the controller nests it.
 */
export function parseDashboard(raw: unknown): DashboardData {
  const outer = (raw ?? {}) as Record<string, unknown>;
  const d = (outer.data && typeof outer.data === 'object' ? outer.data : outer) as
    Record<string, unknown>;

  return {
    cooperatives: int(d.cooperatives),
    farmers: int(d.farmers),
    deliveries: int(d.deliveries),
    financing: parseFinancingStats(d.financing),
    recentActivity: Array.isArray(d.recentActivity)
      ? d.recentActivity.map(parseRecentActivity)
      : [],
    land: parseDashboardLand(d.land),
  };
}
