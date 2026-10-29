/**
 * HTTP client — replaces `api_service.dart` + `interceptor/network_interceptor.dart`.
 *
 * Behaviour ported from the Dart original:
 *  - base URL, 30s timeout, JSON response type
 *  - bearer token attached per request (`ApiMixin.headers`)
 *  - on 401: refresh once, then retry the original request
 *  - a single in-flight refresh shared by all waiting requests
 *    (`static Future<void>? _refreshFuture` in NetworkInterceptor)
 *  - refresh failure -> wipe storage and hand control to the session handler
 *  - a 401 on the refresh endpoint itself is never retried
 *
 * Two deliberate improvements over the Dart version:
 *  1. Requests that arrive *during* a refresh now queue and replay instead of
 *     each firing their own refresh. The Dart code set `_refreshFuture` but
 *     then cleared it to `null` immediately after the first `await`, so
 *     concurrent 401s could still trigger parallel refreshes.
 *  2. A request is retried only once, tracked per-request, so a persistently
 *     401-ing endpoint cannot loop.
 */
import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import axios from 'axios';

import { BASE_URL, TIMEOUTS } from '../config/env';
import { authStorage } from '../storage/authStorage';

import { AppError } from './AppError';
import { endpoints } from './endpoints';
import type { Paginated, ServerResponse } from './types';
import { parseError, parseMeta } from './types';

/** Marks a config that has already been through one refresh+retry cycle. */
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * Called when the session cannot be recovered. The navigation layer registers
 * a handler at startup; this indirection replaces the Dart interceptor's
 * direct `$navigationService.clearAllTo(LoginView.route)` call, which coupled
 * the network layer to the route table.
 */
type SessionExpiredHandler = () => void;

let onSessionExpired: SessionExpiredHandler = () => {};

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUTS.receive,
  responseType: 'json',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ----------------------------------------------------------------- request
http.interceptors.request.use((config) => {
  const token = authStorage.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ------------------------------------------------------- refresh plumbing
let refreshPromise: Promise<string> | null = null;

/**
 * Performs the token refresh on a bare axios instance so it cannot recurse
 * through this interceptor. Returns the new access token.
 */
async function performRefresh(): Promise<string> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) throw new AppError('Session expired. Please log in again.');

  const res = await axios.post<ServerResponse<Record<string, unknown>>>(
    `${BASE_URL}${endpoints.refreshToken}`,
    { refreshToken },
    {
      timeout: TIMEOUTS.receive,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    },
  );

  const data = res.data?.data ?? {};
  const accessToken = data.accessToken as string | undefined;
  const newRefresh = data.refreshToken as string | undefined;

  if (!accessToken) throw new AppError('Session expired. Please log in again.');

  authStorage.setTokens({ accessToken, refreshToken: newRefresh ?? refreshToken });
  return accessToken;
}

/** Collapses concurrent refreshes into one shared promise. */
function refreshOnce(): Promise<string> {
  refreshPromise ??= performRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// ---------------------------------------------------------------- response
http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status !== 401 || !config) {
      return Promise.reject(AppError.from(error));
    }

    // A 401 from the refresh endpoint is terminal — never retry it.
    if (config.url?.includes(endpoints.refreshToken)) {
      authStorage.clearSession();
      onSessionExpired();
      return Promise.reject(AppError.from(error));
    }

    // Already retried once, or nothing to refresh with.
    if (config._retried || !authStorage.getRefreshToken()) {
      if (!authStorage.getRefreshToken()) {
        authStorage.clearSession();
        onSessionExpired();
      }
      return Promise.reject(AppError.from(error));
    }

    try {
      const token = await refreshOnce();
      config._retried = true;
      config.headers.Authorization = `Bearer ${token}`;
      return http.request(config);
    } catch (refreshError) {
      authStorage.clearSession();
      onSessionExpired();
      return Promise.reject(AppError.from(refreshError));
    }
  },
);

// ------------------------------------------------------------ unwrapping
/**
 * Unwraps the `ServerResponse` envelope.
 *
 * The backend returns HTTP 200 with `success: false` in some paths, so a
 * successful transport does not imply a successful operation — this throws an
 * AppError in that case, which is what the Dart repositories did by checking
 * `isSuccess` before reading `data`.
 */
function unwrap<T>(response: AxiosResponse<ServerResponse<T>>): T {
  const body = response.data;

  if (body && body.success === false) {
    const err = parseError(body.error);
    throw new AppError(err?.message || 'Something went wrong.', {
      code: err?.code,
      details: err?.details,
      status: response.status,
    });
  }

  return (body?.data ?? null) as T;
}

/** Unwraps a list response, keeping the pagination metadata. */
function unwrapPaginated<T>(
  response: AxiosResponse<ServerResponse<T[]>>,
): Paginated<T> {
  const items = unwrap<T[]>(response) ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    meta: parseMeta(response.data?.meta),
  };
}

/**
 * Request helpers. These are the equivalents of `ApiService.get/post/...`,
 * except they resolve to the unwrapped payload rather than a ServerResponse,
 * and they throw `AppError` on failure.
 */
export const api = {
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return unwrap<T>(await http.get<ServerResponse<T>>(url, config));
  },

  /** For `GET` list endpoints — returns items plus `meta`. */
  async getPaginated<T>(
    url: string,
    params?: Record<string, unknown>,
    config?: AxiosRequestConfig,
  ): Promise<Paginated<T>> {
    return unwrapPaginated<T>(
      await http.get<ServerResponse<T[]>>(url, { ...config, params }),
    );
  },

  async post<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return unwrap<T>(await http.post<ServerResponse<T>>(url, body, config));
  },

  async patch<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return unwrap<T>(await http.patch<ServerResponse<T>>(url, body, config));
  },

  async put<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return unwrap<T>(await http.put<ServerResponse<T>>(url, body, config));
  },

  async delete<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return unwrap<T>(await http.delete<ServerResponse<T>>(url, config));
  },
} as const;
