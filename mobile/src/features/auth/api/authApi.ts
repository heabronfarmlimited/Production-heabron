/**
 * Auth API — ported from
 * modules/authentication/data/repository/auth_remote_repository_impl.dart
 *
 * Each function maps to one endpoint and returns the unwrapped payload.
 * Token persistence happens here (as it did in the Dart repository) so the
 * calling screens stay declarative.
 */
import { Platform } from 'react-native';

import { AppError } from '../../../core/api/AppError';
import { api } from '../../../core/api/client';
import type { UploadKind } from '../../../core/api/endpoints';
import { endpoints, PRE_AUTH_UPLOAD_KINDS } from '../../../core/api/endpoints';
import { authStorage } from '../../../core/storage/authStorage';
import type { User } from '../model/user';
import { parseUser, parseVerification } from '../model/user';

// ------------------------------------------------------------------ signup
/** `POST /auth/signup` — step 1. Email is lowercased + trimmed, as in Dart. */
export async function signup(input: {
  email: string;
  password: string;
}): Promise<void> {
  await api.post(endpoints.signup, {
    email: input.email.trim().toLowerCase(),
    password: input.password.trim(),
  });
}

/** `POST /auth/verify-otp` — step 2. `purpose` is always `'signup'` here. */
export async function verifySignupOtp(input: {
  email: string;
  code: string;
}): Promise<void> {
  await api.post(endpoints.verifySignupOtp, {
    code: input.code.trim(),
    email: input.email.trim().toLowerCase(),
    purpose: 'signup',
  });
}

/** `POST /auth/resend-otp` */
export async function resendSignupOtp(email: string): Promise<void> {
  await api.post(endpoints.resendSignupOtp, {
    email: email.trim().toLowerCase(),
    purpose: 'signup',
  });
}

/**
 * `POST /auth/signup/complete` — step 3.
 *
 * FIXED — the Dart version sent this without an Authorization header even
 * though the app is authenticated by this point (it logs in right after OTP).
 * The shared client attaches the bearer token automatically, which is what the
 * backend expects.
 *
 * `dateOfBirth` is sent as a full ISO-8601 timestamp to match the Dart payload.
 */
export async function completeSignup(input: {
  fullName: string;
  phone: string;
  nin: string;
  dateOfBirth: string; // `YYYY-MM-DD` from the date picker
  state: string;
  lga: string;
  selfieUrl: string;
}): Promise<void> {
  await api.post(endpoints.completeSignup, {
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    nin: input.nin.trim(),
    dateOfBirth: new Date(input.dateOfBirth).toISOString(),
    state: input.state,
    lga: input.lga,
    selfieUrl: input.selfieUrl,
  });
}

/**
 * `POST /auth/resubmit-nin`
 *
 * Note the date format differs from completeSignup — this endpoint takes a
 * date-only string. That asymmetry exists in the backend, so it is preserved.
 */
export async function resubmitNin(input: {
  firstName: string;
  lastName: string;
  nin: string;
  dateOfBirth: string; // `YYYY-MM-DD`
}): Promise<void> {
  await api.post(endpoints.resubmitNin, {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    nin: input.nin.trim(),
    dateOfBirth: input.dateOfBirth,
  });
}

// ------------------------------------------------------------------- login
interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
}

/**
 * `POST /auth/login` — stores both tokens and returns the user when the
 * response carries one.
 *
 * IMPROVED — the Dart `handleLogin` had its user-caching block commented out,
 * so every login fired a second `GET /auth/me` to get the profile. The login
 * response already includes `user` and `application`, so this caches them when
 * present and `fetchMe()` becomes a refresh rather than a required round trip.
 */
export async function login(input: {
  email: string;
  password: string;
}): Promise<User | null> {
  const data = await api.post<Record<string, unknown>>(endpoints.login, {
    email: input.email.trim().toLowerCase(),
    password: input.password.trim(),
  });

  const tokens = data as AuthTokens;
  authStorage.setTokens(tokens);

  if (!tokens.accessToken) {
    throw new AppError('Login failed. Please try again.');
  }

  return cacheUserFromPayload(data);
}

