/**
 * "Financing History" — ported from
 * .../view/financing/financing_history_view.dart (`financing_history_view`)
 *
 * Dart layout: a pinned app bar titled 'Financing History' (16sp w500), a
 * four-tab bar — All / Approved / Denied / Pending, 12sp labels, primary
 * indicator and label, grey when unselected — and per tab a divider-separated
 * list. Each row: a 28r `secondary200` avatar with a grey person icon, the
 * title-cased farmer name (12sp) or 'Unknown Farmer', 'Requested for ₦<amount>'
 * beneath it (10sp grey), and on the right the relative submission time (10sp
 * grey) over a status pill (11sp w600, `resolveStatus` at 14%). Empty state:
 * 'No financing requests found.'
 *
 * Two fixes:
 *
 *  1. The screen never requested page 2. `FinancingHistoryController` had
 *     working pagination; nothing called it, so an agent saw at most 20
 *     requests ever. The list pages on scroll.
 *  2. The four tabs filtered one already-fetched page client-side, so
 *     "Approved" showed only the approved requests that happened to land in
 *     that page. `status` is a server-side filter, so each tab is its own
 *     query — which is also why 'Denied' maps to the single value the backend
 *     stores (`rejected`) rather than Dart's `'rejected' || 'denied'` guess.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { FINANCING_STATUS_TABS } from '../../../core/api/domainConstants';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatNaira, formatRelativeTime, titleCase } from '../../../core/utils/format';
import { PersonAvatarPlaceholder } from '../../auth/components/FieldIcons';
import { EmptyState } from '../components/EmptyState';
import { statusTint } from '../components/statusTint';
import { useFinancingHistory } from '../hooks/useFinancing';
import type { FinancingHistoryItem } from '../model/financing';

export interface FinancingHistoryScreenProps {
  cooperativeId: string;
}

export function FinancingHistoryScreen({
  cooperativeId,
}: FinancingHistoryScreenProps) {
  const router = useRouter();
  const [tabIndex, setTabIndex] = useState(0);

  const activeTab = FINANCING_STATUS_TABS[tabIndex] ?? FINANCING_STATUS_TABS[0];

  const {
    items,
    isLoading,
    isRefetching,
    hasNextPage,
    loadMore,
    refresh,
  } = useFinancingHistory(cooperativeId, { status: activeTab.value });

  return (
    <AppSkeleton
      isBusy={isLoading && items.length === 0}
      appBarTitle="Financing History"
      bodyPadding={styles.noPadding}
    >
      <View style={styles.tabBar}>
        {FINANCING_STATUS_TABS.map((tab, index) => {
          const selected = index === tabIndex;
          return (
            <Pressable
              key={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTabIndex(index)}
              style={[styles.tab, selected && styles.tabSelected]}
              testID={`financing-tab-${tab.label.toLowerCase()}`}
            >
              <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.listWrap}>
        <FlashList
          data={items}
          keyExtractor={(item: FinancingHistoryItem) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }: { item: FinancingHistoryItem }) => (
            <FinancingRow
              item={item}
              onPress={() => router.push(routes.financingDetails(item.id))}
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            !isLoading ? <EmptyState text="No financing requests found." /> : null
          }
          ListFooterComponent={
            hasNextPage ? (
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

function FinancingRow({
  item,
  onPress,
}: {
  item: FinancingHistoryItem;
  onPress: () => void;
}) {
  const tint = statusTint(item.status);
  const name = item.farmerName ? titleCase(item.farmerName) : 'Unknown Farmer';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatNaira(item.amount, { decimals: false })}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <PersonAvatarPlaceholder size={56} />

      <View style={{ width: r(12) }} />

      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ height: h(6) }} />
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {`Requested for ${formatNaira(item.amount, { decimals: false })}`}
        </Text>
      </View>

      <View style={styles.rowTrailing}>
        <Text style={styles.rowTime}>{formatRelativeTime(item.date)}</Text>
        <View style={{ height: h(6) }} />
        <View style={[styles.pill, { backgroundColor: tint.backgroundColor }]}>
          {/*
            The Dart parser defaulted an absent status to 'Approved'. It can be
            null here, so an unknown status renders as an em-dash rather than
            claiming the request was approved.
          */}
          <Text style={[styles.pillText, { color: tint.color }]}>
            {item.status ? titleCase(item.status) : '—'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  noPadding: {
    paddingHorizontal: 0,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    // Dart: dividerColor Colors.grey.shade200
    borderBottomColor: '#EEEEEE',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: r(14),
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabSelected: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    color: colors.grey,
  },
  tabLabelSelected: {
    color: colors.primary,
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: r(16),
    paddingVertical: r(10),
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(12),
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
  },
  rowSubtitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(10),
    color: colors.grey,
  },
  rowTrailing: {
    alignItems: 'flex-end',
    marginLeft: r(8),
  },
  rowTime: {
    ...textTheme.bodyMedium,
    fontSize: spMin(10),
    color: colors.grey,
  },
  pill: {
    paddingHorizontal: r(10),
    paddingVertical: r(4),
    borderRadius: r(20),
  },
  pillText: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  footer: {
    paddingVertical: r(20),
    alignItems: 'center',
  },
});
