/**
 * Request settlement — ported from
 * modules/wallet/presentation/view/request_settlement_view.dart
 *
 * The handoff doc called this a stub; it is not. 276 LOC, fully implemented,
 * and ported complete here.
 *
 * Layout from Dart: a top row holding `AuthBackButton` and a history icon
 * button (tooltip 'Settlement History'), 32 space, a 96r circle, 32 space,
 * 'Request Settlement' (24sp w600), 10 space, the branch subtitle (14sp grey,
 * centred), 32 space, then one of two branches:
 *
 *   A — has bank details: a read-only 'Settlement Account' card (Bank /
 *       Account No. / Account Name) on `primary @ 6%` with a `primary @ 20%`
 *       border, 28 space, the 'Amount to Withdraw' field with a '₦' prefix,
 *       48 space, 'Submit Request' (h52)
 *   B — no bank details: a `failure @ 6%` card with a warning glyph and the
 *       Profile → Bank Account Settings copy, 32 space, 'Add Bank Details'
 *
 * The 96r circle and the subtitle both switch on `hasBankDetails`.
 *
 * FIXED (audit item 29) — the Dart build emitted `...[]` while the bank
 * account was loading, so the whole middle of the screen collapsed and then
 * jumped. A skeleton of the same height holds the space instead.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { showApiError, showError, showSuccess } from '../../../core/utils/toast';
import { BankIcon, NairaPrefix } from '../../auth/components/FieldIcons';
import { settlementSchema, type SettlementForm } from '../../auth/model/validation';
import { HistoryIcon, WalletIcon, WarningIcon } from '../components/WalletIcons';
import { useBankAccount } from '../hooks/useBankAccount';
import { useRequestSettlement } from '../hooks/useSettlements';
import type { BankAccount } from '../model/bankAccount';
import { withAlpha } from '../utils/color';

export function RequestSettlementScreen() {
  const router = useRouter();

  const { bankAccount, hasBankDetails, isLoading } = useBankAccount();
  const { submitAsync, isPending } = useRequestSettlement();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SettlementForm>({
    resolver: zodResolver(settlementSchema),
    // Dart: AutovalidateMode.onUserInteraction
    mode: 'onTouched',
    defaultValues: { amount: '' },
  });

  const onSubmit = async (values: SettlementForm) => {
    Keyboard.dismiss();

    const amount = Number(values.amount.trim());

    // Both guards are the controller's, kept in its order and wording.
    if (!Number.isFinite(amount) || amount <= 0) {
      showError('Enter a valid amount greater than zero');
      return;
    }

    if (!hasBankDetails || !bankAccount) {
      showError('Please add your bank details first.');
      return;
    }

    try {
      await submitAsync({
        amount,
        bankName: bankAccount.bankName ?? '',
        accountNumber: bankAccount.accountNumber ?? '',
        accountName: bankAccount.accountName ?? '',
      });
      showSuccess('Settlement request submitted successfully');
      reset({ amount: '' });
      router.back();
    } catch (err) {
      // Dart toasted the AppException message, falling back to this literal.
      showApiError(err, 'Settlement request failed. Please try again.');
    }
  };

  return (
    <AppSkeleton scrollable bodyPadding={styles.bodyPadding}>
      <View style={styles.topRow}>
        <AuthBackButton />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settlement History"
          onPress={() => router.push(routes.settlementHistory)}
          hitSlop={8}
          style={styles.historyButton}
        >
          <HistoryIcon color={colors.black} size={22} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={{ height: h(32) }} />

        {/* The circle switches icon and tint on `hasBankDetails`; while the
            query is in flight it stays neutral rather than flashing the
            failure state. */}
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: isLoading
                ? withAlpha(colors.grey, 0.1)
                : hasBankDetails
                  ? withAlpha(colors.primary, 0.12)
                  : withAlpha(colors.failure, 0.1),
            },
          ]}
        >
          {hasBankDetails && !isLoading ? (
            <WalletIcon color={colors.primary} size={40} />
          ) : (
            <BankIcon color={isLoading ? colors.grey : colors.failure} size={40} />
          )}
        </View>

        <View style={{ height: h(32) }} />

        <Text style={styles.title}>Request Settlement</Text>

        <View style={{ height: h(10) }} />

        <Text style={styles.subtitle}>
          {isLoading
            ? 'Loading your settlement account…'
            : hasBankDetails
              ? 'Funds will be sent to your registered bank account.'
              : 'You need to add your bank account details before requesting a settlement.'}
        </Text>

        <View style={{ height: h(32) }} />

        {isLoading ? (
          <LoadingBranch />
        ) : hasBankDetails && bankAccount ? (
          <>
            <SettlementAccountCard account={bankAccount} />

            <View style={{ height: h(28) }} />

            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <AppTextField
                  title="Amount to Withdraw"
                  hintText="0.00"
                  keyboardType="decimal-pad"
                  prefix={<NairaPrefix color={colors.primary} />}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.amount?.message}
                  enabled={!isPending}
                  testID="settlement-amount"
                />
              )}
            />

            <View style={{ height: h(48) }} />

            <AppButton
              text="Submit Request"
              height={52}
              loading={isPending}
              onPress={handleSubmit(onSubmit)}
              testID="settlement-submit"
            />
          </>
        ) : (
          <>
            <View style={styles.warningCard}>
              <WarningIcon color={colors.failure} size={22} />
              <Text style={styles.warningText}>
                No bank account found. Please add your bank details in Profile → Bank
                Account Settings before requesting a settlement.
              </Text>
            </View>

            <View style={{ height: h(32) }} />

            <AppButton
              text="Add Bank Details"
              height={52}
              onPress={() => router.push(routes.bankAccount)}
              testID="settlement-add-bank"
            />
          </>
        )}

        <View style={{ height: h(24) }} />
      </View>
    </AppSkeleton>
  );
}

