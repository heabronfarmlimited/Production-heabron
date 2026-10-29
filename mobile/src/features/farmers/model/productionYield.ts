/**
 * Production / seasonal-yield models — ported from
 * modules/farmers/domain/dto/production_yield.dart and record_yields_req.dart
 *
 * `seasonal_productions` rows come back raw snake_case from
 * `productions.controller.js`, but the Dart DTO also read camelCase for every
 * key, so both are accepted here (`pick`). Writes are camelCase per
 * `validators/domain.js` `createProduction`.
 */
import {
  compact,
  int,
  nullableBool,
  nullableNum,
  nullableStr,
  obj,
  orUndefined,
  pick,
  str,
  strList,
} from './primitives';

/** The 33-field production record. */
export interface ProductionYield {
  id: string;
  farmerId: string;
  season: string;
  crop: string;
  cycleNumber: number;
  expectedPlantingDate: string | null;
  expectedHarvestDate: string | null;
  expectedYieldTonnes: number | null;
  actualYieldTonnes: number | null;
  benchmarkYieldTonnes: number | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  harvestDate: string | null;
  harvestPhotoUrls: string[];
  warehouseReceiptUrl: string | null;
  buyerReceiptUrl: string | null;
  agentSignatureUrl: string | null;
  verificationNotes: string | null;
  seedType: string | null;
  fertilizerUsed: string | null;
  herbicideUsed: boolean | null;
  postHarvestStorage: string | null;
  estimatedFarmIncome: number | null;
  verificationStatus: string | null;
  yieldRatio: number | null;
  yieldVerifiedByAgent: boolean | null;
  farmSizeAcres: number | null;
  verifiedByAgentId: string | null;
  verificationDate: string | null;
  yieldVarianceTonnes: number | null;
  yieldAchievementRate: number | null;
  /** The `farmers(id, full_name)` join. */
  farmer: ProductionFarmerRef | null;
}

/** Minimal farmer reference embedded on a production row. */
export interface ProductionFarmerRef {
  id: string | null;
  fullName: string | null;
}

export function parseProductionFarmerRef(raw: unknown): ProductionFarmerRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = obj(Array.isArray(raw) ? raw[0] : raw);
  return {
    id: nullableStr(f.id),
    fullName: nullableStr(pick(f, 'full_name', 'fullName')),
  };
}

export function parseProductionYield(raw: unknown): ProductionYield {
  const p = obj(raw);
  return {
    id: str(p.id),
    farmerId: str(pick(p, 'farmer_id', 'farmerId')),
    season: str(p.season),
    crop: str(p.crop),
    cycleNumber: int(pick(p, 'cycle_number', 'cycleNumber'), 1),
    expectedPlantingDate: nullableStr(
      pick(p, 'expected_planting_date', 'expectedPlantingDate'),
    ),
    expectedHarvestDate: nullableStr(
      pick(p, 'expected_harvest_date', 'expectedHarvestDate'),
    ),
    expectedYieldTonnes: nullableNum(
      pick(p, 'expected_yield_tonnes', 'expectedYieldTonnes'),
    ),
    actualYieldTonnes: nullableNum(pick(p, 'actual_yield_tonnes', 'actualYieldTonnes')),
    benchmarkYieldTonnes: nullableNum(
      pick(p, 'benchmark_yield_tonnes', 'benchmarkYieldTonnes'),
    ),
    notes: nullableStr(p.notes),
    createdAt: nullableStr(pick(p, 'created_at', 'createdAt')),
    updatedAt: nullableStr(pick(p, 'updated_at', 'updatedAt')),
    harvestDate: nullableStr(pick(p, 'harvest_date', 'harvestDate')),
    harvestPhotoUrls: strList(pick(p, 'harvest_photo_urls', 'harvestPhotoUrls')),
    warehouseReceiptUrl: nullableStr(
      pick(p, 'warehouse_receipt_url', 'warehouseReceiptUrl'),
    ),
    buyerReceiptUrl: nullableStr(pick(p, 'buyer_receipt_url', 'buyerReceiptUrl')),
    agentSignatureUrl: nullableStr(pick(p, 'agent_signature_url', 'agentSignatureUrl')),
    verificationNotes: nullableStr(pick(p, 'verification_notes', 'verificationNotes')),
    seedType: nullableStr(pick(p, 'seed_type', 'seedType')),
    fertilizerUsed: nullableStr(pick(p, 'fertilizer_used', 'fertilizerUsed')),
    herbicideUsed: nullableBool(pick(p, 'herbicide_used', 'herbicideUsed')),
    postHarvestStorage: nullableStr(
      pick(p, 'post_harvest_storage', 'postHarvestStorage'),
    ),
    estimatedFarmIncome: nullableNum(
      pick(p, 'estimated_farm_income', 'estimatedFarmIncome'),
    ),
    verificationStatus: nullableStr(pick(p, 'verification_status', 'verificationStatus')),
    yieldRatio: nullableNum(pick(p, 'yield_ratio', 'yieldRatio')),
    yieldVerifiedByAgent: nullableBool(
      pick(p, 'yield_verified_by_agent', 'yieldVerifiedByAgent'),
    ),
    farmSizeAcres: nullableNum(pick(p, 'farm_size_acres', 'farmSizeAcres')),
    verifiedByAgentId: nullableStr(pick(p, 'verified_by_agent_id', 'verifiedByAgentId')),
    verificationDate: nullableStr(pick(p, 'verification_date', 'verificationDate')),
    yieldVarianceTonnes: nullableNum(
      pick(p, 'yield_variance_tonnes', 'yieldVarianceTonnes'),
    ),
    yieldAchievementRate: nullableNum(
      pick(p, 'yield_achievement_rate', 'yieldAchievementRate'),
    ),
    farmer: parseProductionFarmerRef(p.farmers),
  };
}

