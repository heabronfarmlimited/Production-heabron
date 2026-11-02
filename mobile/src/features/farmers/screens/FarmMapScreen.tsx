/**
 * Full-screen farm map (v2 user flow: "Map view: full-screen,
 * satellite-capable, marker plus polygon, closes back to the same profile
 * without losing state").
 *
 * "Closes back without losing state" is why this is a plain route that calls
 * `router.back()` and holds no form: the farmer profile and the farms list
 * stay mounted beneath it, and their query cache is untouched, so returning
 * lands exactly where the agent left — same scroll, same loaded data, no
 * refetch.
 *
 * With several farms the screen shows one at a time, chosen by the `farmId`
 * query and switchable from a row of chips. Drawing them all at once sounds
 * helpful and is not: plots can be kilometres apart, so fitting them into one
 * view shrinks each to a dot.
 *
 * On satellite imagery, see the note in `FarmMapView` — it needs a keyed tile
 * provider, and this project has no map key configured.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { formatCoordinate } from '../../../core/utils/mapProjection';
import { FarmMapView } from '../components/FarmMapView';
import { useFarmerFarms } from '../hooks/useFarmerFarms';
import { farmDisplayLabel, type FarmerFarmProfile } from '../model/farmer';
import { farmersRoutes } from '../navigation';

import { useRouteParams } from './routeParams';

export interface FarmMapScreenProps {
  farmerId?: string;
  farmId?: string;
}

export function FarmMapScreen({
  farmerId: farmerIdProp,
  farmId: farmIdProp,
}: FarmMapScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = farmerIdProp ?? params.id ?? '';
  const initialFarmId = farmIdProp ?? params.farmId;

  const { farms, isLoading } = useFarmerFarms(farmerId);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialFarmId);

  const selected: FarmerFarmProfile | undefined =
    farms.find((f) => f.id === selectedId) ?? farms[0];
  const selectedIndex = selected ? farms.indexOf(selected) : -1;

  const marker =
    selected?.gpsLat != null && selected.gpsLng != null
      ? { lat: selected.gpsLat, lng: selected.gpsLng }
      : null;

  return (
    <AppSkeleton
      appBarTitle="Farm Map"
      appBarLeading={<AuthBackButton />}
      isBusy={isLoading && farms.length === 0}
      bodyPadding={styles.noPadding}
    >
      {farms.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {farms.map((farm, index) => {
            const active = farm.id === selected?.id;
            return (
              <Pressable
                key={farm.id ?? String(index)}
                onPress={() => setSelectedId(farm.id ?? undefined)}
                style={[styles.chip, active ? styles.chipActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`map-farm-chip-${index}`}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                  {farmDisplayLabel(farm, index)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FarmMapView
        polygon={selected?.gpsPolygon ?? []}
        marker={marker}
        label={selected ? farmDisplayLabel(selected, selectedIndex) : null}
        style={styles.map}
      />

      <View style={styles.footer}>
        <Text style={styles.footerCoord}>
          {marker ? formatCoordinate(marker) : 'No GPS point recorded'}
        </Text>

        <View style={{ height: h(10) }} />

        {/*
          The one action worth having here: an unmapped farm, or one whose
          shape looks wrong, sends the agent straight to walking it. The
          capture screen returns here, and this screen reloads from the same
          cache.
        */}
        <AppButton
          text={
            selected?.gpsMapped
              ? 'Re-walk this boundary'
              : 'Walk this boundary'
          }
          isOutlined={Boolean(selected?.gpsMapped)}
          height={h(44)}
          onPress={() => router.push(farmersRoutes.captureBoundary(farmerId))}
          testID="map-walk-boundary"
        />
      </View>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  noPadding: {
    paddingHorizontal: 0,
  },
  map: {
    flex: 1,
    minHeight: h(320),
  },
  chipRow: {
    paddingHorizontal: r(16),
    paddingVertical: h(10),
    gap: r(8),
  },
  chip: {
    paddingHorizontal: r(12),
    paddingVertical: h(6),
    borderRadius: r(16),
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(46, 139, 87, 0.1)',
  },
  chipText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
  },
  chipTextActive: {
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.primary,
  },
  footer: {
    paddingHorizontal: r(16),
    paddingTop: h(12),
    paddingBottom: h(16),
  },
  footerCoord: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondaryTextColor,
    textAlign: 'center',
  },
});
