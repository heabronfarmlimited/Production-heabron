/**
 * The farmer's farms — "Add Another Farm" (v2 user flow).
 *
 * No Flutter equivalent: the Dart app assumed one farm per farmer and read
 * `farmProfiles[0]` everywhere. A smallholder commonly works two or three
 * separate plots, often with different crops, and recording them as one farm
 * understated their land — which is the denominator of the production score,
 * so it inflated the score as well.
 *
 * The totals at the top are the server's, not re-derived here: the same
 * figures appear on the lender's report, and two places computing "total
 * land" separately is how they come to disagree.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { SkeletonList } from '../../../components/Skeleton';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { EmptyState } from '../components/EmptyState';
import { InfoCard } from '../components/InfoCard';
import {
  useDeleteFarm,
  useFarmerFarms,
  useSetPrimaryFarm,
} from '../hooks/useFarmerFarms';
import { farmDisplayLabel, type FarmerFarmProfile } from '../model/farmer';

import { useRouteParams } from './routeParams';

export interface FarmerFarmsScreenProps {
  farmerId?: string;
}

export function FarmerFarmsScreen({ farmerId: farmerIdProp }: FarmerFarmsScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = farmerIdProp ?? params.id ?? '';

  const { farms, land, isLoading, refresh, isRefetching } = useFarmerFarms(farmerId);
  const { setPrimary, isPending: settingPrimary } = useSetPrimaryFarm(farmerId);
  const { deleteFarm, isPending: deleting } = useDeleteFarm(farmerId);

  const [pendingDelete, setPendingDelete] = useState<FarmerFarmProfile | null>(null);

  const confirmDelete = () => {
    const farm = pendingDelete;
    if (!farm?.id) return;
    setPendingDelete(null);
    deleteFarm(farm.id);
  };

  return (
    <AppSkeleton
      appBarTitle="Farms"
      appBarLeading={<AuthBackButton />}
      firstLoad={isLoading && farms.length === 0 ? <SkeletonList /> : null}
      bottomBar={
        <View style={styles.bottomBar}>
          <AppButton
            text="Add Another Farm"
            onPress={() => router.push(routes.farmerFarmAdd(farmerId))}
            testID="farm-add"
          />
        </View>
      }
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refresh} />
        }
      >
        {/* Totals — the figures the score and the lender report both use. */}
        <InfoCard>
          <View style={styles.totalsRow}>
            <View style={styles.totalCell}>
              <Text style={styles.totalValue}>
                {land ? `${land.totalLandAcres}` : '—'}
              </Text>
              <Text style={styles.totalLabel}>Total acres</Text>
            </View>
            <View style={styles.totalDivider} />
            <View style={styles.totalCell}>
              <Text style={styles.totalValue}>{farms.length}</Text>
              <Text style={styles.totalLabel}>
                {farms.length === 1 ? 'Farm' : 'Farms'}
              </Text>
            </View>
            <View style={styles.totalDivider} />
            <View style={styles.totalCell}>
              <Text style={styles.totalValue}>
                {land ? `${land.mappedFarmCount}/${land.farmCount}` : '—'}
              </Text>
              <Text style={styles.totalLabel}>Mapped</Text>
            </View>
          </View>

          {land && !land.fullyMapped && land.farmCount > 0 ? (
            <Text style={styles.totalsNote}>
              {`Walking the boundary of the remaining ${
                land.farmCount - land.mappedFarmCount === 1 ? 'farm' : 'farms'
              } replaces the typed acreage with a measured one, which the credit score uses.`}
            </Text>
          ) : null}
        </InfoCard>

        <View style={{ height: h(16) }} />

        {farms.length === 0 ? (
          <EmptyState
            text="No farms recorded"
            hint="This farmer cannot be credit-scored until at least one farm is on file — land size is the denominator of the production score."
          />
        ) : (
          farms.map((farm, index) => (
            <View key={farm.id ?? String(index)}>
              <FarmCard
                farm={farm}
                index={index}
                busy={settingPrimary || deleting}
                canRemove={farms.length > 1}
                onEdit={() =>
                  farm.id && router.push(routes.farmerFarmEdit(farmerId, farm.id))
                }
                onMap={() =>
                  farm.id &&
                  router.push({
                    pathname: '/farmers/[id]/map',
                    params: { id: farmerId, farmId: farm.id },
                  })
                }
                onMakePrimary={() => farm.id && setPrimary(farm.id)}
                onRemove={() => setPendingDelete(farm)}
              />
              <View style={{ height: h(12) }} />
            </View>
          ))
        )}

        <View style={{ height: h(20) }} />
      </ScrollView>

      <ConfirmSheet
        visible={pendingDelete != null}
        title={`Remove ${pendingDelete ? farmDisplayLabel(pendingDelete, farms.indexOf(pendingDelete)) : 'this farm'}?`}
        message={
          'The farm record is deleted. Yields and deliveries already recorded for this farmer are kept — they belong to the farmer, not the farm — but the land they are measured against changes, so the credit score is recalculated.'
        }
        confirmText="Remove farm"
        destructive
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </AppSkeleton>
  );
}

