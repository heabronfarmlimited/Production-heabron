/**
 * Farm boundary capture — **no Flutter equivalent.**
 *
 * `FarmersRepository.mapFarm()` and `ApiConstant.mapFarmEndpoint` existed in
 * the Dart codebase with no screen calling them, and `gpsPolygon` was declared
 * on three DTOs but never populated — so farm size could only ever be typed in
 * by hand. APP_DEV_HANDOFF.md §5 listed this as "intentionally left for you".
 *
 * The agent walks the farm perimeter, tapping to drop a point at each corner.
 * `POST /agent/farmers/:id/map-farm` then returns the server-computed acreage
 * and centroid, which overwrite the farm profile's `farmSizeAcres`.
 *
 * The validator requires at least 3 points
 * (`gpsPolygon: array().items({lat, lng}).min(3).required()`).
 */
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AuthBackButton } from '../../../components/BaseAppBar';
import { useBoundaryCapture } from '../../../core/hooks/useLocation';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { useMapFarm } from '../hooks/useFarmerMutations';

import { useRouteParams } from './routeParams';

export interface FarmBoundaryScreenProps {
  farmerId?: string;
}

export function FarmBoundaryScreen({ farmerId: farmerIdProp }: FarmBoundaryScreenProps = {}) {
  const router = useRouter();
  const params = useRouteParams();
  const farmerId = farmerIdProp ?? params.id ?? '';

  const {
    points,
    polygon,
    addPoint,
    removeLast,
    reset,
    loading,
    canSubmit,
    minPoints,
  } = useBoundaryCapture();
  const { save, isPending, result } = useMapFarm(farmerId);

  const submit = () => {
    save(
      // `polygon` is already in the `{ lat, lng }` shape the validator wants.
      { gpsPolygon: polygon },
      {
        onSuccess: () => {
          reset();
          router.back();
        },
      },
    );
  };

  return (
    <AppSkeleton
      isBusy={isPending}
      appBarTitle="Map Farm Boundary"
      appBarLeading={<AuthBackButton />}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ height: h(8) }} />

        <Text style={styles.intro}>
          Walk the edge of the farm and drop a point at each corner. The farm
          size is calculated from the shape you capture.
        </Text>

        <View style={{ height: h(20) }} />

        <View style={styles.counterCard}>
          <Text style={styles.counterValue}>{points.length}</Text>
          <Text style={styles.counterLabel}>
            {points.length === 1 ? 'point captured' : 'points captured'}
          </Text>
          {!canSubmit ? (
            <Text style={styles.counterHint}>
              At least {minPoints} points are needed to close a boundary
            </Text>
          ) : null}
        </View>

        <View style={{ height: h(20) }} />

        <AppButton
          text={points.length === 0 ? 'Drop first point' : 'Drop point here'}
          loading={loading}
          onPress={() => void addPoint()}
          testID="boundary-add-point"
        />

        {points.length > 0 ? (
          <>
            <View style={{ height: h(12) }} />
            <View style={styles.secondaryRow}>
              <View style={styles.secondaryButton}>
                <AppButton
                  text="Undo last"
                  isOutlined
                  height={44}
                  onPress={removeLast}
                  testID="boundary-undo"
                />
              </View>
              <View style={{ width: r(12) }} />
              <View style={styles.secondaryButton}>
                <AppButton
                  text="Clear all"
                  isOutlined
                  outlineColor={colors.failure}
                  textColor={colors.failure}
                  height={44}
                  onPress={reset}
                  testID="boundary-clear"
                />
              </View>
            </View>
          </>
        ) : null}

        <View style={{ height: h(24) }} />

        {points.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Captured points</Text>
            <View style={{ height: h(8) }} />
            <View style={styles.pointList}>
              {points.map((p, index) => (
                <View
                  key={`${p.latitude}-${p.longitude}-${index}`}
                  style={[
                    styles.pointRow,
                    index < points.length - 1 && styles.pointRowDivider,
                  ]}
                >
                  <View style={styles.pointBadge}>
                    <Text style={styles.pointBadgeText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.pointCoords}>
                    {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>📍</Text>
            <Text style={styles.emptyText}>
              Stand at a corner of the farm and drop your first point
            </Text>
          </View>
        )}

        {result ? (
          <>
            <View style={{ height: h(20) }} />
            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>Server calculation</Text>
              <View style={{ height: h(6) }} />
              <Text style={styles.resultValue}>
                {result.computedAreaAcres.toFixed(2)} acres
              </Text>
              <Text style={styles.resultSub}>
                {result.computedAreaHectares.toFixed(2)} hectares
              </Text>
            </View>
          </>
        ) : null}

        <View style={{ height: h(28) }} />

        <AppButton
          text="Save boundary"
          height={54}
          disabled={!canSubmit || !farmerId}
          loading={isPending}
          onPress={submit}
          testID="boundary-submit"
        />

        {!farmerId ? (
          <Text style={styles.warning}>
            This screen needs a farmer. Open it from a farmer&apos;s profile.
          </Text>
        ) : null}

        <View style={{ height: h(24) }} />
      </ScrollView>
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  intro: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.greyDeep,
    lineHeight: spMin(14) * 1.5,
  },
  counterCard: {
    alignItems: 'center',
    paddingVertical: r(20),
    borderRadius: r(8),
    borderWidth: 1,
    borderColor: 'rgba(46, 139, 87, 0.35)',
    backgroundColor: 'rgba(46, 139, 87, 0.08)',
  },
  counterValue: {
    ...textTheme.headlineLarge,
    fontSize: spMin(36),
    color: colors.primary,
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  counterLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    color: colors.greyDeep,
  },
  counterHint: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.orange700,
    marginTop: r(6),
    textAlign: 'center',
    paddingHorizontal: r(16),
  },
  secondaryRow: {
    flexDirection: 'row',
  },
  secondaryButton: {
    flex: 1,
  },
  sectionTitle: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  pointList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: r(8),
    paddingHorizontal: r(12),
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(12),
    paddingVertical: r(12),
  },
  pointRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pointBadge: {
    width: r(26),
    height: r(26),
    borderRadius: r(26),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointBadgeText: {
    color: colors.white,
    fontSize: spMin(12),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  pointCoords: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    color: colors.greyDeep,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: r(32),
  },
  emptyGlyph: {
    fontSize: spMin(36),
  },
  emptyText: {
    ...textTheme.bodyMedium,
    color: colors.grey,
    textAlign: 'center',
    marginTop: r(8),
    paddingHorizontal: r(24),
  },
  resultCard: {
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: 'rgba(30, 173, 96, 0.08)',
    borderRadius: r(8),
    padding: r(14),
  },
  resultTitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  resultValue: {
    ...textTheme.headlineSmall,
    fontSize: spMin(22),
    color: colors.success,
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
  resultSub: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.greyDeep,
  },
  warning: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.failure,
    textAlign: 'center',
    marginTop: r(8),
  },
});
