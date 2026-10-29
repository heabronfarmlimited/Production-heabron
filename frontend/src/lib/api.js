import axios from 'axios';
import toast from 'react-hot-toast';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
});

// Inject the access token if present
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('coopscore.accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshInflight = null;

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    // FIXED — `err.config` is undefined for errors raised before/outside a
    // request (bad baseURL, interceptor throw, cancellation). Reading
    // `original._retry` on it threw a TypeError inside the interceptor, which
    // replaced the real failure with "Cannot read properties of undefined".
    const original = err.config;
    if (err.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('coopscore.refreshToken');
      if (!refresh) {
        clearTokens();
        if (!isAuthRoute()) window.location.href = '/login';
        return Promise.reject(err);
      }
      try {
        refreshInflight = refreshInflight || axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: refresh });
        const { data } = await refreshInflight;
        refreshInflight = null;
        const newTokens = data?.data;
        if (!newTokens?.accessToken) throw new Error('Refresh returned no token');
        localStorage.setItem('coopscore.accessToken', newTokens.accessToken);
        localStorage.setItem('coopscore.refreshToken', newTokens.refreshToken);
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newTokens.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        refreshInflight = null;
        clearTokens();
        if (!isAuthRoute()) window.location.href = '/login';
        return Promise.reject(refreshErr);
      }
    }
    // Surface API errors as toasts unless the caller opted out
    if (!original?.silentError) {
      const msg = err.response?.data?.error?.message || err.message || 'Something went wrong';
      toast.error(msg);
    }
    return Promise.reject(err);
  }
);

export function setTokens({ accessToken, refreshToken }) {
  localStorage.setItem('coopscore.accessToken', accessToken);
  localStorage.setItem('coopscore.refreshToken', refreshToken);
}

export function clearTokens() {
  localStorage.removeItem('coopscore.accessToken');
  localStorage.removeItem('coopscore.refreshToken');
}

function isAuthRoute() {
  return window.location.pathname.startsWith('/login') ||
         window.location.pathname.startsWith('/forgot') ||
         window.location.pathname.startsWith('/change-password');
}

/**
 * An API failure reported inside a 2xx envelope (`{ success: false, error }`).
 * Carries the backend's `error.code`, `error.message` and the per-field
 * `error.details[]` array so forms can map messages onto inputs.
 */
export class ApiError extends Error {
  constructor({ code, message, details, status } = {}) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.details = Array.isArray(details) ? details : [];
    this.status = status ?? 200;
    // Mirror the axios error shape so existing `e.response?.data?.error`
    // readers keep working unchanged.
    this.response = { status: this.status, data: { success: false, error: { code: this.code, message: this.message, details: this.details } } };
  }

  /** First validation message for a field, e.g. fieldError('loanAmount'). */
  fieldError(field) {
    return this.details.find((d) => d?.field === field)?.message || null;
  }
}

/**
 * FIXED — the backend answers some paths with HTTP 200 and
 * `{ success: false, error: {...} }`. This used to return `res.data?.data`,
 * which is `undefined` on those bodies, so the page rendered empty with no
 * error anywhere. Now the envelope is checked and a real ApiError is thrown
 * (and toasted, matching the HTTP-error path) unless `silentError` is set.
 */
function unwrap(res, opts) {
  const body = res?.data;
  if (body && body.success === false) {
    const err = new ApiError({ ...(body.error || {}), status: res.status });
    if (!opts?.silentError) toast.error(err.message);
    throw err;
  }
  return body;
}

/** Unwrap the success envelope to `data`; throw on failure. */
export async function call(method, url, payload, opts) {
  const res = await api.request({ method, url, data: payload, ...opts });
  return unwrap(res, opts)?.data;
}

/**
 * FIXED — `call()` dropped `meta`, so pagination was unreachable through the
 * client and 17 pages reached around it with `api.raw.get(...)`. List calls now
 * go through here and get `{ data, meta }`; single-object calls keep using
 * `call()` and stay unwrapped.
 */
export async function callList(method, url, payload, opts) {
  const res = await api.request({ method, url, data: payload, ...opts });
  const body = unwrap(res, opts) || {};
  const rows = body.data;
  return {
    data: Array.isArray(rows) ? rows : rows == null ? [] : [rows],
    meta: body.meta || null,
  };
}

export const apiClient = {
  get: (url, opts) => call('get', url, undefined, opts),
  post: (url, body, opts) => call('post', url, body, opts),
  patch: (url, body, opts) => call('patch', url, body, opts),
  put: (url, body, opts) => call('put', url, body, opts),
  delete: (url, opts) => call('delete', url, undefined, opts),
  /**
   * Paginated GET. Returns `{ data: [], meta: { page, pageSize, total,
   * totalPages } | null }` — pass axios options the same way as `get`,
   * e.g. `api.list('/admin/farmers', { params: { page, pageSize } })`.
   */
  list: (url, opts) => callList('get', url, undefined, opts),
  raw: api,
};

export default apiClient;