interface FarmCardProps {
  farm: FarmerFarmProfile;
  index: number;
  busy: boolean;
  canRemove: boolean;
  onEdit: () => void;
  onMap: () => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}

function FarmCard({
  farm,
  index,
  busy,
  canRemove,
  onEdit,
  onMap,
  onMakePrimary,
  onRemove,
}: FarmCardProps) {
  const acres = farm.acres ?? farm.farmSizeAcres ?? farm.computedAreaAcres;
  const crops = [farm.cropType, ...farm.secondaryCrops].filter(
    (crop): crop is string => Boolean(crop && crop.length > 0),
  );

  return (
    <InfoCard>
      <View style={styles.cardHeader}>
        <Text style={styles.farmName} numberOfLines={2}>
          {farmDisplayLabel(farm, index)}
        </Text>
        {farm.isPrimary ? (
          <View style={styles.primaryBadge}>
            <Text style={styles.primaryBadgeText}>Main farm</Text>
          </View>
        ) : null}
      </View>

      <View style={{ height: h(10) }} />

      <View style={styles.metaRow}>
        <Text style={styles.metaValue}>
          {acres != null ? `${acres} acres` : 'Size not recorded'}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaValue}>
          {farm.gpsMapped ? 'Boundary walked' : 'Not mapped'}
        </Text>
      </View>

      {crops.length > 0 ? (
        <>
          <View style={{ height: h(6) }} />
          <Text style={styles.crops} numberOfLines={2}>
            {crops.join(', ')}
          </Text>
        </>
      ) : null}

      <View style={{ height: h(14) }} />

      <View style={styles.actions}>
        <View style={styles.actionCell}>
          <AppButton
            text="Edit"
            isOutlined
            height={h(40)}
            onPress={onEdit}
            disabled={busy}
            testID={`farm-edit-${index}`}
          />
        </View>
        <View style={{ width: r(8) }} />
        <View style={styles.actionCell}>
          <AppButton
            text={farm.gpsMapped ? 'View map' : 'Map boundary'}
            isOutlined
            height={h(40)}
            onPress={onMap}
            disabled={busy}
            testID={`farm-map-${index}`}
          />
        </View>
      </View>

      {/*
        Promoting and removing are secondary: the main farm is what the
        single-farm screens and the nested farm edit act on, so changing it
        is a deliberate act rather than a tap away from "Edit".
      */}
      {!farm.isPrimary || canRemove ? (
        <>
          <View style={{ height: h(8) }} />
          <View style={styles.actions}>
            {!farm.isPrimary ? (
              <Pressable
                onPress={busy ? undefined : onMakePrimary}
                hitSlop={8}
                testID={`farm-primary-${index}`}
              >
                <Text style={styles.linkAction}>Make main farm</Text>
              </Pressable>
            ) : null}
            {!farm.isPrimary && canRemove ? <View style={{ width: r(16) }} /> : null}
            {canRemove ? (
              <Pressable
                onPress={busy ? undefined : onRemove}
                hitSlop={8}
                testID={`farm-remove-${index}`}
              >
                <Text style={styles.linkDanger}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
    </InfoCard>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: r(20),
    paddingTop: h(12),
  },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalCell: {
    flex: 1,
    alignItems: 'center',
  },
  totalDivider: {
    width: 1,
    height: h(32),
    backgroundColor: colors.border,
  },
  totalValue: {
    ...textTheme.bodyLarge,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  totalLabel: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.secondaryTextColor,
  },
  totalsNote: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.secondaryTextColor,
    lineHeight: spMin(16),
    marginTop: h(10),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: r(8),
  },
  farmName: {
    ...textTheme.bodyMedium,
    flexShrink: 1,
    fontSize: spMin(15),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  primaryBadge: {
    paddingHorizontal: r(8),
    paddingVertical: h(3),
    borderRadius: r(10),
    backgroundColor: 'rgba(16, 122, 66, 0.1)',
  },
  primaryBadgeText: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.primary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: r(6),
  },
  metaValue: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
  },
  metaDot: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
  },
  crops: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.black,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionCell: {
    flex: 1,
  },
  linkAction: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.primary,
  },
  linkDanger: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.red,
  },
  bottomBar: {
    paddingHorizontal: r(20),
    paddingBottom: h(12),
  },
});
