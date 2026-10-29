/**
 * Profile queries + mutations — replace `EditProfileController` and
 * `BankAccountController` (and the `bankAccountProvider` FutureProvider).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { qk } from '../../../core/api/queryClient';
import { routes } from '../../../core/navigation/routes';
import { showApiError, showSuccess } from '../../../core/utils/toast';
import * as authApi from '../../auth/api/authApi';
import { useAuthStore } from '../../auth/model/authStore';
import * as profileApi from '../api/profileApi';

/** `bankAccountProvider` — `FutureProvider.autoDispose<BankAccount?>`. */
export function useBankAccount() {
  return useQuery({
    queryKey: qk.bankAccount,
    queryFn: profileApi.getBankAccount,
  });
}

export function useSaveBankAccount() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: profileApi.saveBankAccount,
    onSuccess: async () => {
      showSuccess('Bank account details saved successfully');
      // Dart did `ref.invalidate(bankAccountProvider)` then `back()`.
      await queryClient.invalidateQueries({ queryKey: qk.bankAccount });
      router.back();
    },
    onError: showApiError,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);

  return useMutation({
    mutationFn: async (input: {
      fullName?: string;
      phone?: string;
      state?: string;
      lga?: string;
      avatarUrl?: string;
    }) => {
      await profileApi.updateProfile(input);
      // The PATCH response may be partial, so re-read the canonical profile.
      return authApi.fetchMe();
    },
    onSuccess: async (user) => {
      setUser(user);
      await queryClient.invalidateQueries({ queryKey: qk.me });
      showSuccess('Profile updated successfully');
      router.back();
    },
    onError: showApiError,
  });
}

/**
 * Permanent account deletion. Flutter left this as a TODO with a dead
 * confirm button; the endpoint exists and is wired here.
 */
export function useDeleteAccount() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: profileApi.deleteAccount,
    onSuccess: () => {
      signOut();
      queryClient.clear();
      showSuccess('Your account has been deleted.');
      router.replace(routes.preAuth);
    },
    onError: showApiError,
  });
}
