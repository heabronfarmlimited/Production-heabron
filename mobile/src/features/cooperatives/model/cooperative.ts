/**
 * Cooperative models — ported from
 * modules/cooperatives/domain/dto/cooperative.dart and
 * modules/cooperatives/domain/dto/create_cooperative_req.dart
 *
 * Reads are snake_case, writes are camelCase. Unlike `Farmer`, the Dart
 * `Cooperative` was non-nullable with defaults, so the same defaults are
 * applied here and the interface stays free of optionals except where the
 * server genuinely omits a value (logo, GPS).
 *
 * Write bodies are validated by `createCooperative` / `updateCooperative` in
 * backend/src/validators/domain.js.
 */
import type { CooperativeForm } from './validation';

// ------------------------------------------------------------------ helpers
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const nullableNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((e) => e != null).map((e) => String(e)) : [];

// ------------------------------------------------------------- gps polygon
/** `GpsPolygon` — one vertex of a mapped boundary. */
export interface GpsPolygon {
  lat: number;
  lng: number;
}

/**
 * FIXED — the Dart parser did `(e['lat'] as num).toDouble()` with no null
 * check, so a single point missing `lat` or `lng` threw and took the whole
 * cooperative parse down with it. Malformed points are dropped instead.
 */
export function parseGpsPolygon(raw: unknown): GpsPolygon[] {
  if (!Array.isArray(raw)) return [];

  return raw.reduce<GpsPolygon[]>((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const point = entry as Record<string, unknown>;
    const lat = nullableNum(point.lat);
    const lng = nullableNum(point.lng);
    if (lat != null && lng != null) acc.push({ lat, lng });
    return acc;
  }, []);
}

export const serializeGpsPolygon = (
  points: readonly GpsPolygon[],
): Record<string, number>[] => points.map((p) => ({ lat: p.lat, lng: p.lng }));

// ----------------------------------------------------------------- stats
/**
 * NOTE — not on the Dart DTO. `GET /agent/cooperatives/:id` returns a `stats`
 * block (see cooperatives.controller.js `getById`), which is the only *live*
 * farmer/delivery/financing count available to the client. The Flutter detail
 * screen instead showed `total_members`, a denormalised column that is never
 * updated after `create` seeds it to 0 — which is why every cooperative
 * reported "0 Farmers". The detail screen prefers `stats.farmers` and falls
 * back to `totalMembers`.
 */
export interface CooperativeStats {
  farmers: number;
  deliveries: number;
  financingRequests: number;
}

function parseStats(raw: unknown): CooperativeStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  return {
    farmers: num(s.farmers),
    deliveries: num(s.deliveries),
    financingRequests: num(s.financingRequests),
  };
}

// ----------------------------------------------------------- cooperative
export interface Cooperative {
  id: string;
  name: string;
  registrationNumber: string;
  leaderName: string;
  leaderPhone: string;
  cropsSupported: string[];
  state: string;
  lga: string;
  address: string;
  /**
   * FIXED — the Dart DTO coerced this with `.toInt()`, so a cooperative stored
   * with 4.5 acres read back as 4. The validator is `Joi.number().min(0)`.
   */
  estimatedLandSize: number;
  cooperativeTier: string;
  averageCreditScore: number;
  totalMembers: number;
  createdByAgentId: string;
  createdAt: string | null;
  updatedAt: string | null;
  logoUrl: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsPolygon: GpsPolygon[];
  /** Live counts from `GET /agent/cooperatives/:id` only — null in lists. */
  stats: CooperativeStats | null;
}

/** Dart default when `cooperative_tier` is absent. */
export const DEFAULT_COOPERATIVE_TIER = 'c';

/** `Cooperative.fromJson` — snake_case, every key defaulted. */
export function parseCooperative(raw: unknown): Cooperative {
  const c = (raw ?? {}) as Record<string, unknown>;

  return {
    id: str(c.id),
    name: str(c.name),
    registrationNumber: str(c.registration_number),
    leaderName: str(c.leader_name),
    leaderPhone: str(c.leader_phone),
    cropsSupported: strList(c.crops_supported),
    state: str(c.state),
    lga: str(c.lga),
    address: str(c.address),
    estimatedLandSize: num(c.estimated_land_size),
    cooperativeTier: str(c.cooperative_tier, DEFAULT_COOPERATIVE_TIER),
    averageCreditScore: num(c.average_credit_score),
    totalMembers: num(c.total_members),
    createdByAgentId: str(c.created_by_agent_id),
    createdAt: nullableStr(c.created_at),
    updatedAt: nullableStr(c.updated_at),
    logoUrl: nullableStr(c.logo_url),
    gpsLat: nullableNum(c.gps_lat),
    gpsLng: nullableNum(c.gps_lng),
    gpsPolygon: parseGpsPolygon(c.gps_polygon),
    stats: parseStats(c.stats),
  };
}

