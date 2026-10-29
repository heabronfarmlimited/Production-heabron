/**
 * Response envelope — ported from
 * lib/src/core/utils/base/dto/server_response.dart
 *
 * Every backend response is wrapped in this shape, so the client unwraps it
 * once (in client.ts) and feature code deals in plain payloads.
 */

/** `typedef JSON = Map<String, dynamic>` */
export type Json = Record<string, unknown>;

/** A single field-level validation error — `ResponseErrorDetail`. */
export interface ResponseErrorDetail {
  field: string;
  message: string;
}

/** Structured error object — `ResponseError`. */
export interface ResponseError {
  code: string;
  message: string;
  details: ResponseErrorDetail[];
}

/** Pagination metadata — `ResponseMeta`. */
export interface ResponseMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** `ServerResponse` */
export interface ServerResponse<T = unknown> {
  success?: boolean;
  data?: T | null;
  meta?: ResponseMeta;
  error?: ResponseError;
}

/** `ResponseMeta.hasNextPage` => `page < totalPages` */
export const hasNextPage = (meta?: ResponseMeta): boolean =>
  meta ? meta.page < meta.totalPages : false;

/** Defaults mirror the `?? ` fallbacks in `ResponseMeta.fromJson`. */
export function parseMeta(raw: unknown): ResponseMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  return {
    page: toInt(m.page, 1),
    pageSize: toInt(m.pageSize, 20),
    total: toInt(m.total, 0),
    totalPages: toInt(m.totalPages, 0),
  };
}

export function parseError(raw: unknown): ResponseError | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  return {
    code: typeof e.code === 'string' ? e.code : '',
    message: typeof e.message === 'string' ? e.message : '',
    details: Array.isArray(e.details)
      ? e.details.map((d) => {
          const detail = (d ?? {}) as Record<string, unknown>;
          return {
            field: typeof detail.field === 'string' ? detail.field : '',
            message: typeof detail.message === 'string' ? detail.message : '',
          };
        })
      : [],
  };
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * A page of results plus its metadata — the shape list endpoints resolve to
 * once the envelope is unwrapped.
 */
export interface Paginated<T> {
  items: T[];
  meta?: ResponseMeta;
}

/** Query params accepted by every `validate(v.listQuery, 'query')` route. */
export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  [key: string]: unknown;
}