/** `_BankRow` — label (12sp grey) left, value (13sp w600 black) right. */
function BankRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.bankRow}>
      <Text style={styles.bankLabel}>{label}</Text>
      <Text style={styles.bankValue}>{value}</Text>
    </View>
  );
}

function SettlementAccountCard({ account }: { account: BankAccount }) {
  return (
    <View style={styles.accountCard}>
      <View style={styles.accountHeader}>
        <BankIcon color={colors.primary} size={16} />
        <Text style={styles.accountHeaderText}>Settlement Account</Text>
      </View>

      <View style={{ height: h(12) }} />
      <BankRow label="Bank" value={account.bankName ?? ''} />
      <View style={{ height: h(8) }} />
      <BankRow label="Account No." value={account.accountNumber ?? ''} />
      <View style={{ height: h(8) }} />
      <BankRow label="Account Name" value={account.accountName ?? ''} />
    </View>
  );
}

/**
 * Placeholder for the branch content while `GET /agent/bank-account` is in
 * flight. It occupies the same vertical space as branch A so nothing shifts
 * when the real card and field arrive.
 */
function LoadingBranch() {
  return (
    <View accessibilityLabel="Loading settlement account" accessible>
      <View style={styles.skeletonCard} />
      <View style={{ height: h(28) }} />
      <View style={styles.skeletonLabel} />
      <View style={{ height: h(8) }} />
      <View style={styles.skeletonField} />
      <View style={{ height: h(48) }} />
      <View style={styles.skeletonButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  bodyPadding: {
    paddingHorizontal: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: r(16),
  },
  historyButton: {
    padding: r(8),
  },
  body: {
    paddingHorizontal: r(16),
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  iconCircle: {
    width: r(96),
    height: r(96),
    borderRadius: r(96),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  subtitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
    textAlign: 'center',
  },
  accountCard: {
    alignSelf: 'stretch',
    padding: r(16),
    borderRadius: r(16),
    backgroundColor: withAlpha(colors.primary, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.2),
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountHeaderText: {
    ...textTheme.bodySmall,
    marginLeft: r(6),
    fontSize: spMin(11),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bankLabel: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  bankValue: {
    ...textTheme.bodyMedium,
    flexShrink: 1,
    marginLeft: r(12),
    fontSize: spMin(13),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
    textAlign: 'right',
  },
  warningCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    padding: r(16),
    borderRadius: r(16),
    backgroundColor: withAlpha(colors.failure, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(colors.failure, 0.25),
  },
  warningText: {
    ...textTheme.bodySmall,
    flex: 1,
    marginLeft: r(12),
    fontSize: spMin(13),
    color: colors.failure,
  },
  skeletonCard: {
    alignSelf: 'stretch',
    height: r(136),
    borderRadius: r(16),
    backgroundColor: colors.secondary100,
  },
  skeletonLabel: {
    width: r(140),
    height: r(14),
    borderRadius: r(4),
    backgroundColor: colors.secondary100,
    alignSelf: 'flex-start',
  },
  skeletonField: {
    alignSelf: 'stretch',
    height: r(52),
    borderRadius: r(8),
    backgroundColor: colors.secondary100,
  },
  skeletonButton: {
    alignSelf: 'stretch',
    height: h(52),
    borderRadius: r(4),
    backgroundColor: colors.secondary100,
  },
});
