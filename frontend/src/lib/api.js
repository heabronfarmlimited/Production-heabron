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
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
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
        const newTokens = data.data;
        localStorage.setItem('coopscore.accessToken', newTokens.accessToken);
        localStorage.setItem('coopscore.refreshToken', newTokens.refreshToken);
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

/** Unwrap the success envelope; throw on failure. */
export async function call(method, url, payload, opts) {
  const res = await api.request({ method, url, data: payload, ...opts });
  return res.data?.data;
}

export const apiClient = {
  get: (url, opts) => call('get', url, undefined, opts),
  post: (url, body, opts) => call('post', url, body, opts),
  patch: (url, body, opts) => call('patch', url, body, opts),
  put: (url, body, opts) => call('put', url, body, opts),
  delete: (url, opts) => call('delete', url, undefined, opts),
  raw: api,
};

export default apiClient;
