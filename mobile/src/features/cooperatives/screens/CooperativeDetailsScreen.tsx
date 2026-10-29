/**
 * Cooperative detail — ported from .../view/cooperative_details_view.dart
 * (`cooperative_details_view`)
 *
 * Dart layout, top to bottom: a pinned app bar titled 'Cooperative Detail'
 * (16sp w500) with a back button and a `more_vert` action; a header row with a
 * 67r logo, the title-cased name over '<Lga>, <State>' in primary, and a
 * right-aligned 'Coop Tier' readout coloured by `resolveCoopTier`; the
 * 'Pending Uploads' box; 'Crop Types' and its chips (or 'No crops specified');
 * two `StatPill`s; 'Actions' with 'Add Farmer' and 'Request Financing'; a
 * 'Farmers' / 'View All' row; then the farmer list, which scrolls infinitely
 * and shows 'No farmers found for this cooperative' when empty.
 *
 * Fixes in this screen:
 *
 *  - It force-cast `settings.arguments! as Cooperative` in `initState`, in
 *    `_onScroll` and again in `build`, so any entry without that argument threw.
 *    It takes an id and reads the record through `useCooperative`.
 *  - `isBusy` watched `cooperativesProvider` — the *list* controller — so the
 *    overlay appeared while the list refreshed and never while this screen's
 *    own data loaded.
 *  - 'View All' was a plain `Text` with no handler: a dead affordance.
 *  - The `Export Data` row's body was commented out, making it a no-op.
 *  - The `Edit Cooperative` row navigated without closing the sheet first, so
 *    the sheet was still up on return.
 *  - `Delete Cooperative` and its confirmation sheet were commented out.
 *
 * NOT PORTED — the 'Pending Uploads' box and its 'Sync Now' button. Both read
 * `farmersProvider.pendingFarmers` / `syncAll`, the offline queue owned by the
 * farmers module, whose hooks do not exist yet. See build_cooperatives.md.
 */
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppLoading } from '../../../components/AppLoading';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { resolveCoopTierColor, titleCase } from '../../../core/utils/format';
import { useAuthStore } from '../../auth/model/authStore';
import type { Farmer } from '../../farmers/model/farmer';
import { BottomSheet } from '../components/BottomSheet';
import { DeleteCooperativeSheet } from '../components/DeleteCooperativeSheet';
import { EmptyState } from '../components/EmptyState';
import { FarmerScoreTile } from '../components/FarmerScoreTile';
import { OptionsRow } from '../components/OptionsRow';
import { StatPill } from '../components/StatPill';
import { useCooperativeExport } from '../hooks/useCooperativeExport';
import {
  useCooperative,
  useCooperativeFarmers,
  useDeleteCooperative,
} from '../hooks/useCooperatives';
import {
  cooperativeFarmerCount,
  cooperativeLocation,
} from '../model/cooperative';

/** Dart: `bgColor: Color.fromRGBO(242, 255, 246, 1)` on 'Request Financing'. */
const REQUEST_FINANCING_BG = 'rgb(242, 255, 246)';

export interface CooperativeDetailsScreenProps {
  id: string;
}

