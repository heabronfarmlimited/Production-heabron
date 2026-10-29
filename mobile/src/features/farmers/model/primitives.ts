/**
 * Small parse helpers shared by every model in this module.
 *
 * These stand in for the `as String?` / `(json['x'] as num?)?.toInt()` casts
 * the Dart `fromJson` factories used, but without throwing on an unexpected
 * type — a single bad field in one row would otherwise take down a whole list
 * (which is exactly what `Cooperative.gpsPolygon` did in the Flutter app).
 *
 * Kept deliberately tiny per CONVENTIONS.md: no validation framework.
 */

/** A JSON object with unknown value types. */
export type Raw = Record<string, unknown>;

/** Coerces any value to a plain object so property reads are always safe. */
export const obj = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Raw)
    : {};

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** `as String?` — anything that is not a string becomes null. */
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

export const num = (value: unknown, fallback = 0): number =>
  nullableNum(value) ?? fallback;

/** `(json['x'] as num?)?.toInt()` */
export const nullableInt = (value: unknown): number | null => {
  const n = nullableNum(value);
  return n == null ? null : Math.trunc(n);
};

export const int = (value: unknown, fallback = 0): number =>
  nullableInt(value) ?? fallback;

export const nullableBool = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
};

export const bool = (value: unknown, fallback = false): boolean =>
  nullableBool(value) ?? fallback;

/** `(json['x'] as List?)?.map((e) => e.toString()).toList()` */
export const strList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e): e is string | number => typeof e === 'string' || typeof e === 'number')
    .map((e) => String(e))
    .filter((e) => e.length > 0);
};

/** Reads the first key that carries a non-null value — snake_case first. */
export const pick = (source: Raw, ...keys: string[]): unknown => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

/**
 * Drops `undefined` entries from a request body.
 *
 * FIXED — the Dart request DTOs declared most fields non-nullable and
 * defaulted them to `''` / `0` / `0.0`, so `EditFarmerController.submit`
 * overwrote server-side values with empty ones. Here an untouched field is
 * `undefined` and never reaches the wire; `null` is still sent when a value
 * is deliberately cleared.
 */
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

/** Parses an integer text input; blank or malformed input is omitted. */
export const intOrUndefined = (value?: string | null): number | undefined => {
  const n = numOrUndefined(value);
  return n == null ? undefined : Math.trunc(n);
};

/** `yyyy-MM-dd` — the format every date field in this module sends. */
export function toDateOnly(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Parses an ISO / `yyyy-MM-dd` string back into a Date for the pickers. */
export function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
