/**
 * Activities tab root — ported from
 * modules/activities/presentation/view/activities_view.dart
 *
 * Layout from Dart: 20 space, 'Activities' (24sp w700), 20 space, the search
 * field (hint 'Search activities...', `Icons.search` prefix), the tab bar, and
 * the tab body. Tabs are exactly `['All', 'Deliveries', 'Repayments', 'Imports']`.
 *
 * Two things change here.
 *
 * FIXED — search is debounced by ~350 ms. The Dart field called
 * `setState(() => _search = value)` on every keystroke, re-running the filter
 * and rebuilding every loaded row per character.
 *
 * NEW — the 'Deliveries' tab is implemented. In Flutter it was a hardcoded
 * `const _EmptyState(message: 'No deliveries found')` with no repository and
 * no endpoint call, even though `GET /agent/deliveries` exists and is scoped
 * to the signed-in agent. Deliveries now also appear in the 'All' feed, which
 * they never did before.
 *
 * FIXED — paging. The Dart controller advanced its page counter only while
 * more pages remained, so the last page was re-fetched on every further scroll
 * and appended duplicates; and `activitiesProvider` was not autoDispose, so
 * the accumulated lists survived leaving the tab.
 */
import { FlashList } from '@shopify/flash-list';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { SearchIcon } from '../../auth/components/FieldIcons';
import { ActivityCardFor } from '../components/ActivityCard';
import { ActivityTabs } from '../components/ActivityTabs';
import { EmptyState } from '../components/EmptyState';
import { useDeliveries, useImports, useRepayments } from '../hooks/useActivities';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { filterImports } from '../model/agentImport';
import { filterRepayments } from '../model/agentRepayment';
import {
  deliveryActivity,
  filterCombined,
  importActivity,
  repaymentActivity,
  sortByDateDesc,
  type CombinedActivity,
} from '../model/combinedActivity';

/** The four tabs, verbatim from Dart. */
const TABS = ['All', 'Deliveries', 'Repayments', 'Imports'] as const;
type Tab = (typeof TABS)[number];

export function ActivitiesScreen() {
  const [tab, setTab] = useState<Tab>('All');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);

  // All three load eagerly, as the Dart `fetchAll` did on the post-frame
  // callback — the 'All' tab is the default and needs every list.
  const repayments = useRepayments();
  const imports = useImports();
  const deliveries = useDeliveries();

  const isInitialLoad =
    (repayments.isLoading || imports.isLoading || deliveries.isLoading) &&
    repayments.items.length === 0 &&
    imports.items.length === 0 &&
    deliveries.items.length === 0;

  /** The merged, newest-first feed behind the 'All' tab. */
  const allActivities = useMemo(() => {
    const merged: CombinedActivity[] = [
      ...repayments.items.map(repaymentActivity),
      ...imports.items.map(importActivity),
      ...deliveries.items.map(deliveryActivity),
    ];
    return sortByDateDesc(merged);
  }, [repayments.items, imports.items, deliveries.items]);

  const rows = useMemo<CombinedActivity[]>(() => {
    switch (tab) {
      case 'Repayments':
        return filterRepayments(repayments.items, search).map(repaymentActivity);
      case 'Imports':
        return filterImports(imports.items, search).map(importActivity);
      case 'Deliveries':
        return filterCombined(deliveries.items.map(deliveryActivity), search);
      default:
        return filterCombined(allActivities, search);
    }
  }, [tab, search, repayments.items, imports.items, deliveries.items, allActivities]);

  const active =
    tab === 'Repayments'
      ? repayments
      : tab === 'Imports'
        ? imports
        : tab === 'Deliveries'
          ? deliveries
          : null;

  const emptyMessage =
    tab === 'Repayments'
      ? 'No repayments found'
      : tab === 'Imports'
        ? 'No imports found'
        : tab === 'Deliveries'
          ? 'No deliveries found'
          : 'No activities found';

  const isRefetching = active
    ? active.isRefetching
    : repayments.isRefetching || imports.isRefetching || deliveries.isRefetching;

  const isLoadingTab = active
    ? active.isLoading
    : repayments.isLoading || imports.isLoading || deliveries.isLoading;

  const hasMore = active
    ? active.hasNextPage || active.isFetchingNextPage
    : repayments.hasNextPage ||
      imports.hasNextPage ||
      deliveries.hasNextPage ||
      repayments.isFetchingNextPage ||
      imports.isFetchingNextPage ||
      deliveries.isFetchingNextPage;

  /** 'All' pages every underlying list; a single tab pages only its own. */
  const loadMore = () => {
    if (active) {
      active.loadMore();
      return;
    }
    repayments.loadMore();
    imports.loadMore();
    deliveries.loadMore();
  };

  const refresh = () => {
    if (active) {
      active.refresh();
      return;
    }
    repayments.refresh();
    imports.refresh();
    deliveries.refresh();
  };

  return (
    <AppSkeleton isBusy={isInitialLoad} backgroundColor={colors.background}>
      <View style={{ height: h(20) }} />

      <Text style={styles.heading}>Activities</Text>

      <View style={{ height: h(20) }} />

      <AppTextField
        hintText="Search activities..."
        prefix={<SearchIcon />}
        value={searchInput}
        onChangeText={setSearchInput}
        autoCapitalize="none"
        testID="activities-search"
      />

      <ActivityTabs tabs={TABS} value={tab} onChange={setTab} />

      <View style={styles.listWrap}>
        <FlashList
          data={rows}
          keyExtractor={(row) => `${row.kind}-${row.key}`}
          estimatedItemSize={r(92)}
          getItemType={(row) => row.kind}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <ActivityCardFor activity={item} />}
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
            isLoadingTab ? null : (
              <View style={styles.emptyWrap}>
                <EmptyState message={emptyMessage} />
              </View>
            )
          }
          ListFooterComponent={
            hasMore ? (
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
  heading: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  listWrap: {
    flex: 1,
  },
  listContent: {
    // Dart: `EdgeInsets.symmetric(vertical: 16).r`
    paddingVertical: r(16),
  },
  emptyWrap: {
    // FlashList gives the empty component no height of its own.
    height: h(320),
  },
  footer: {
    paddingVertical: r(16),
    alignItems: 'center',
  },
});