export function CooperativeDetailsScreen({ id }: CooperativeDetailsScreenProps) {
  const router = useRouter();
  const agentName = useAuthStore((s) => s.user?.fullName);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    data: cooperative,
    isLoading: loadingCooperative,
    isError,
    isRefetching: refetchingCooperative,
    refetch: refetchCooperative,
  } = useCooperative(id);

  const {
    items: farmers,
    isLoading: loadingFarmers,
    isRefetching: refetchingFarmers,
    hasNextPage,
    loadMore,
    refresh: refreshFarmers,
  } = useCooperativeFarmers(id);

  const { exportData, exporting } = useCooperativeExport(cooperative);
  const { mutate: remove, isPending: deleting } = useDeleteCooperative();

  if (isError) {
    return (
      <AppSkeleton appBarTitle="Cooperative Detail">
        <EmptyState text="Could not load this cooperative." />
      </AppSkeleton>
    );
  }

  const refreshAll = () => {
    void refetchCooperative();
    refreshFarmers();
  };

  const closeOptions = () => setOptionsOpen(false);

  const header = cooperative ? (
    <View>
      {/* ── Header ─────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <View style={styles.logo}>
          {cooperative.logoUrl ? (
            <Image
              source={{ uri: cooperative.logoUrl }}
              style={styles.logoImage}
              contentFit="cover"
              transition={150}
            />
          ) : null}
        </View>

        <View style={{ width: r(8) }} />

        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={4}>
            {titleCase(cooperative.name)}
          </Text>
          <Text style={styles.location} numberOfLines={2}>
            {cooperativeLocation({
              ...cooperative,
              lga: titleCase(cooperative.lga),
              state: titleCase(cooperative.state),
            })}
          </Text>
        </View>

        <View style={styles.tierBlock}>
          <Text style={styles.tierLabel}>Coop Tier</Text>
          <Text
            style={[
              styles.tierValue,
              { color: resolveCoopTierColor(cooperative.cooperativeTier) },
            ]}
          >
            {titleCase(cooperative.cooperativeTier)}
          </Text>
        </View>
      </View>

      <View style={{ height: h(16) }} />

      {/* ── Crop types ─────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Crop Types</Text>

      <View style={{ height: h(10) }} />

      {cooperative.cropsSupported.length > 0 ? (
        <View style={styles.chips}>
          {cooperative.cropsSupported.map((crop) => (
            <View key={crop} style={styles.chip}>
              <Text style={styles.chipText}>{titleCase(crop)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.body}>No crops specified</Text>
      )}

      <View style={{ height: h(29) }} />

      {/* ── Stats ──────────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <StatPill
            title="Land Size"
            value={`${cooperative.estimatedLandSize} Acres`}
          />
        </View>
        <View style={{ width: r(12) }} />
        <View style={styles.statCell}>
          {/*
            Dart showed `total_members`, a denormalised column the backend
            seeds to 0 on create and never updates, so this always read '0'.
            `stats.farmers` is the live count from GET /cooperatives/:id.
          */}
          <StatPill title="Farmers" value={`${cooperativeFarmerCount(cooperative)}`} />
        </View>
      </View>

      <View style={{ height: h(20) }} />

      {/* ── Actions ────────────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>Actions</Text>

      <View style={{ height: h(10) }} />

      <View style={styles.actionsRow}>
        <View style={styles.actionCell}>
          <AppButton
            text="Add Farmer"
            height={44}
            borderRadius={4}
            onPress={() =>
              router.push({
                pathname: routes.farmerAdd,
                params: { cooperativeId: cooperative.id },
              })
            }
            testID="cooperative-add-farmer"
          />
        </View>

        <View style={{ width: r(12) }} />

        <View style={styles.actionCell}>
          <AppButton
            text="Request Financing"
            height={44}
            borderRadius={4}
            isOutlined
            textColor={colors.primary}
            outlineColor={colors.primary}
            bgColor={REQUEST_FINANCING_BG}
            onPress={() => router.push(routes.financingRequest(cooperative.id))}
            testID="cooperative-request-financing"
          />
        </View>
      </View>

      <View style={{ height: h(20) }} />

      {/* ── Farmers heading ───────────────────────────────────── */}
      <View style={styles.farmersHeader}>
        <Text style={styles.farmersTitle}>Farmers</Text>

        {/*
          FIXED — 'View All' was a plain Text with no gesture handler. It opens
          the Farmers tab now. NOTE: once that tab accepts a `cooperativeId`
          query param it should be passed through, so the list lands filtered
          to this cooperative.
        */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="View all farmers"
          hitSlop={8}
          onPress={() => router.push(routes.farmersTab)}
          testID="cooperative-view-all-farmers"
        >
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>

      <View style={{ height: h(12) }} />
    </View>
  ) : null;

  return (
    <AppSkeleton
      isBusy={loadingCooperative && !cooperative}
      appBarTitle="Cooperative Detail"
      appBarActions={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cooperative actions"
          hitSlop={8}
          style={styles.moreButton}
          onPress={() => setOptionsOpen(true)}
          testID="cooperative-options"
        >
          <Text style={styles.moreIcon}>⋮</Text>
        </Pressable>
      }
    >
      <FlashList
        data={farmers}
        keyExtractor={(item: Farmer) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }: { item: Farmer }) => (
          <FarmerScoreTile
            farmer={item}
            onPress={() => router.push(routes.farmerDetails(item.id))}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refetchingCooperative || refetchingFarmers}
            onRefresh={refreshAll}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          loadingFarmers ? (
            <View style={styles.footer}>
              <AppLoading color={colors.primary} />
            </View>
          ) : (
            <EmptyState text="No farmers found for this cooperative" fill={false} />
          )
        }
        ListFooterComponent={
          <View>
            {hasNextPage ? (
              <View style={styles.footer}>
                <AppLoading color={colors.primary} />
              </View>
            ) : null}
            <View style={{ height: h(40) }} />
          </View>
        }
      />

      {/* ── Options sheet ──────────────────────────────────────── */}
      <BottomSheet
        visible={optionsOpen}
        onClose={closeOptions}
        title="Cooperative actions"
        subtitle="Choose an action to manage this cooperative."
      >
        <OptionsRow
          icon={<Text style={styles.rowIcon}>↗</Text>}
          label="Export Data"
          subtitle="Download or share cooperative records"
          disabled={exporting || !cooperative}
          onPress={() => {
            closeOptions();
            void exportData();
          }}
          testID="cooperative-export"
        />

        <OptionsRow
          icon={<Text style={styles.rowIcon}>⤓</Text>}
          label="Import Bulk Farmers"
          subtitle="Import farmers data from csv"
          onPress={() => {
            closeOptions();
            router.push({
              pathname: routes.farmerBulkUpload,
              // Dart passed the whole Cooperative here and the receiving
              // screen's read of it was commented out, so the CSV import ran
              // with an empty cooperativeId.
              params: { cooperativeId: id },
            });
          }}
        />

        <OptionsRow
          icon={<Text style={styles.rowIcon}>🕘</Text>}
          label="Financing History"
          subtitle="View all financing activities and status"
          onPress={() => {
            closeOptions();
            router.push(routes.financingHistory(id));
          }}
        />

        <OptionsRow
          icon={<Text style={styles.rowIcon}>✎</Text>}
          label="Edit Cooperative"
          subtitle="Update cooperative details"
          onPress={() => {
            // Dart navigated without popping the sheet first.
            closeOptions();
            router.push(routes.cooperativeEdit(id));
          }}
        />

        <OptionsRow
          icon={<Text style={[styles.rowIcon, styles.deleteIcon]}>🗑</Text>}
          label="Delete Cooperative"
          subtitle="Remove this cooperative permanently"
          labelColor={colors.failure}
          iconColor={colors.failure}
          onPress={() => {
            closeOptions();
            setDeleteOpen(true);
          }}
          testID="cooperative-delete"
        />

        <View style={{ height: h(16) }} />
      </BottomSheet>

      <DeleteCooperativeSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        agentFullName={agentName}
        deleting={deleting}
        onConfirm={() =>
          remove(id, {
            onSuccess: () => {
              setDeleteOpen(false);
              // The record is gone; returning to the list is the only valid
              // destination.
              router.replace(routes.cooperativesTab);
            },
          })
        }
      />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: r(67),
    height: r(67),
    borderRadius: r(67),
    backgroundColor: colors.secondary100,
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  headerText: {
    flex: 1,
  },
  name: {
    ...textTheme.headlineMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  location: {
    ...textTheme.bodySmall,
    fontSize: spMin(14),
    color: colors.primary,
  },
  tierBlock: {
    alignItems: 'flex-end',
    marginLeft: r(8),
  },
  tierLabel: {
    ...textTheme.headlineMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    textAlign: 'right',
  },
  tierValue: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    textAlign: 'right',
  },
  sectionLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  body: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: r(8),
  },
  chip: {
    paddingHorizontal: r(12),
    paddingVertical: r(6),
    borderRadius: r(8),
    // Dart: AppColors.primary.withValues(alpha: 0.15)
    backgroundColor: 'rgba(46, 139, 87, 0.15)',
  },
  chipText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.primary,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statCell: {
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionCell: {
    flex: 1,
  },
  farmersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  farmersTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
  },
  viewAll: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.primary,
  },
  footer: {
    paddingVertical: r(16),
    alignItems: 'center',
  },
  moreButton: {
    paddingHorizontal: r(8),
    paddingVertical: r(4),
  },
  moreIcon: {
    fontSize: spMin(22),
    color: colors.black,
  },
  rowIcon: {
    fontSize: spMin(18),
    color: colors.primary,
  },
  deleteIcon: {
    color: colors.failure,
  },
});
