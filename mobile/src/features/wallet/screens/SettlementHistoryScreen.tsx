/**
 * Settlement history — ported from
 * modules/wallet/presentation/view/settlement_history_view.dart
 *
 * Layout from Dart: `AuthBackButton`, 17 space, 'Settlement History' (22sp
 * w700), 8 space, 'Track the status of your withdrawal requests.' (13sp grey),
 * 20 space, then the separated list with a 1px `grey @ 18%` divider.
 *
 * FIXED — same off-by-one page counter as the transaction list; see
 * usePaginatedList.
 */
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { EmptyState } from '../components/EmptyState';
import { SettlementItem } from '../components/SettlementItem';
import { ReceiptIcon } from '../components/WalletIcons';
import { useSettlements } from '../hooks/useSettlements';
import { withAlpha } from '../utils/color';

export function SettlementHistoryScreen() {
  const {
    items,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    loadMore,
    refresh,
  } = useSettlements();

  return (
    <AppSkeleton isBusy={isLoading && items.length === 0}>
      <View style={styles.backRow}>
        <AuthBackButton />
      </View>

      <View style={{ height: h(17) }} />

      <Text style={styles.heading}>Settlement History</Text>

      <View style={{ height: h(8) }} />

      <Text style={styles.subtitle}>Track the status of your withdrawal requests.</Text>

      <View style={{ height: h(20) }} />

      <View style={styles.listWrap}>
        <FlashList
          data={items}
          keyExtractor={(item, index) => item.id ?? `settlement-${index}`}
          estimatedItemSize={r(96)}
          renderItem={({ item }) => <SettlementItem item={item} />}
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
            isLoading ? null : (
              <EmptyState
                text="No settlement requests yet"
                topSpacing={100}
                icon={<ReceiptIcon color={withAlpha(colors.grey, 0.4)} size={48} />}
              />
            )
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
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    color: colors.grey,
  },
  listWrap: {
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: withAlpha(colors.grey, 0.18),
  },
  footer: {
    paddingVertical: r(20),
    alignItems: 'center',
  },
});