/** The farmer count to show on the detail screen — live value preferred. */
export const cooperativeFarmerCount = (c: Cooperative): number =>
  c.stats?.farmers ?? c.totalMembers;

/** `'Lga, State'`, the subtitle used by the list item and the detail header. */
export function cooperativeLocation(c: Cooperative): string {
  const parts = [c.lga, c.state].filter((p) => p.trim().length > 0);
  return parts.join(', ');
}

// ----------------------------------------------------------- write bodies
/**
 * `CreateCooperativeReq.toJson` — camelCase, used for both POST and PATCH
 * (`updateCooperative` is `createCooperative.fork(... optional)`).
 *
 * Differences from the Dart original, all deliberate:
 *
 *  - FIXED: `estimatedLandSize` was parsed with `int.tryParse`, so the decimal
 *    the form happily accepted ("4.5") became `null` and then `0`. It is sent
 *    as a float.
 *  - FIXED: `leaderName` / `leaderPhone` fell back to the hardcoded strings
 *    `'Dev innov8'` / `'08067543299'`. Both are `.optional()` in the validator,
 *    so an unknown leader is simply omitted rather than invented.
 *  - `gpsPolygon` is omitted when empty. The Dart version always sent `[]`
 *    (no UI ever populated it), which overwrote a boundary mapped elsewhere
 *    on every edit.
 */
export function toCooperativeBody(
  form: CooperativeForm,
  leader: { name?: string | null; phone?: string | null } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    registrationNumber: form.registrationNumber.trim(),
    cropsSupported: form.cropsSupported,
    state: form.state,
    lga: form.lga,
    address: form.address.trim(),
    estimatedLandSize: Number(form.estimatedLandSize),
  };

  const leaderName = leader.name?.trim();
  if (leaderName) body.leaderName = leaderName;

  const leaderPhone = leader.phone?.trim();
  if (leaderPhone) body.leaderPhone = leaderPhone;

  if (form.logoUrl) body.logoUrl = form.logoUrl;

  const lat = Number(form.gpsLat);
  const lng = Number(form.gpsLng);
  if (Number.isFinite(lat)) body.gpsLat = lat;
  if (Number.isFinite(lng)) body.gpsLng = lng;

  if (form.gpsPolygon && form.gpsPolygon.length > 0) {
    body.gpsPolygon = serializeGpsPolygon(form.gpsPolygon);
  }

  return body;
}

/**
 * Prefill values for `EditCooperativeScreen`.
 *
 * FIXED — the Dart controller wrote `cooperative.gpsLat.toString()` on a
 * nullable double, putting the literal string `'null'` into the Latitude and
 * Longitude inputs whenever GPS was absent; `double.tryParse('null')` then
 * returned null and the fields silently failed validation. It also left
 * state and LGA blank with a comment admitting it could not prefill them, so
 * every edit forced the agent to re-pick both.
 */
export function cooperativeToForm(c: Cooperative): CooperativeForm {
  return {
    name: c.name,
    registrationNumber: c.registrationNumber,
    state: c.state,
    lga: c.lga,
    address: c.address,
    cropsSupported: [...c.cropsSupported],
    estimatedLandSize: c.estimatedLandSize > 0 ? String(c.estimatedLandSize) : '',
    gpsLat: c.gpsLat != null ? String(c.gpsLat) : '',
    gpsLng: c.gpsLng != null ? String(c.gpsLng) : '',
    logoUrl: c.logoUrl ?? '',
    gpsPolygon: [...c.gpsPolygon],
  };
}

/** Blank values for `CreateCooperativeScreen`. */
export const emptyCooperativeForm = (): CooperativeForm => ({
  name: '',
  registrationNumber: '',
  state: '',
  lga: '',
  address: '',
  cropsSupported: [],
  estimatedLandSize: '',
  gpsLat: '',
  gpsLng: '',
  logoUrl: '',
  gpsPolygon: [],
});
