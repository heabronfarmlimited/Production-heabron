/**
 * Token + cached-user accessors — replaces
 * modules/authentication/data/repository/auth_local_repository.dart
 *
 * Kept separate from `storage.ts` so the API client can depend on just this
 * narrow surface without pulling in feature code (which is what created the
 * circular `NetworkInterceptor -> AuthRepository -> ApiService` knot in the
 * Dart version).
 */
import type { User } from '../../features/auth/model/user';

import { storage, StorageKeys } from './storage';

/** `AuthLocalRepository.getToken()` */
export const getToken = (): string | undefined => storage.read(StorageKeys.token);

/** `AuthLocalRepository.getRefreshToken()` */
export const getRefreshToken = (): string | undefined =>
  storage.read(StorageKeys.refreshToken);

export function setToken(token: string): void {
  storage.write(StorageKeys.token, token);
}

export function setRefreshToken(token: string): void {
  storage.write(StorageKeys.refreshToken, token);
}

/** Stores both tokens from a login / refresh / signup response. */
export function setTokens(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): void {
  if (tokens.accessToken) setToken(tokens.accessToken);
  if (tokens.refreshToken) setRefreshToken(tokens.refreshToken);
}

/** `AuthLocalRepository.getLocalUser()` */
export const getCachedUser = (): User | undefined =>
  storage.readJson<User>(StorageKeys.user);

export function setCachedUser(user: User): void {
  storage.writeJson(StorageKeys.user, user);
}

export function clearCachedUser(): void {
  storage.remove(StorageKeys.user);
}

/** True when a session exists — used by the splash screen to pick a route. */
export const isAuthenticated = (): boolean => Boolean(getToken());

/** Full wipe on logout / failed refresh — `clearDb()` in the Dart original. */
export function clearSession(): void {
  storage.clearAll();
}

export const authStorage = {
  getToken,
  getRefreshToken,
  setToken,
  setRefreshToken,
  setTokens,
  getCachedUser,
  setCachedUser,
  clearCachedUser,
  isAuthenticated,
  clearSession,
} as const;
