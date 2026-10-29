/**
 * Small parse helpers shared by every model in this module.
 *
 * These stand in for the `as String?` / `(json['x'] as num?)?.toInt()` casts
 * the Dart `fromJson` factories used, without throwing on an unexpected type —
 * one bad field in one row would otherwise take down a whole list.
 *
 * NOTE — `features/farmers/model/primitives.ts` declares the same helpers.
 * They are duplicated rather than shared because cross-feature imports are
 * not allowed and `core/` is owned elsewhere; the right home is
 * `core/utils/parse.ts`. See the build report.
 */

/** A JSON object with unknown value types. */
export type Raw = Record<string, unknown>;

/** Coerces any value to a plain object so property reads are always safe. */
export const obj = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** `as String?` — anything that is not a non-empty string becomes null. */
export const nullableStr = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * `(json['x'] as num?)?.toDouble()`. Numeric strings are accepted because
 * Postgres `numeric` columns arrive as strings through PostgREST.
 */
export const nullableNum = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** `(json['x'] as num?)?.toInt()` */
export const nullableInt = (value: unknown): number | null => {
  const n = nullableNum(value);
  return n == null ? null : Math.trunc(n);
};

/** `(json['x'] as List?)?.map((e) => e.toString()).toList()` */
export const strList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e): e is string | number => typeof e === 'string' || typeof e === 'number')
    .map((e) => String(e))
    .filter((e) => e.length > 0);
};

/**
 * Reads the first key carrying a non-null value — snake_case first, matching
 * the `json['snake'] ?? json['camel']` chains in `AgentRepayment.fromJson`.
 */
export const pick = (source: Raw, ...keys: string[]): unknown => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

/** Drops `undefined` entries from a request body so nothing is overwritten. */
export function compact(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(body).forEach(([key, value]) => {
    if (value !== undefined) out[key] = value;
  });
  return out;
}

/** `''` is treated as "not provided" for optional string request fields. */
export const orUndefined = (value?: string | null): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Parses a decimal text input; blank or malformed input is omitted. */
export const numOrUndefined = (value?: string | null): number | undefined => {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
};
