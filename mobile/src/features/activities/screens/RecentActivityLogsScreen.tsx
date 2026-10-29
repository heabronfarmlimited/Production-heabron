/**
 * Activity logs — ported from
 * modules/dashboard/presentation/view/recent_activity_logs_view.dart
 *
 * Layout from Dart: 20 space, a header row with a 36r bordered back box
 * (`arrow_back_ios_new`, radius 10, `grey @ 15%` border) and 'Activity Logs'
 * (20sp w700) 16 apart, 16 space, the search field (hint 'Search logs...',
 * `Icons.search` prefix), 16 space, then the `'{n} log{s}'` count at 11sp grey
 * and the list.
 *
 * Empty states, both verbatim:
 *   no data            `assignment_late_outlined` + 'No activity logs found'
 *   no search results  `search_off`               + 'No results for "{search}"'
 *
 * Rows render exactly as Dart did:
 *   title    action.replaceAll('_', ' ').toTitleCase()
 *   subtitle ipAddress ?? 'N/A'
 *   time     formatDateAndTime(createdAt ?? now)
 *
 * FIXED — search is debounced (~350 ms); the Dart field re-filtered on every
 * keystroke. The screen also fetches its own data: the Dart version rendered
 * out of the Hive cache that `DashboardController` wrote, so it was blank
 * until the dashboard had been visited.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatDateAndTime, titleCase } from '../../../core/utils/format';
import { SearchIcon } from '../../auth/components/FieldIcons';
import { BackChevronIcon, SearchOffIcon } from '../components/ActivityIcons';
import { ActivityLogItem } from '../components/ActivityLogItem';
import { EmptyState } from '../components/EmptyState';
import { useActivityLogs } from '../hooks/useActivityLogs';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { filterActivityLogs } from '../model/activityLog';
import { withAlpha } from '../utils/color';

export function RecentActivityLogsScreen() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput);

  const { logs, isLoading, isRefetching, refresh } = useActivityLogs();

  const filtered = useMemo(() => filterActivityLogs(logs, search), [logs, search]);

  const hasQuery = search.trim().length > 0;
  const showCount = filtered.length > 0;

  return (
    <AppSkeleton
      isBusy={isLoading && logs.length === 0}
      backgroundColor={colors.background}
      bodyPadding={styles.bodyPadding}
    >
      <View style={{ height: h(20) }} />

      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backBox}
        >
          <BackChevronIcon color={colors.secondaryBlack600} size={16} />
        </Pressable>
        <Text style={styles.heading}>Activity Logs</Text>
      </View>

      <View style={{ height: h(16) }} />

      <AppTextField
        hintText="Search logs..."
        prefix={<SearchIcon />}
        value={searchInput}
        onChangeText={setSearchInput}
        autoCapitalize="none"
        style={styles.searchField}
        testID="activity-logs-search"
      />

      <View style={{ height: h(16) }} />

      <View style={styles.listWrap}>
        {showCount ? (
          <>
            <Text style={styles.count}>
              {`${filtered.length} log${filtered.length === 1 ? '' : 's'}`}
            </Text>
            <View style={{ height: h(8) }} />
          </>
        ) : null}

        <FlashList
          data={filtered}
          keyExtractor={(item, index) => item.id || `log-${index}`}
          renderItem={({ item }) => (
            <ActivityLogItem
              title={titleCase(item.action)}
              subtitle={item.ipAddress ?? 'N/A'}
              time={formatDateAndTime(item.createdAt ?? new Date().toISOString())}
            />
          )}
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
              <View style={styles.emptyWrap}>
                {hasQuery ? (
                  <EmptyState
                    message={`No results for "${search}"`}
                    icon={<SearchOffIcon color={colors.grey} size={28} />}
                  />
                ) : (
                  <EmptyState message="No activity logs found" />
                )}
              </View>
            )
          }
        />
      </View>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  bodyPadding: {
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: r(16),
  },
  backBox: {
    width: r(36),
    height: r(36),
    borderRadius: r(10),
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: withAlpha(colors.grey, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    ...textTheme.headlineMedium,
    marginLeft: r(16),
    fontSize: spMin(20),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  // Dart put the search field outside the 16 gutter padding, flush to the
  // AppSkeleton's own default body padding.
  searchField: {
    paddingHorizontal: r(16),
  },
  listWrap: {
    flex: 1,
    paddingHorizontal: r(16),
  },
  count: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.grey,
  },
  emptyWrap: {
    height: h(320),
  },
});
