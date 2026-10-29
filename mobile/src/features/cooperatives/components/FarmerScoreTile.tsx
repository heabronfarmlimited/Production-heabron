/**
 * `FarmerScoreTile` — ported from
 * modules/farmers/.../view/widgets/farmer_score_tile.dart
 *
 * DUPLICATE — the farmers module owns the canonical copy
 * (`src/features/farmers/components/FarmerScoreTile.tsx`), which did not exist
 * when this module was built. De-duplicate by deleting this file and importing
 * from there once it lands; it reads only `Farmer` fields from
 * `features/farmers/model/farmer`, so the swap is a change of import path.
 *
 * Dart: 36r circular photo over `secondary100`, 12 horizontal space, then
 * `'<Name> • <Cooperative>'` at 12sp w500 (both falling back to `'N/A'`), 4
 * space, a conditional `'<Crop> • <acres> acres'` line at 12sp w500 grey shown
 * only when a farm profile exists, and a right-aligned
 * `'CoopScore: <score>'` coloured by `resolveCoopScoreColor`. 12 vertical
 * padding, then a `Divider(grey@0.2, height: 1)`.
 */
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { resolveCoopScoreColor, titleCase } from '../../../core/utils/format';
import { resolveFarm, type Farmer } from '../../farmers/model/farmer';

export interface FarmerScoreTileProps {
  farmer: Farmer;
  onPress?: () => void;
}

export function FarmerScoreTile({ farmer, onPress }: FarmerScoreTileProps) {
  const name = farmer.fullName ? titleCase(farmer.fullName) : 'N/A';
  const coop = farmer.cooperative?.name ? titleCase(farmer.cooperative.name) : 'N/A';

  const farm = resolveFarm(farmer);
  // Dart gated this line on `farmProfiles.isNotEmpty`; `resolveFarm` already
  // normalises the camelCase `farm` and snake_case `farm_profiles` shapes.
  const farmLine =
    farm && (farm.cropType || farm.farmSizeAcres != null)
      ? `${farm.cropType ? titleCase(farm.cropType) : ''} • ${
          farm.farmSizeAcres ?? ''
        } acres`
      : null;

  const score = farmer.creditScore ?? 0;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, CoopScore ${score}`}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
      >
        <View style={styles.photo}>
          {farmer.farmerPhotoUrl ? (
            <Image
              source={{ uri: farmer.farmerPhotoUrl }}
              style={styles.photoImage}
              contentFit="cover"
              transition={150}
            />
          ) : null}
        </View>

        <View style={{ width: r(12) }} />

        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={2}>
            {`${name} • ${coop}`}
          </Text>
          {farmLine ? (
            <>
              <View style={{ height: h(4) }} />
              <Text style={styles.farm} numberOfLines={1}>
                {farmLine}
              </Text>
            </>
          ) : null}
        </View>

        <Text style={[styles.score, { color: resolveCoopScoreColor(score) }]}>
          {`CoopScore: ${score}`}
        </Text>
      </Pressable>

      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(12),
  },
  pressed: {
    opacity: 0.6,
  },
  photo: {
    width: r(36),
    height: r(36),
    borderRadius: r(36),
    backgroundColor: colors.secondary100,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  text: {
    flex: 1,
  },
  name: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  farm: {
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.grey,
  },
  score: {
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    marginLeft: r(8),
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
});