/**
 * `GET /agent/farmers/:id/seasonal-yield` → `{ seasons, summary }`.
 * The endpoint existed in `api_constants.dart` but was never called.
 */
export interface SeasonalYieldSummary {
  totalSeasons: number;
  seasonsWithYield: number;
  verifiedSeasons: number;
  avgAchievementRate: number | null;
  latestSeason: ProductionYield | null;
}

export interface SeasonalYield {
  seasons: ProductionYield[];
  summary: SeasonalYieldSummary;
}

export function parseSeasonalYield(raw: unknown): SeasonalYield {
  const d = obj(raw);
  const s = obj(d.summary);
  return {
    seasons: Array.isArray(d.seasons) ? d.seasons.map(parseProductionYield) : [],
    summary: {
      totalSeasons: int(s.totalSeasons),
      seasonsWithYield: int(s.seasonsWithYield),
      verifiedSeasons: int(s.verifiedSeasons),
      avgAchievementRate: nullableNum(s.avgAchievementRate),
      latestSeason: s.latestSeason ? parseProductionYield(s.latestSeason) : null,
    },
  };
}

// ------------------------------------------------------------ request body
/** The input the Record Yield form produces once uploads have resolved. */
export interface ProductionFormInput {
  farmerId: string;
  season: string;
  crop: string;
  cycleNumber: number;
  expectedPlantingDate?: string;
  expectedHarvestDate?: string;
  expectedYieldTonnes?: number;
  actualYieldTonnes?: number;
  benchmarkYieldTonnes?: number;
  notes?: string;
  harvestDate?: string;
  harvestPhotoUrls?: string[];
  warehouseReceiptUrl?: string | null;
  buyerReceiptUrl?: string | null;
  agentSignatureUrl?: string | null;
  verificationNotes?: string;
  seedType?: string;
  fertilizerUsed?: string;
  herbicideUsed?: boolean;
  postHarvestStorage?: string;
  estimatedFarmIncome?: number;
}

/**
 * `POST /agent/productions` body — camelCase, optional keys omitted.
 * The same body serves `PATCH /agent/productions/:id` (`updateProduction`
 * forks every key to optional), which removes the ~110 duplicated lines
 * `RecordYieldsController.submit` / `.updateProduction` carried.
 */
export function toProductionBody(input: ProductionFormInput): Record<string, unknown> {
  return compact({
    farmerId: input.farmerId,
    season: input.season.trim(),
    crop: input.crop.trim(),
    cycleNumber: input.cycleNumber,
    expectedPlantingDate: input.expectedPlantingDate,
    expectedHarvestDate: input.expectedHarvestDate,
    expectedYieldTonnes: input.expectedYieldTonnes,
    actualYieldTonnes: input.actualYieldTonnes,
    benchmarkYieldTonnes: input.benchmarkYieldTonnes,
    notes: orUndefined(input.notes),
    harvestDate: input.harvestDate,
    harvestPhotoUrls:
      input.harvestPhotoUrls && input.harvestPhotoUrls.length > 0
        ? input.harvestPhotoUrls
        : undefined,
    warehouseReceiptUrl: orUndefined(input.warehouseReceiptUrl),
    buyerReceiptUrl: orUndefined(input.buyerReceiptUrl),
    agentSignatureUrl: orUndefined(input.agentSignatureUrl),
    verificationNotes: orUndefined(input.verificationNotes),
    seedType: orUndefined(input.seedType),
    fertilizerUsed: orUndefined(input.fertilizerUsed),
    herbicideUsed: input.herbicideUsed,
    postHarvestStorage: orUndefined(input.postHarvestStorage),
    estimatedFarmIncome: input.estimatedFarmIncome,
  });
}

/** `PATCH /agent/productions/:id` — identical body, all keys optional. */
export const toUpdateProductionBody = toProductionBody;

/** `cycleNumber` must be a positive integer: `integer().min(1).default(1)`. */
export const DEFAULT_CYCLE_NUMBER = 1;