/**
 * `GET /auth/me` — fetches and caches the current user.
 *
 * The NIN/identity record arrives under the top-level key `application`, not
 * `nin`; it is stored on `user.nin`, exactly as the Dart `copyWith` did.
 */
export async function fetchMe(): Promise<User> {
  const data = await api.get<Record<string, unknown>>(endpoints.userProfile);
  const user = cacheUserFromPayload(data);

  if (!user) throw new AppError('Unable to load your profile.');
  return user;
}

/** Shared by `login` and `fetchMe`: builds the User and writes it to storage. */
function cacheUserFromPayload(data: Record<string, unknown>): User | null {
  if (!data?.user) return null;

  const user = parseUser(data.user);
  const application = data.application ? parseVerification(data.application) : null;
  const merged: User = application ? { ...user, nin: application } : user;

  authStorage.setCachedUser(merged);
  return merged;
}

/** `POST /auth/refresh` — exposed for manual use; the client refreshes on 401. */
export async function refreshSession(): Promise<void> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) throw new AppError('No refresh token found');

  const data = await api.post<AuthTokens>(endpoints.refreshToken, { refreshToken });
  authStorage.setTokens(data);
}

/**
 * `POST /auth/logout`, then clears local state.
 *
 * The server call is best-effort: a failure there must not trap the user in a
 * signed-in state, so local credentials are cleared either way.
 */
export async function logout(): Promise<void> {
  try {
    await api.post(endpoints.logout);
  } catch {
    // Ignored — clearing local state below is what actually signs the user out.
  } finally {
    authStorage.clearSession();
  }
}

// --------------------------------------------------------------- password
/** `POST /auth/forgot-password` */
export async function forgotPassword(email: string): Promise<void> {
  await api.post(endpoints.forgotPassword, {
    email: email.trim().toLowerCase(),
  });
}

/** `POST /auth/reset-password` */
export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  await api.post(endpoints.resetPassword, {
    email: input.email.trim().toLowerCase(),
    code: input.code.trim(),
    newPassword: input.newPassword.trim(),
  });
}

/** `POST /auth/change-password` */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await api.post(endpoints.changePassword, input);
}

// ----------------------------------------------------------------- uploads
/**
 * Uploads a file and returns its URL — `UploadService.uploadFile` /
 * `uploadFileWithoutAuth`.
 *
 * `preAuth` selects `/auth/uploads/:kind`, which accepts a token for a
 * not-yet-approved account. The agent route is gated by `requireFieldAgent`
 * and returns "Account is pending. Awaiting admin approval." before approval,
 * so onboarding must use the pre-auth route. Either way the bearer token is
 * required — that was the bug documented in APP_DEV_HANDOFF.md §7.
 */
export async function uploadFile(input: {
  uri: string;
  kind: UploadKind;
  fileName?: string;
  mimeType?: string;
  preAuth?: boolean;
}): Promise<string> {
  const { uri, kind, preAuth = false } = input;

  if (preAuth && !PRE_AUTH_UPLOAD_KINDS.includes(kind)) {
    throw new AppError(
      `Upload kind "${kind}" is not allowed before approval. ` +
        `Allowed: ${PRE_AUTH_UPLOAD_KINDS.join(', ')}.`,
    );
  }

  const name = input.fileName ?? uri.split('/').pop() ?? 'upload.jpg';
  const type = input.mimeType ?? guessMimeType(name);

  const form = new FormData();
  // RN's FormData takes this shape for file parts; the cast keeps TS happy.
  form.append('file', { uri, name, type } as unknown as Blob);

  const url = preAuth ? endpoints.uploadWithoutAuth(kind) : endpoints.upload(kind);

  const data = await api.post<{ url?: string }>(url, form, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'x-platform': getPlatform(),
    },
  });

  return data?.url ?? '';
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'heic':
      return 'image/heic';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'csv':
      return 'text/csv';
    default:
      return 'image/jpeg';
  }
}

/** `ApiMixin.imageHeaders` sent `x-platform: ios|android`. */
function getPlatform(): string {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
