/**
 * Auth mutations — replace LoginController, RegisterController,
 * ForgotPasswordController, ResetPasswordController, NinUpdateController.
 *
 * Each Dart controller held TextEditingControllers plus an `AppState` and
 * toasted on failure. Here the form owns the inputs (React Hook Form) and
 * these hooks own the request, so a screen is just markup plus a `mutate`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { AppError } from '../../../core/api/AppError';
import { clearQueryCache, qk } from '../../../core/api/queryClient';
import { routes, sessionRoutePath } from '../../../core/navigation/routes';
import { authStorage } from '../../../core/storage/authStorage';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import * as authApi from '../api/authApi';
import { resolveSessionRoute, useAuthStore } from '../model/authStore';
import type { User } from '../model/user';

/** `GET /auth/me` — kept fresh for the profile screens. */
export function useMe(enabled = true) {
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery({
    queryKey: qk.me,
    enabled: enabled && authStorage.isAuthenticated(),
    queryFn: async () => {
      const user = await authApi.fetchMe();
      setUser(user);
      return user;
    },
  });
}

/**
 * Login, then route by account status.
 *
 * The Dart `LoginController.signin` did login -> `/auth/me` -> branch on
 * status. `resolveSessionRoute` holds that branching so the splash screen and
 * login agree (in Flutter they disagreed, and a rejected agent could never
 * reach the NIN screen from a cold start).
 */
export function useLogin() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const fromLogin = await authApi.login(input);
      // The login response may omit the profile; fall back to /auth/me.
      const user = fromLogin ?? (await authApi.fetchMe());
      return user;
    },
    onSuccess: (user: User) => {
      setUser(user);
      const target = resolveSessionRoute(user, true);
      router.replace(sessionRoutePath[target]);
    },
    onError: showApiError,
  });
}

/** Step 1 — `POST /auth/signup`. */
export function useSignup() {
  return useMutation({
    mutationFn: authApi.signup,
    onError: showApiError,
  });
}

/**
 * Step 2 — verify the OTP, then log in so the next step is authenticated.
 *
 * The Dart flow did exactly this (verify-otp immediately followed by login),
 * because `signup/complete` and the avatar upload both need a bearer token.
 */
export function useVerifySignupOtp() {
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: { email: string; code: string; password: string }) => {
      await authApi.verifySignupOtp({ email: input.email, code: input.code });
      const user = await authApi.login({
        email: input.email,
        password: input.password,
      });
      return user;
    },
    onSuccess: (user) => {
      if (user) setUser(user);
    },
    onError: showApiError,
  });
}

export function useResendSignupOtp() {
  return useMutation({
    mutationFn: authApi.resendSignupOtp,
    onSuccess: () => showSuccess('OTP resent successfully'),
    onError: showApiError,
  });
}

/** Step 3 — `POST /auth/signup/complete`, then hold at the review screen. */
export function useCompleteSignup() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: authApi.completeSignup,
    onSuccess: async () => {
      // Refresh the cached profile so the review screen shows real status.
      await queryClient.invalidateQueries({ queryKey: qk.me });
      router.replace(routes.underReview);
    },
    onError: showApiError,
  });
}

/** `POST /auth/resubmit-nin` after a rejection. */
export function useResubmitNin() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: {
      firstName: string;
      lastName: string;
      nin: string;
      dateOfBirth: string;
    }) => {
      await authApi.resubmitNin(input);
      return authApi.fetchMe();
    },
    onSuccess: (user) => {
      setUser(user);
      showSuccess('NIN details re-submitted successfully');
      router.replace(routes.underReview);
    },
    onError: showApiError,
  });
}

export function useForgotPassword() {
  const router = useRouter();

  return useMutation({
    mutationFn: authApi.forgotPassword,
    onSuccess: (_data, email) => {
      router.push({
        pathname: routes.forgotPasswordVerify,
        params: { email },
      });
    },
    onError: showApiError,
  });
}

export function useResetPassword() {
  const router = useRouter();

  return useMutation({
    mutationFn: authApi.resetPassword,
    onSuccess: () => {
      showSuccess('Password reset successful.');
      router.replace(routes.login);
    },
    onError: showApiError,
  });
}

/** Clears the session and every cached query, then returns to pre-auth. */
export function useLogout() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);

  return useMutation({
    mutationFn: authApi.logout,
    // `authApi.logout` swallows server errors, so this always resolves.
    onSettled: () => {
      signOut();
      clearQueryCache();
      router.replace(routes.preAuth);
    },
  });
}

/**
 * Called by the axios interceptor when a refresh fails — see
 * `setSessionExpiredHandler`. Registered once in the root layout.
 */
export function useSessionExpiredHandler() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);

  return useCallback(() => {
    signOut();
    clearQueryCache();
    router.replace(routes.login);
  }, [router, signOut]);
}

/** Maps server-side field errors onto a form. */
export function applyFieldErrors<T extends Record<string, unknown>>(
  err: unknown,
  setError: (name: keyof T & string, error: { message: string }) => void,
): boolean {
  const error = AppError.from(err);
  const fields = error.fieldErrors;
  const keys = Object.keys(fields);
  if (keys.length === 0) return false;

  keys.forEach((key) => {
    const message = fields[key];
    if (message) setError(key as keyof T & string, { message });
  });
  return true;
}
