/**
 * Farmer models — ported from
 * modules/farmers/domain/dto/farmer.dart and add_farmer_req.dart
 *
 * The casing split documented in CONVENTIONS.md is resolved here, once:
 *
 *  - **Reads** arrive snake_case straight off the Postgres row, except the
 *    `farm` / `cooperative` / `creditScore` blocks that `utils/shapeFarmer.js`
 *    adds, which are camelCase. `parseFarm` therefore reads both spellings.
 *  - **Writes** are camelCase (`validators/domain.js` `createFarmer`).
 *
 * `shapeFarmer` emits the same farm data twice — once as the camelCase `farm`
 * object (the documented contract) and once as the raw `farm_profiles` join
 * array (kept for back-compat). `FarmerDetailsView` read `farm.*` then
 * `farmProfiles.first.*` at all 11 call sites. That two-level fallback lives in
 * `resolveFarm()` below and nowhere else.
 */
import {
  bool,
  compact,
  int,
  nullableBool,
  nullableInt,
  nullableNum,
  nullableStr,
  num,
  obj,
  orUndefined,
  pick,
  type Raw,
  str,
  strList,
} from './primitives';

/** One vertex of a mapped farm boundary — `{ lat, lng }` on the wire. */
export interface GpsPoint {
  lat: number;
  lng: number;
}

/** `FarmerCooperative` — the `cooperatives` / `cooperative` join. */
export interface FarmerCooperative {
  id: string | null;
  name: string | null;
  state: string | null;
  lga: string | null;
}

/**
 * The 14 farm fields, normalised. `FarmerFarm` (camelCase on the wire) and
 * `FarmerFarmProfile` (snake_case) carried these in two shapes; both parse
 * into this one interface.
 */
export interface FarmerFarm {
  farmSizeAcres: number | null;
  cropType: string | null;
  secondaryCrops: string[];
  soilType: string | null;
  irrigationAccess: boolean | null;
  waterSource: string | null;
  landOwnership: string | null;
  yearsExperience: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsPolygon: GpsPoint[];
  landDocumentUrl: string | null;
  landDocumentType: string | null;
  farmPhotoUrls: string[];
}

/**
 * A `farm_profiles` row — the farm fields plus the row's own metadata and the
 * three boundary-mapping columns the server computes (`gps_mapped`,
 * `computed_area_acres`, `plot_count`).
 */
export interface FarmerFarmProfile extends FarmerFarm {
  id: string | null;
  farmerId: string | null;
  plotCount: number | null;
  gpsMapped: boolean;
  computedAreaAcres: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** `FarmerCreditScore` — reads both camelCase and snake_case. */
export interface FarmerCreditScore {
  finalCreditScore: number | null;
  creditTier: string | null;
  productionScore: number | null;
  repaymentScore: number | null;
  isFirstCycle: boolean | null;
  hasActiveDefault: boolean | null;
  lastCalculatedAt: string | null;
}

/** NIN check outcome — `verified` | `mismatch` | `failed`, UI default `Pending`. */
export type NinStatus = 'verified' | 'mismatch' | 'failed' | 'pending' | string;

/** The 31-field farmer DTO. */
export interface Farmer {
  id: string;
  cooperativeId: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  altPhone: string | null;
  address: string | null;
  state: string | null;
  lga: string | null;
  householdSize: number | null;
  dependents: number | null;
  educationLevel: string | null;
  nin: string | null;
  bvn: string | null;
  ninVerificationStatus: NinStatus | null;
  ninVerificationPayload: Raw | null;
  idImageUrl: string | null;
  farmerPhotoUrl: string | null;
  verifiedAt: string | null;
  verifiedByAgentId: string | null;
  /** Flattened score — see `parseCreditScoreValue` for the polymorphism. */
  creditScore: number | null;
  creditTier: string | null;
  createdByAgentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** `cooperatives` join; `cooperative` (singular) is merged in by the parser. */
  cooperative: FarmerCooperative | null;
  /** `farm_profiles` join — snake_case rows. */
  farmProfiles: FarmerFarmProfile[];
  /** `credit_scores` join. */
  creditScores: FarmerCreditScore | null;
  /** `creditScore` object from `shapeFarmer` — same key as the number. */
  creditScoreObj: FarmerCreditScore | null;
  /** `farm` — the camelCase contract object. */
  farm: FarmerFarm | null;
}

// ----------------------------------------------------------------- parsing
/** Accepts `[{lat,lng}]`, or a JSON string of the same (legacy `gps_polygon`). */
export function parseGpsPolygon(raw: unknown): GpsPoint[] {
  let source = raw;

  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(source)) return [];

