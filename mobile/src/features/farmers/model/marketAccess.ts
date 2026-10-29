/**
 * Market-access (offtake history) models — ported from
 * modules/farmers/domain/dto/market_access.dart
 *
 * Reads are snake_case `market_access_records` rows; writes are camelCase per
 * `validators/domain.js` `createMarketAccess`.
 */
import {
  compact,
  nullableBool,
  nullableInt,
  nullableNum,
  nullableStr,
  obj,
  orUndefined,
  pick,
  str,
} from './primitives';

export interface MarketAccess {
  id: string;
  farmerId: string;
  seasonYear: number | null;
  buyerName: string;
  pricePerTon: number | null;
  priceContext: string | null;
  isConfirmed: boolean | null;
  harvestWindow: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function parseMarketAccess(raw: unknown): MarketAccess {
  const m = obj(raw);
  return {
    id: str(m.id),
    farmerId: str(pick(m, 'farmer_id', 'farmerId')),
    seasonYear: nullableInt(pick(m, 'season_year', 'seasonYear')),
    buyerName: str(pick(m, 'buyer_name', 'buyerName')),
    pricePerTon: nullableNum(pick(m, 'price_per_ton', 'pricePerTon')),
    priceContext: nullableStr(pick(m, 'price_context', 'priceContext')),
    isConfirmed: nullableBool(pick(m, 'is_confirmed', 'isConfirmed')),
    harvestWindow: nullableStr(pick(m, 'harvest_window', 'harvestWindow')),
    notes: nullableStr(m.notes),
    createdAt: nullableStr(pick(m, 'created_at', 'createdAt')),
    updatedAt: nullableStr(pick(m, 'updated_at', 'updatedAt')),
  };
}

export interface MarketAccessFormInput {
  farmerId: string;
  seasonYear?: number;
  buyerName: string;
  pricePerTon?: number;
  priceContext?: string;
  isConfirmed: boolean;
  harvestWindow?: string;
  notes?: string;
}

/**
 * `POST /agent/market-access` body.
 *
 * FIXED — the Dart `MarketAccessReq.toJson` always emitted every key, so a
 * blank `harvestWindow` / `notes` sent `''`. Joi's `.max(120)` accepts `''`,
 * but it overwrote stored text on update; blanks are omitted here.
 */
export function toMarketAccessBody(
  input: MarketAccessFormInput,
): Record<string, unknown> {
  return compact({
    farmerId: input.farmerId,
    seasonYear: input.seasonYear,
    buyerName: input.buyerName.trim(),
    pricePerTon: input.pricePerTon,
    priceContext: input.priceContext,
    isConfirmed: input.isConfirmed,
    harvestWindow: orUndefined(input.harvestWindow),
    notes: orUndefined(input.notes),
  });
}

/**
 * `PATCH /agent/market-access/:recordId`.
 * `updateMarketAccess` forks only `farmerId` and `buyerName` to optional, so
 * `buyerName` is still required by the validator — the form enforces it too.
 */
export const toUpdateMarketAccessBody = toMarketAccessBody;
