/**
 * Bank account settings — ported from
 * modules/profile/presentation/view/bank_account_settings_view.dart
 *
 * Dart layout: AuthBackButton, 20 space, 'Bank Account Details' (20sp w600),
 * 8 space, 'Manage your bank account details for settlements and payouts.'
 * (14sp grey), 30 space, then Bank Name, Account Number, Account Name, and a
 * 'Save Details' button (height 54).
 *
 * NOTE — bank name and account name are free text with no bank list and no
 * name-enquiry lookup, matching the backend: `saveBankAccount` validates only
 * lengths and that the account number is exactly 10 digits.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { colors } from '../../../core/theme/colors';
import { h, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { bankAccountSchema, type BankAccountForm } from '../../auth/model/validation';
import { useBankAccount, useSaveBankAccount } from '../hooks/useProfile';

export function BankAccountScreen() {
  const { data: account, isLoading } = useBankAccount();
  const { mutate: save, isPending } = useSaveBankAccount();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BankAccountForm>({
    resolver: zodResolver(bankAccountSchema),
    mode: 'onTouched',
    defaultValues: { bankName: '', accountNumber: '', accountName: '' },
  });

  // Prefill once the existing account arrives — Dart called `init()` from a
  // post-frame callback in `didChangeDependencies`.
  useEffect(() => {
    if (!account) return;
    reset({
      bankName: account.bankName ?? '',
      accountNumber: account.accountNumber ?? '',
      accountName: account.accountName ?? '',
    });
  }, [account, reset]);

  return (
    <AppSkeleton
      isBusy={isLoading || isPending}
      appBarLeading={<AuthBackButton />}
      scrollable
    >
      <View style={{ height: h(20) }} />

      <Text style={styles.title}>Bank Account Details</Text>

      <View style={{ height: h(8) }} />

      <Text style={styles.subtitle}>
        Manage your bank account details for settlements and payouts.
      </Text>

      <View style={{ height: h(30) }} />

      <Controller
        control={control}
        name="bankName"
        render={({ field }) => (
          <AppTextField
            title="Bank Name"
            hintText="Enter bank name (e.g. GTBank)"
            autoCapitalize="words"
            maxLength={120}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.bankName?.message}
            testID="bank-name"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="accountNumber"
        render={({ field }) => (
          <AppTextField
            title="Account Number"
            hintText="Enter 10-digit account number"
            keyboardType="number-pad"
            maxLength={10}
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.accountNumber?.message}
            testID="bank-account-number"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="accountName"
        render={({ field }) => (
          <AppTextField
            title="Account Name"
            hintText="Enter account name (e.g. John Doe)"
            autoCapitalize="words"
            maxLength={120}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.accountName?.message}
            testID="bank-account-name"
          />
        )}
      />

      <View style={{ height: h(40) }} />

      <AppButton
        text="Save Details"
        height={54}
        loading={isPending}
        onPress={handleSubmit((v) => save(v))}
        testID="bank-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
});