  // NOTE — the Dart `Cooperative.gpsPolygon` parser did
  // `(e['lat'] as num).toDouble()` with no null check, so one malformed point
  // threw and lost the whole record. Bad points are skipped instead.
  return source.reduce<GpsPoint[]>((points, entry) => {
    const point = obj(entry);
    const lat = nullableNum(pick(point, 'lat', 'latitude'));
    const lng = nullableNum(pick(point, 'lng', 'longitude'));
    if (lat != null && lng != null) points.push({ lat, lng });
    return points;
  }, []);
}

/** Reads the 14 farm fields from either casing. */
export function parseFarm(raw: unknown): FarmerFarm {
  const f = obj(raw);
  return {
    farmSizeAcres: nullableNum(pick(f, 'farm_size_acres', 'farmSizeAcres')),
    cropType: nullableStr(pick(f, 'crop_type', 'cropType')),
    secondaryCrops: strList(pick(f, 'secondary_crops', 'secondaryCrops')),
    soilType: nullableStr(pick(f, 'soil_type', 'soilType')),
    irrigationAccess: nullableBool(pick(f, 'irrigation_access', 'irrigationAccess')),
    waterSource: nullableStr(pick(f, 'water_source', 'waterSource')),
    landOwnership: nullableStr(pick(f, 'land_ownership', 'landOwnership')),
    yearsExperience: nullableInt(pick(f, 'years_experience', 'yearsExperience')),
    gpsLat: nullableNum(pick(f, 'gps_lat', 'gpsLat')),
    gpsLng: nullableNum(pick(f, 'gps_lng', 'gpsLng')),
    gpsPolygon: parseGpsPolygon(pick(f, 'gps_polygon', 'gpsPolygon')),
    landDocumentUrl: nullableStr(pick(f, 'land_document_url', 'landDocumentUrl')),
    landDocumentType: nullableStr(pick(f, 'land_document_type', 'landDocumentType')),
    farmPhotoUrls: strList(pick(f, 'farm_photo_urls', 'farmPhotoUrls')),
  };
}

export function parseFarmProfile(raw: unknown): FarmerFarmProfile {
  const f = obj(raw);
  return {
    ...parseFarm(f),
    id: nullableStr(f.id),
    farmerId: nullableStr(pick(f, 'farmer_id', 'farmerId')),
    plotCount: nullableInt(pick(f, 'plot_count', 'plotCount')),
    gpsMapped: bool(pick(f, 'gps_mapped', 'gpsMapped')),
    computedAreaAcres: nullableNum(pick(f, 'computed_area_acres', 'computedAreaAcres')),
    createdAt: nullableStr(pick(f, 'created_at', 'createdAt')),
    updatedAt: nullableStr(pick(f, 'updated_at', 'updatedAt')),
  };
}

export function parseFarmerCooperative(raw: unknown): FarmerCooperative | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = obj(raw);
  return {
    id: nullableStr(c.id),
    name: nullableStr(c.name),
    state: nullableStr(c.state),
    lga: nullableStr(c.lga),
  };
}

export function parseFarmerCreditScore(raw: unknown): FarmerCreditScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = obj(raw);
  return {
    finalCreditScore: nullableInt(
      pick(c, 'finalCreditScore', 'final_credit_score', 'credit_score'),
    ),
    creditTier: nullableStr(pick(c, 'creditTier', 'credit_tier')),
    productionScore: nullableInt(pick(c, 'productionScore', 'production_score')),
    repaymentScore: nullableInt(pick(c, 'repaymentScore', 'repayment_score')),
    isFirstCycle: nullableBool(pick(c, 'isFirstCycle', 'is_first_cycle')),
    hasActiveDefault: nullableBool(pick(c, 'hasActiveDefault', 'has_active_default')),
    lastCalculatedAt: nullableStr(pick(c, 'lastCalculatedAt', 'last_calculated_at')),
  };
}

/**
 * `credit_score` is polymorphic: a number on the list endpoint, an object on
 * the detail endpoint, and sometimes only present under `credit_scores`. The
 * Dart factory walked all three; so does this.
 */
function parseCreditScoreValue(f: Raw): number | null {
  const raw = pick(f, 'credit_score', 'creditScore');

  const direct = nullableInt(raw);
  if (direct != null) return direct;

  if (raw && typeof raw === 'object') {
    const nested = obj(raw);
    const value = nullableInt(
      pick(nested, 'finalCreditScore', 'final_credit_score', 'credit_score'),
    );
    if (value != null) return value;
  }

  const joined = obj(f.credit_scores);
  return nullableInt(
    pick(joined, 'final_credit_score', 'finalCreditScore', 'credit_score'),
  );
}

