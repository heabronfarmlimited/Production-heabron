/**
 * Transaction history — ported from
 * modules/wallet/presentation/view/transaction_history_view.dart
 *
 * Layout from Dart: an `AuthBackButton` with zero margin, 17 space,
 * 'Recent Transactions' (22sp w700), 20 space, then the separated list. The
 * separator is a 1px `grey @ 18%` divider and the footer is a spinner while
 * another page loads.
 *
 * FIXED — the Dart screen advanced its page counter only while more pages
 * remained, so once the last page arrived every further scroll re-fetched it
 * and appended duplicates. `usePaginatedList` derives the cursor from `meta`.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { EmptyState } from '../components/EmptyState';
import { TransactionRow } from '../components/TransactionRow';
import { useWalletTransactions } from '../hooks/useWallet';
import type { WalletTransaction } from '../model/walletTransaction';
import { withAlpha } from '../utils/color';

export function TransactionHistoryScreen() {
  const router = useRouter();
  const {
    items,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    loadMore,
    refresh,
  } = useWalletTransactions();

  const openTransaction = (transaction: WalletTransaction) => {
    if (transaction.id) router.push(routes.transactionDetails(transaction.id));
  };

  return (
    <AppSkeleton isBusy={isLoading && items.length === 0}>
      <View style={styles.backRow}>
        <AuthBackButton />
      </View>

      <View style={{ height: h(17) }} />

      <Text style={styles.heading}>Recent Transactions</Text>

      <View style={{ height: h(20) }} />

      <View style={styles.listWrap}>
        <FlashList
          data={items}
          keyExtractor={(item, index) => item.id ?? `tx-${index}`}
          estimatedItemSize={r(92)}
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              variant="history"
              onPress={openTransaction}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            isLoading ? null : <EmptyState text="No transactions found" topSpacing={100} />
          }
          ListFooterComponent={
            hasNextPage || isFetchingNextPage ? (
              <View style={styles.footer}>
                <AppLoading color={colors.primary} />
              </View>
            ) : null
          }
        />
      </View>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  backRow: {
    alignSelf: 'flex-start',
  },
  heading: {
    ...textTheme.headlineMedium,
    fontSize: spMin(22),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  listWrap: {
    flex: 1,
  },
  separator: {
    height: 1,
    // Dart: AppColors.grey.withValues(alpha: 0.18)
    backgroundColor: withAlpha(colors.grey, 0.18),
  },
  footer: {
    paddingVertical: r(20),
    alignItems: 'center',
  },
});
