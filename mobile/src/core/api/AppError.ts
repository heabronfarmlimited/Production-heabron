/**
 * Error type — ported from lib/src/core/utils/exception/app_exception.dart
 *
 * The Dart original collapses every failure into an `AppException` carrying a
 * single display string. This port keeps that message (so UI code reads the
 * same) but also retains the structured `code`, field `details` and HTTP
 * status, which the Dart version discarded — those are needed to map
 * validation errors back onto form fields.
 */
import type { AxiosError } from 'axios';
import axios from 'axios';

import type { ResponseError, ResponseErrorDetail } from './types';
import { parseError } from './types';

export class AppError extends Error {
  /** Machine-readable code from `ResponseError.code`, when present. */
  readonly code: string;
  /** Field-level validation errors from `ResponseError.details`. */
  readonly details: ResponseErrorDetail[];
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** True when the request never reached the server (offline, DNS, timeout). */
  readonly isNetworkError: boolean;

  constructor(
    message: string,
    options: {
      code?: string;
      details?: ResponseErrorDetail[];
      status?: number;
      isNetworkError?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = options.code ?? '';
    this.details = options.details ?? [];
    this.status = options.status;
    this.isNetworkError = options.isNetworkError ?? false;
  }

  /** Maps `details` to `{ [field]: message }` for form libraries. */
  get fieldErrors(): Record<string, string> {
    return this.details.reduce<Record<string, string>>((acc, d) => {
      if (d.field) acc[d.field] = d.message;
      return acc;
    }, {});
  }

  /**
   * `AppException.handleError` — turns a transport error into a display
   * message, preferring the server's own `error.message`.
   */
  static from(err: unknown): AppError {
    if (err instanceof AppError) return err;

    if (axios.isAxiosError(err)) {
      return AppError.fromAxios(err);
    }

    if (err instanceof Error) {
      return new AppError(err.message || FALLBACK_MESSAGE);
    }

    return new AppError(FALLBACK_MESSAGE);
  }

  private static fromAxios(err: AxiosError): AppError {
    const status = err.response?.status;
    const body = err.response?.data;

    // Server replied with the standard envelope -> use its error object.
    if (body && typeof body === 'object') {
      const parsed: ResponseError | undefined = parseError(
        (body as Record<string, unknown>).error,
      );

      if (parsed?.message) {
        return new AppError(parsed.message, {
          code: parsed.code,
          details: parsed.details,
          status,
        });
      }

      // Envelope present but no `error` key — Dart returned this exact string.
      if (err.response) {
        return new AppError('Something went wrong.', { status });
      }
    }

    // Non-envelope response body.
    if (err.response) {
      return new AppError('Something went wrong, please try again', { status });
    }

    // No response at all — map the transport failure, as `handleExceptionError`
    // did for each DioExceptionType.
    return new AppError(messageForTransport(err), {
      status,
      isNetworkError: true,
    });
  }
}

const FALLBACK_MESSAGE = 'Oops! Something went wrong, please try again later.';

/**
 * Port of `handleExceptionError(DioExceptionType)`. Axios does not distinguish
 * connect/send/receive timeouts, so all three collapse to the connection
 * message, which is what a user needs to see anyway.
 */
function messageForTransport(err: AxiosError): string {
  switch (err.code) {
    case 'ECONNABORTED':
    case 'ETIMEDOUT':
      return 'Please check your internet connection.';
    case 'ERR_NETWORK':
      return 'Please check your internet connection.';
    case 'ERR_CANCELED':
      return ' please try again';
    case 'ERR_BAD_RESPONSE':
      return 'Error please try again';
    case 'ERR_BAD_REQUEST':
      return 'Error please try again';
    default:
      return FALLBACK_MESSAGE;
  }
}
