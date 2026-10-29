/**
 * Wallet tab root — ported from
 * modules/wallet/presentation/view/wallet_view.dart
 *
 * Layout from Dart, top to bottom: 20 space, 'Wallet' (24sp w700), 22 space,
 * 'Balance' (14sp grey), the balance row with its visibility toggle, 42 space,
 * the two action buttons side by side (h48, radius 4), 37 space, the
 * 'Recent Transactions' / 'View All' header, 16 space, then the first five
 * transactions or 'No recent transactions'.
 *
 * The balance masks to '₦ ••••' when hidden, exactly as `_showBalance` did.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme, withNaira } from '../../../core/theme/typography';
import { formatNaira } from '../../../core/utils/format';
import { EmptyState } from '../components/EmptyState';
import { TransactionRow } from '../components/TransactionRow';
import { EyeIcon, EyeOffIcon } from '../components/WalletIcons';
import { useWallet, useWalletTransactions } from '../hooks/useWallet';
import type { WalletTransaction } from '../model/walletTransaction';

/** Dart: `'₦ ••••'` when the balance is hidden. */
const MASKED_BALANCE = '₦ ••••';

/** `controller.transactions.take(5)` */
const RECENT_COUNT = 5;

export function WalletScreen() {
  const router = useRouter();
  const [showBalance, setShowBalance] = useState(true);

  const { wallet, isLoading: walletLoading, refresh: refreshWallet } = useWallet();
  const {
    items,
    isLoading: txLoading,
    isRefetching,
    refresh: refreshTransactions,
  } = useWalletTransactions();

  const recent = items.slice(0, RECENT_COUNT);
  const balanceText = showBalance ? formatNaira(wallet?.balance) : MASKED_BALANCE;

  const openTransaction = (transaction: WalletTransaction) => {
    if (transaction.id) router.push(routes.transactionDetails(transaction.id));
  };

  const refreshAll = () => {
    refreshWallet();
    refreshTransactions();
  };

  return (
    <AppSkeleton
      // Dart: `controller.state.isLoading && wallet == null` — a refresh must
      // not drop an overlay over content that is already on screen.
      isBusy={(walletLoading || txLoading) && wallet == null && items.length === 0}
      scrollable
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refreshAll}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      <View style={{ height: h(20) }} />

      <Text style={styles.heading}>Wallet</Text>

      <View style={{ height: h(22) }} />

      <Text style={styles.balanceLabel}>Balance</Text>

      <View style={styles.balanceRow}>
        <Text style={styles.balance}>{balanceText}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showBalance ? 'Hide balance' : 'Show balance'}
          onPress={() => setShowBalance((v) => !v)}
          hitSlop={8}
          style={styles.eyeButton}
        >
          {showBalance ? (
            <EyeIcon color={colors.grey} size={24} />
          ) : (
            <EyeOffIcon color={colors.grey} size={24} />
          )}
        </Pressable>
      </View>

      <View style={{ height: h(42) }} />

      <View style={styles.actions}>
        <View style={styles.action}>
          <AppButton
            text="Request Settlement"
            height={48}
            borderRadius={4}
            onPress={() => router.push(routes.settlementRequest)}
            testID="wallet-request-settlement"
          />
        </View>
        <View style={{ width: r(12) }} />
        <View style={styles.action}>
          <AppButton
            text="Transaction History"
            height={48}
            borderRadius={4}
            isOutlined
            outlineColor={colors.primary}
            textColor={colors.primary}
            bgColor={colors.white}
            onPress={() => router.push(routes.transactionHistory)}
            testID="wallet-transaction-history"
          />
        </View>
      </View>

      <View style={{ height: h(37) }} />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(routes.transactionHistory)}
          hitSlop={6}
        >
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      <View style={{ height: h(16) }} />

      {recent.length === 0 ? (
        <EmptyState text="No recent transactions" verticalPadding={24} />
      ) : (
        recent.map((item, index) => (
          <TransactionRow
            key={item.id ?? `${item.reference ?? 'tx'}-${index}`}
            transaction={item}
            variant="wallet"
            onPress={openTransaction}
            isLast={index === recent.length - 1}
          />
        ))
      )}
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  balanceLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  balance: {
    ...withNaira(textTheme.headlineMedium),
    fontSize: spMin(24),
    fontWeight: '600',
  },
  eyeButton: {
    padding: r(8),
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
  },
  viewAll: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.primary,
  },
});