/** `credit_tier` is polymorphic in the same three ways. */
function parseCreditTierValue(f: Raw): string | null {
  const raw = pick(f, 'credit_tier', 'creditTier');

  if (typeof raw === 'string' && raw.length > 0) return raw;

  if (raw && typeof raw === 'object') {
    const nested = obj(raw);
    const tier = nullableStr(pick(nested, 'creditTier', 'credit_tier'));
    if (tier) return tier;
  }

  const joined = obj(f.credit_scores);
  return nullableStr(pick(joined, 'credit_tier', 'creditTier'));
}

export function parseFarmer(raw: unknown): Farmer {
  const f = obj(raw);

  // `credit_scores` can be the array form of a one-to-one join.
  const creditScoresRaw = Array.isArray(f.credit_scores)
    ? f.credit_scores[0]
    : f.credit_scores;

  // `cooperatives` is the join; `cooperative` is what shapeFarmer re-emits.
  const cooperativeRaw = Array.isArray(f.cooperatives)
    ? f.cooperatives[0]
    : (pick(f, 'cooperatives', 'cooperative') ?? null);

  const farmProfilesRaw = Array.isArray(f.farm_profiles)
    ? f.farm_profiles
    : f.farm_profiles
      ? [f.farm_profiles]
      : [];

  // `creditScore` carries a number on list responses and an object on detail
  // responses; only the object form becomes `creditScoreObj`.
  const creditScoreObjRaw =
    f.creditScore && typeof f.creditScore === 'object' ? f.creditScore : null;

  return {
    id: str(f.id),
    cooperativeId: nullableStr(pick(f, 'cooperative_id', 'cooperativeId')),
    fullName: nullableStr(pick(f, 'full_name', 'fullName')),
    dateOfBirth: nullableStr(pick(f, 'date_of_birth', 'dateOfBirth')),
    gender: nullableStr(f.gender),
    phone: nullableStr(f.phone),
    altPhone: nullableStr(pick(f, 'alt_phone', 'altPhone')),
    address: nullableStr(f.address),
    state: nullableStr(f.state),
    lga: nullableStr(f.lga),
    householdSize: nullableInt(pick(f, 'household_size', 'householdSize')),
    dependents: nullableInt(pick(f, 'dependents')),
    educationLevel: nullableStr(pick(f, 'education_level', 'educationLevel')),
    nin: nullableStr(f.nin),
    bvn: nullableStr(f.bvn),
    ninVerificationStatus: nullableStr(
      pick(f, 'nin_verification_status', 'ninVerificationStatus'),
    ),
    ninVerificationPayload: f.nin_verification_payload
      ? obj(f.nin_verification_payload)
      : null,
    idImageUrl: nullableStr(pick(f, 'id_image_url', 'idImageUrl')),
    farmerPhotoUrl: nullableStr(pick(f, 'farmer_photo_url', 'farmerPhotoUrl')),
    verifiedAt: nullableStr(pick(f, 'verified_at', 'verifiedAt')),
    verifiedByAgentId: nullableStr(pick(f, 'verified_by_agent_id', 'verifiedByAgentId')),
    creditScore: parseCreditScoreValue(f),
    creditTier: parseCreditTierValue(f),
    createdByAgentId: nullableStr(pick(f, 'created_by_agent_id', 'createdByAgentId')),
    createdAt: nullableStr(pick(f, 'created_at', 'createdAt')),
    updatedAt: nullableStr(pick(f, 'updated_at', 'updatedAt')),
    cooperative: parseFarmerCooperative(cooperativeRaw),
    farmProfiles: farmProfilesRaw.map(parseFarmProfile),
    creditScores: parseFarmerCreditScore(creditScoresRaw),
    creditScoreObj: parseFarmerCreditScore(creditScoreObjRaw),
    farm: f.farm ? parseFarm(f.farm) : null,
  };
}

// --------------------------------------------------------------- selectors
/**
 * The single resolution point for farm data.
 *
 * Prefers the documented `farm` object, falls back to the first
 * `farm_profiles` row, and returns null when neither is present. Every screen
 * and the PDF export go through this — the Dart code inlined the fallback
 * eleven times in `FarmerDetailsView` alone, and `FarmerScoreTile` /
 * `EditFarmerController` each used only *one* of the two sources, so they
 * showed blanks whenever the API returned the other shape.
 */
