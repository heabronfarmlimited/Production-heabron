/**
 * Farmers list — ported from
 * modules/farmers/presentation/view/farmers_view.dart
 *
 * Layout from Dart: a pinned app bar titled 'Farmers' (24sp w700) with
 * notification and profile actions, a 'Search farmers' field with a search
 * prefix beside a filter button, then the `FarmerScoreTile` rows with infinite
 * scroll, and `Icons.person_off_outlined` + 'No farmers found' when empty.
 *
 * Fixes:
 *  - Search was wired straight to `setFilters(search:)` on every keystroke,
 *    and `setFilters` assigned all four filter fields, so typing in search
 *    silently cleared the LGA, tier and cooperative filters. Search is now
 *    debounced and merged into the filter state.
 *  - The filter sheet's Tier field was free text hinted 'e.g. A, B' while
 *    `listQuery.tier` is `valid('A','B','C','D')`, so anything else 422'd. It
 *    is a four-option picker.
 *  - The pending-upload queue is surfaced here, with auto-sync on reconnect.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { SearchIcon } from '../../auth/components/FieldIcons';
import { EmptyState, PersonOffIcon } from '../components/EmptyState';
import { FarmerScoreTile } from '../components/FarmerScoreTile';
import { useFarmers, type FarmerFilters } from '../hooks/useFarmers';
import { useOfflineFarmerQueue } from '../hooks/useOfflineFarmerQueue';
import { pendingFarmerName } from '../model/pendingFarmer';
import { farmersRoutes } from '../navigation';

import { FarmerFilterSheet } from './FarmerFilterSheet';

/** The Dart field fired on every character; 400ms keeps the list usable. */
const SEARCH_DEBOUNCE_MS = 400;

export function FarmersScreen() {
  const router = useRouter();

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<FarmerFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);

  // Debounced search, merged into (not replacing) the other filters.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) =>
        prev.search === searchInput.trim()
          ? prev
          : { ...prev, search: searchInput.trim() },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const {
    items,
    isLoading,
    isRefetching,
    hasNextPage,
    loadMore,
    refresh,
  } = useFarmers(filters);

  const queue = useOfflineFarmerQueue();

  return (
    <>
      <AppSkeleton
        // Only the very first load blocks; a refresh must not cover the list.
        isBusy={isLoading && items.length === 0}
        backgroundColor={colors.background}
      >
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.screenTitle}>
            Farmers
          </Text>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              hitSlop={8}
              onPress={() => router.push(routes.notifications)}
            >
              <Text style={styles.actionGlyph}>🔔</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profile"
              hitSlop={8}
              onPress={() => router.push(routes.profile)}
            >
              <Text style={styles.actionGlyph}>👤</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <AppTextField
              hintText="Search farmers"
              prefix={<SearchIcon />}
              value={searchInput}
              onChangeText={setSearchInput}
              autoCapitalize="none"
              testID="farmers-search"
            />
          </View>

          <View style={{ width: r(8) }} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter farmers"
            onPress={() => setFilterOpen(true)}
            style={styles.filterButton}
            testID="farmers-filter"
          >
            <Text style={styles.filterGlyph}>⚙</Text>
          </Pressable>
        </View>

        {queue.pending.length > 0 ? (
          <PendingUploadsBanner
            count={queue.pending.length}
            names={queue.pending.map(pendingFarmerName)}
            isSyncing={queue.isSyncing}
            onSync={() => void queue.syncAll()}
          />
        ) : null}

        <View style={{ height: h(20) }} />

        <FlashList
          data={items}
          keyExtractor={(item) => item.id}
          estimatedItemSize={72}
          renderItem={({ item }) => (
            <FarmerScoreTile
              farmer={item}
              onPress={() => router.push(farmersRoutes.details(item.id))}
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            !isLoading ? (
              <EmptyState text="No farmers found" icon={<PersonOffIcon />} />
            ) : null
          }
          ListFooterComponent={
            hasNextPage ? (
              <View style={styles.footer}>
                <AppLoading color={colors.primary} />
              </View>
            ) : null
          }
        />
      </AppSkeleton>

      <FarmerFilterSheet
        visible={filterOpen}
        filters={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          // Preserve the live search term; only the sheet's three fields change.
          setFilters((prev) => ({ ...prev, ...next }));
          setFilterOpen(false);
        }}
        onClear={() => {
          setSearchInput('');
          setFilters({});
          setFilterOpen(false);
        }}
      />
    </>
  );
}

/**
 * Pending offline uploads.
 *
 * The Flutter equivalent lived on the cooperative details screen only, with
 * the copy 'Farmers saved offline will be uploaded automatically when online.'
 * and a 'Sync Now' button — but auto-sync never ran because
 * `FarmersController.init()` was never called, so that sentence was false. It
 * is now true, and the queue is visible from the farmers tab where the records
 * were created.
 */
function PendingUploadsBanner({
  count,
  names,
  isSyncing,
  onSync,
}: {
  count: number;
  names: string[];
  isSyncing: boolean;
  onSync: () => void;
}) {
  return (
    <View style={styles.banner}>
      <View style={styles.bannerText}>
        <Text style={styles.bannerTitle}>
          {`Pending Uploads (${count})`}
        </Text>
        <Text style={styles.bannerBody}>
          Farmers saved offline will be uploaded automatically when online.
        </Text>
        <Text style={styles.bannerNames} numberOfLines={2}>
          {names.join(', ')}
        </Text>
      </View>

      {isSyncing ? (
        <AppLoading color={colors.primary} />
      ) : (
        <AppButton
          text="Sync Now"
          isOutlined
          outlineColor={colors.primary}
          textColor={colors.primary}
          height={36}
          width={r(104)}
          fullWidth={false}
          padding={6}
          onPress={onSync}
          testID="farmers-sync-now"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: r(56),
  },
  screenTitle: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(16),
  },
  actionGlyph: {
    fontSize: spMin(18),
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchField: {
    flex: 1,
  },
  filterButton: {
    padding: r(12),
    backgroundColor: colors.white,
    borderRadius: r(8),
    borderWidth: 1,
    borderColor: colors.secondary200,
  },
  filterGlyph: {
    fontSize: spMin(18),
    color: colors.primary,
  },
  footer: {
    paddingVertical: r(16),
    alignItems: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: r(16),
    padding: r(14),
    borderRadius: r(12),
    backgroundColor: colors.secondary100,
  },
  bannerText: {
    flex: 1,
    marginRight: r(12),
  },
  bannerTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  bannerBody: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
    marginTop: r(2),
  },
  bannerNames: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondary400,
    marginTop: r(4),
  },
});
