/**
 * Bank account query + mutation — replaces `bankAccountProvider` (the one
 * `FutureProvider.autoDispose` in the Dart app) and `BankAccountController`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { getBankAccount, saveBankAccount } from '../api/walletApi';
import type { BankAccount} from '../model/bankAccount';
import { isBankAccountPopulated } from '../model/bankAccount';

export interface BankAccountForm {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/**
 * `GET /agent/bank-account`
 *
 * The endpoint always answers 200 with three nullable fields, so "no bank
 * account" is an empty payload rather than a 404. `hasBankDetails` is the
 * `BankAccount.isPopulated` getter.
 */
export function useBankAccount() {
  const query = useQuery<BankAccount>({
    queryKey: qk.bankAccount,
    queryFn: getBankAccount,
  });

  return {
    bankAccount: query.data ?? null,
    hasBankDetails: isBankAccountPopulated(query.data),
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refresh: () => void query.refetch(),
  };
}

/** `PUT /agent/bank-account` */
export function useSaveBankAccount() {
  const queryClient = useQueryClient();

  const mutation = useMutation<BankAccount, unknown, BankAccountForm>({
    mutationFn: saveBankAccount,
    onSuccess: (saved) => {
      // Seed the cache so a return to Request Settlement sees the new account
      // immediately; the Dart screen called `ref.invalidate` and re-fetched.
      queryClient.setQueryData(qk.bankAccount, saved);
      void queryClient.invalidateQueries({ queryKey: qk.bankAccount });
    },
  });

  return {
    save: mutation.mutate,
    saveAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
