/**
 * Session store — replaces the `UserListener` Hive listener plus the
 * `AuthLocalRepository` reads scattered across controllers.
 *
 * The Dart app re-read the cached user from Hive in each screen through a
 * `KeyValueStorageListener`. A single store is clearer and gives every screen
 * the same reactive value, while still persisting to MMKV so a cold start can
 * restore the session synchronously (which the splash screen depends on).
 */
import { create } from 'zustand';

import { authStorage } from '../../../core/storage/authStorage';

import type { User } from './user';
import { isActive, isPending, isRejected } from './user';

/** Where the splash screen should send the user. */
export type SessionRoute = 'home' | 'under-review' | 'nin-update' | 'pre-auth';

interface AuthState {
  user: User | null;
  /** True once the store has read persisted state. */
  hydrated: boolean;

  setUser: (user: User | null) => void;
  /** Re-reads the persisted user — call after a profile update. */
  refreshFromStorage: () => void;
  /** Clears tokens, cached user and all cached data. */
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Read synchronously at module init — MMKV is sync, so the splash screen can
  // decide its route on the first frame without an async gate.
  user: authStorage.getCachedUser() ?? null,
  hydrated: true,

  setUser: (user) => {
    if (user) authStorage.setCachedUser(user);
    else authStorage.clearCachedUser();
    set({ user });
  },

  refreshFromStorage: () => set({ user: authStorage.getCachedUser() ?? null }),

  signOut: () => {
    authStorage.clearSession();
    set({ user: null });
  },
}));

/** Convenience selectors. */
export const useUser = (): User | null => useAuthStore((s) => s.user);
export const useIsAuthenticated = (): boolean =>
  useAuthStore((s) => Boolean(s.user) && authStorage.isAuthenticated());

/**
 * Decides where a session belongs — the logic the Dart app split between
 * `SplashView._navigateBasedOnStorage` and `LoginController.signin`.
 *
 * FIXED — the splash screen only checked `status != 'active'` and sent
 * everyone else to "under review", so a rejected agent could never reach the
 * NIN correction screen on a cold start; they had to log out and sign in again
 * for `LoginController` to route them. Both paths now share this function, so
 * a rejected agent lands on `nin-update` however they arrive.
 */
export function resolveSessionRoute(
  user: User | null,
  hasToken: boolean = authStorage.isAuthenticated(),
): SessionRoute {
  if (!hasToken) return 'pre-auth';

  // A token with no cached profile happens during onboarding: tokens are
  // stored right after OTP, before the profile is fetched.
  if (!user) return 'under-review';

  if (isActive(user)) return 'home';

  const ninStatus = user.nin?.ninVerificationStatus;
  if (isRejected(user) || ninStatus === 'failed' || ninStatus === 'mismatch') {
    return 'nin-update';
  }

  if (isPending(user)) return 'under-review';

  // `suspended` or an unrecognised status — hold at the review screen.
  return 'under-review';
}
