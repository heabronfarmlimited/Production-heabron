/**
 * Cooperatives tab — ported from .../view/cooperatives_view.dart
 *
 * Dart layout: a 'Cooperatives' title (24sp w700) with notification and
 * profile icon buttons on the right, a `'Search cooperatives'` field with a
 * search prefix, 20 space, the list, and a primary circular FAB that opens
 * `CreateCooperativeView`. Rows are `CooperativeListItem`s showing
 * `name.toTitleCase()` over `'<Lga>, <State>'`, both title-cased. Empty state:
 * `'No cooperatives found'`.
 *
 * Two fixes:
 *
 *  1. The Dart search field was a `const AppTextField` with no controller and
 *     no `onChanged` — typing in it did nothing at all. It filters now, with a
 *     debounce so one request lands per pause rather than per keystroke.
 *  2. The list reached the screen through `CooperativesListener`, a
 *     `ValueListenableBuilder` over the Hive box that the repository wrote to
 *     as a side effect of fetching. Pull-to-refresh also kicked off an
 *     unrelated `farmersProvider.fetchFarmers()`. Both are gone.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { titleCase } from '../../../core/utils/format';
import { SearchIcon } from '../../auth/components/FieldIcons';
import { CooperativeListItem } from '../components/CooperativeListItem';
import { EmptyState } from '../components/EmptyState';
import { useCooperatives } from '../hooks/useCooperatives';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { cooperativeLocation, type Cooperative } from '../model/cooperative';

export function CooperativesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const {
    items,
    isLoading,
    isRefetching,
    hasNextPage,
    loadMore,
    refresh,
  } = useCooperatives({ search: debouncedSearch.trim() });

  return (
    <AppSkeleton
      // Only the first load blocks; a refresh must not cover the list.
      isBusy={isLoading && items.length === 0}
      backgroundColor={colors.background}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Cooperatives</Text>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            style={styles.iconButton}
            onPress={() => router.push(routes.notifications)}
          >
            <Text style={styles.icon}>🔔</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile"
            hitSlop={8}
            style={styles.iconButton}
            onPress={() => router.push(routes.profile)}
          >
            <Text style={styles.icon}>👤</Text>
          </Pressable>
        </View>
      </View>

      <AppTextField
        hintText="Search cooperatives"
        prefix={<SearchIcon />}
        autoCapitalize="none"
        value={search}
        onChangeText={setSearch}
        testID="cooperatives-search"
      />

      <View style={{ height: h(20) }} />

      <View style={styles.listWrap}>
        <FlashList
          data={items}
          keyExtractor={(item: Cooperative) => item.id}
          estimatedItemSize={r(75)}
          renderItem={({ item }: { item: Cooperative }) => (
            <CooperativeListItem
              name={titleCase(item.name)}
              location={cooperativeLocation({
                ...item,
                lga: titleCase(item.lga),
                state: titleCase(item.state),
              })}
              logoUrl={item.logoUrl}
              onPress={() => router.push(routes.cooperativeDetails(item.id))}
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
            !isLoading ? <EmptyState text="No cooperatives found" glyph="🏘" /> : null
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add cooperative"
        onPress={() => router.push(routes.cooperativeCreate)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        testID="cooperatives-add"
      >
        <Text style={styles.fabIcon}>＋</Text>
      </Pressable>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(24),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: r(8),
  },
  icon: {
    fontSize: spMin(20),
  },
  listWrap: {
    flex: 1,
  },
  footer: {
    paddingVertical: r(20),
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: r(16),
    bottom: r(24),
    width: r(56),
    height: r(56),
    borderRadius: r(56),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabIcon: {
    color: colors.white,
    fontSize: spMin(28),
    lineHeight: spMin(32),
  },
});