export function resolveFarm(farmer?: Farmer | null): FarmerFarm | null {
  if (!farmer) return null;
  return farmer.farm ?? farmer.farmProfiles[0] ?? null;
}

/** The `farm_profiles` row id, needed by nothing on the wire but handy in UI. */
export function resolveFarmProfileId(farmer?: Farmer | null): string | null {
  return farmer?.farmProfiles[0]?.id ?? null;
}

/** `[address, lga, state]` joined, else `'No address provided'`. */
export function resolveFullAddress(farmer?: Farmer | null): string {
  const parts = [farmer?.address, farmer?.lga, farmer?.state].filter(
    (part): part is string => Boolean(part && part.length > 0),
  );
  return parts.length === 0 ? 'No address provided' : parts.join(', ');
}

/** Primary crop + secondary crops, de-duplicated and blank-free. */
export function resolveCrops(farmer?: Farmer | null): string[] {
  const farm = resolveFarm(farmer);
  if (!farm) return [];
  const all = [farm.cropType ?? '', ...farm.secondaryCrops];
  return [...new Set(all)].filter((crop) => crop.trim().length > 0);
}

/**
 * The crop choices offered on the Record Yield screen: every crop recorded
 * against the farmer, plus `'others'`. Falls back to the five crops the Dart
 * controller hardcoded when the farmer has none on file.
 */
export const YIELD_CROP_FALLBACK = ['Cassava', 'Maize', 'Rice', 'Yam', 'Soybeans'];
export const OTHER_CROP_VALUE = 'others';

export function resolveYieldCrops(farmer?: Farmer | null): string[] {
  const farm = resolveFarm(farmer);
  const fromProfiles = farmer?.farmProfiles.flatMap((p) => [
    p.cropType ?? '',
    ...p.secondaryCrops,
  ]);

  const unique = [
    ...new Set([
      farm?.cropType ?? '',
      ...(farm?.secondaryCrops ?? []),
      ...(fromProfiles ?? []),
    ]),
  ].filter((crop) => crop.trim().length > 0);

  const crops = unique.length > 0 ? unique : [...YIELD_CROP_FALLBACK];
  if (!crops.includes(OTHER_CROP_VALUE)) crops.push(OTHER_CROP_VALUE);
  return crops;
}

// ------------------------------------------------------------ request bodies
/** The farm block of `createFarmer` / `updateFarmer` — all camelCase. */
export interface FarmProfileBody {
  farmSizeAcres?: number;
  cropType?: string;
  secondaryCrops?: string[];
  soilType?: string;
  irrigationAccess?: boolean;
  waterSource?: string;
  landOwnership?: string;
  yearsExperience?: number;
  gpsLat?: number;
  gpsLng?: number;
  landDocumentUrl?: string;
  landDocumentType?: string;
  farmPhotoUrls?: string[];
}

/** The input a farmer form produces once uploads have resolved to URLs. */
export interface FarmerFormInput {
  cooperativeId: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  altPhone?: string;
  address: string;
  state: string;
  lga: string;
  householdSize: number;
  dependents: number;
  educationLevel: string;
  nin: string;
  bvn: string;
  idImageUrl?: string | null;
  farmerPhotoUrl?: string | null;
  farm: FarmProfileBody;
}

/**
 * `POST /agent/farmers` body.
 *
 * FIXED — the Dart `FarmProfileReq.toJson` always emitted `farmSizeAcres`,
 * `soilType`, `waterSource`, `landOwnership`, `yearsExperience`, `gpsLat` and
 * `gpsLng`, defaulting each to `''` / `0` / `0.0`. On the edit screen those
 * fields were never prefilled, so saving wiped them server-side. Here every
 * optional value is omitted when absent (`compact`), and the edit form
 * prefills all of them so a real value is always sent.
 */
export function toFarmerBody(input: FarmerFormInput): Record<string, unknown> {
  return compact({
    cooperativeId: input.cooperativeId,
    fullName: input.fullName.trim(),
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    phone: input.phone.trim(),
    altPhone: orUndefined(input.altPhone),
    address: input.address.trim(),
    state: input.state,
    lga: input.lga,
    householdSize: input.householdSize,
    dependents: input.dependents,
    educationLevel: input.educationLevel.trim(),
    nin: input.nin.trim(),
    bvn: input.bvn.trim(),
    idImageUrl: orUndefined(input.idImageUrl),
    farmerPhotoUrl: orUndefined(input.farmerPhotoUrl),
    farm: toFarmProfileBody(input.farm),
  });
}

