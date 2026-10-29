/**
 * Production Yields — ported from
 * modules/farmers/presentation/view/production_yields_view.dart
 *
 * A card per record: a tinted grass icon, the season upper-cased in primary,
 * `'Crop: <crop>'`, then `'Yield: <n> tons'` or `'Expected: <n> tons'`, and a
 * chevron. 'Add Record' sits at the bottom. Empty: 'No seasonal yield records
 * found.'
 *
 * Fixes:
 *  - The Dart screen rendered its title twice (AppSkeleton + an in-body Row).
 *  - It fetched every production the agent owned and filtered client-side
 *    (`where((r) => r.farmerId == farmerId)`), which also meant page 2 never
 *    loaded. The request is scoped with `?farmerId=` and paginated.
 */
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { EmptyState } from '../components/EmptyState';
import { useFarmerProductions } from '../hooks/useProductions';
import type { ProductionYield } from '../model/productionYield';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

export interface ProductionYieldsScreenProps {
  /** Optional override; normally the `/farmers/[id]/yields` route param. */
  farmerId?: string;
}

export function ProductionYieldsScreen(props: ProductionYieldsScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = props.farmerId ?? params.id ?? '';

  const { items, isLoading, isRefetching, hasNextPage, loadMore, refresh } =
    useFarmerProductions(farmerId);

  return (
    <AppSkeleton
      appBarTitle="Production Yields"
      isBusy={isLoading && items.length === 0}
      bottomBar={
        <View style={styles.bottomBar}>
          <AppButton
            text="Add Record"
            onPress={() => router.push(farmersRoutes.recordYields(farmerId))}
            testID="yields-add"
          />
        </View>
      }
    >
      <View style={{ height: h(24) }} />

      <FlashList
        data={items}
        keyExtractor={(item) => item.id}
        estimatedItemSize={96}
        ItemSeparatorComponent={() => <View style={{ height: h(12) }} />}
        renderItem={({ item }) => (
          <ProductionYieldCard
            production={item}
            onPress={() =>
              router.push(farmersRoutes.productionYieldDetails(item.id))
            }
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
          !isLoading ? <EmptyState text="No seasonal yield records found." /> : null
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
  );
}

/** `_ProductionYieldCard` */
function ProductionYieldCard({
  production,
  onPress,
}: {
  production: ProductionYield;
  onPress: () => void;
}) {
  const yieldLine =
    production.actualYieldTonnes != null
      ? `Yield: ${production.actualYieldTonnes} tons`
      : production.expectedYieldTonnes != null
        ? `Expected: ${production.expectedYieldTonnes} tons`
        : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${production.season}, ${production.crop}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.iconCircle}>
        <Text accessible={false} style={styles.icon}>
          🌾
        </Text>
      </View>

      <View style={styles.cardText}>
        <Text style={styles.season}>{production.season.toUpperCase()}</Text>
        <View style={{ height: h(4) }} />
        <Text style={styles.crop}>{`Crop: ${production.crop}`}</Text>
        {yieldLine ? (
          <>
            <View style={{ height: h(2) }} />
            <Text style={styles.yield}>{yieldLine}</Text>
          </>
        ) : null}
      </View>

      <Text accessible={false} style={styles.chevron}>
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: r(16),
    backgroundColor: colors.white,
    borderRadius: r(16),
    borderWidth: 1,
    // AppColors.grey @ 20%
    borderColor: 'rgba(107, 114, 128, 0.2)',
  },
  cardPressed: {
    opacity: 0.8,
  },
  iconCircle: {
    width: r(44),
    height: r(44),
    borderRadius: r(44),
    alignItems: 'center',
    justifyContent: 'center',
    // AppColors.primary @ 10%
    backgroundColor: 'rgba(46, 139, 87, 0.1)',
  },
  icon: {
    fontSize: spMin(18),
  },
  cardText: {
    flex: 1,
    marginLeft: r(16),
  },
  season: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.primary,
  },
  crop: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
  },
  yield: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.grey,
  },
  chevron: {
    fontSize: spMin(22),
    color: colors.grey,
  },
  bottomBar: {
    paddingHorizontal: r(16),
    paddingTop: r(16),
    paddingBottom: r(16),
    backgroundColor: colors.background,
  },
  footer: {
    paddingVertical: r(16),
    alignItems: 'center',
  },
});