export function toFarmProfileBody(farm: FarmProfileBody): Record<string, unknown> {
  return compact({
    farmSizeAcres: farm.farmSizeAcres,
    cropType: farm.cropType,
    // The validator caps this at 7 — `.max(7)`.
    secondaryCrops: farm.secondaryCrops,
    soilType: farm.soilType,
    irrigationAccess: farm.irrigationAccess,
    waterSource: farm.waterSource,
    landOwnership: farm.landOwnership,
    yearsExperience: farm.yearsExperience,
    gpsLat: farm.gpsLat,
    gpsLng: farm.gpsLng,
    landDocumentUrl: farm.landDocumentUrl,
    landDocumentType: farm.landDocumentType,
    farmPhotoUrls: farm.farmPhotoUrls,
  });
}

/** `PATCH /agent/farmers/:id` — same shape, every key optional. */
export const toUpdateFarmerBody = toFarmerBody;

// ------------------------------------------------------- credit score & NIN
/** `GET /agent/farmers/:id/credit-score` → `{ current, history }`. */
export interface FarmerCreditScoreDetail {
  current: FarmerCreditScore | null;
  history: CreditScoreHistoryEntry[];
}

export interface CreditScoreHistoryEntry {
  id: string | null;
  finalCreditScore: number | null;
  creditTier: string | null;
  triggerReason: string | null;
  calculatedAt: string | null;
}

export function parseCreditScoreHistoryEntry(raw: unknown): CreditScoreHistoryEntry {
  const h = obj(raw);
  return {
    id: nullableStr(h.id),
    finalCreditScore: nullableInt(pick(h, 'final_credit_score', 'finalCreditScore')),
    creditTier: nullableStr(pick(h, 'credit_tier', 'creditTier')),
    triggerReason: nullableStr(pick(h, 'trigger_reason', 'triggerReason')),
    calculatedAt: nullableStr(pick(h, 'calculated_at', 'calculatedAt')),
  };
}

export function parseFarmerCreditScoreDetail(raw: unknown): FarmerCreditScoreDetail {
  const d = obj(raw);
  return {
    current: parseFarmerCreditScore(d.current),
    history: Array.isArray(d.history)
      ? d.history.map(parseCreditScoreHistoryEntry)
      : [],
  };
}

/** `POST /agent/farmers/:id/verify-nin` → `{ status, details }`. */
export interface NinVerificationResult {
  status: NinStatus;
  details: Raw | null;
}

export function parseNinVerificationResult(raw: unknown): NinVerificationResult {
  const d = obj(raw);
  return {
    // The Dart repo defaulted to `'failed'` when the key was missing.
    status: str(d.status, 'failed'),
    details: d.details ? obj(d.details) : null,
  };
}

/** `POST /agent/farmers/:id/map-farm` response. */
export interface MapFarmResult {
  farmerId: string;
  computedAreaAcres: number;
  computedAreaHectares: number;
  areaSqMeters: number;
  centroid: GpsPoint | null;
  farmSizeAcres: number;
  gpsMapped: boolean;
}

export function parseMapFarmResult(raw: unknown): MapFarmResult {
  const d = obj(raw);
  const centroid = obj(d.centroid);
  const lat = nullableNum(centroid.lat);
  const lng = nullableNum(centroid.lng);
  return {
    farmerId: str(d.farmerId),
    computedAreaAcres: num(d.computedAreaAcres),
    computedAreaHectares: num(d.computedAreaHectares),
    areaSqMeters: num(d.areaSqMeters),
    centroid: lat != null && lng != null ? { lat, lng } : null,
    farmSizeAcres: num(d.farmSizeAcres),
    gpsMapped: bool(d.gpsMapped),
  };
}

/** `POST /agent/imports` — the bulk CSV import summary. */
export interface BulkImportResult {
  farmersCreated: number;
  cooperativesCreated: number;
  rowsProcessed: number;
  errors: BulkImportRowError[];
}

export interface BulkImportRowError {
  line: number | null;
  message: string;
}

export function parseBulkImportResult(raw: unknown): BulkImportResult {
  const d = obj(raw);
  const errors = Array.isArray(d.errors)
    ? d.errors.map((entry) => {
        const e = obj(entry);
        return {
          line: nullableInt(pick(e, 'line', 'lineNo', 'row')),
          message: str(pick(e, 'message', 'error'), 'Row could not be imported'),
        };
      })
    : [];

  return {
    farmersCreated: int(pick(d, 'farmersCreated', 'created', 'farmers')),
    cooperativesCreated: int(pick(d, 'cooperativesCreated', 'cooperatives')),
    rowsProcessed: int(pick(d, 'rowsProcessed', 'rows', 'total')),
    errors,
  };
}
