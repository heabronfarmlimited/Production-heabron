/**
 * `FarmerScoreTile` — ported from
 * modules/farmers/presentation/view/widgets/farmer_score_tile.dart
 *
 * A 36r avatar, `"<Name> • <Cooperative>"` on the first line, `"<crop> •
 * <size> acres"` on the second, and `"CoopScore: <n>"` on the right coloured
 * by `resolveCoopScoreColor`, followed by a hairline divider.
 *
 * FIXED — the Dart tile read the crop line from `farmProfiles.first` only, so
 * the list endpoint's camelCase `farm` object produced a blank second line. It
 * uses `resolveFarm()` here, which prefers `farm` and falls back to the
 * profile. It also fed `NetworkImage('')` to `AppImage` when there was no
 * photo; an avatar placeholder is rendered instead.
 */
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { resolveCoopScoreColor, titleCase } from '../../../core/utils/format';
import { resolveFarm, type Farmer } from '../model/farmer';

export interface FarmerScoreTileProps {
  farmer: Farmer;
  onPress?: () => void;
  testID?: string;
}

export function FarmerScoreTile({ farmer, onPress, testID }: FarmerScoreTileProps) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const farm = resolveFarm(farmer);
  const score = farmer.creditScore ?? 0;

  const name = farmer.fullName ? titleCase(farmer.fullName) : 'N/A';
  const cooperative = farmer.cooperative?.name
    ? titleCase(farmer.cooperative.name)
    : 'N/A';

  // Dart printed `'<crop> • <size> acres'`, with an empty crop and a literal
  // '' size when either was null. Each part is only shown when present.
  const cropParts: string[] = [];
  if (farm?.cropType) cropParts.push(titleCase(farm.cropType));
  if (farm?.farmSizeAcres != null) cropParts.push(`${farm.farmSizeAcres} acres`);
  const cropLine = cropParts.join(' • ');

  const showPhoto = Boolean(farmer.farmerPhotoUrl) && !photoFailed;

  const body = (
    <View>
      <View style={styles.row}>
        <View style={styles.avatar}>
          {showPhoto ? (
            <Image
              source={{ uri: farmer.farmerPhotoUrl ?? '' }}
              style={styles.avatarImage}
              resizeMode="cover"
              onError={() => setPhotoFailed(true)}
              accessible={false}
            />
          ) : (
            <Text accessible={false} style={styles.avatarGlyph}>
              👤
            </Text>
          )}
        </View>

        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {`${name} • ${cooperative}`}
          </Text>
          {cropLine.length > 0 ? (
            <Text style={styles.crop} numberOfLines={1}>
              {cropLine}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.score, { color: resolveCoopScoreColor(score) }]}>
          {`CoopScore: ${score}`}
        </Text>
      </View>

      <View style={styles.divider} />
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${name}, CoopScore ${score}`}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(12),
  },
  pressed: {
    opacity: 0.7,
  },
  avatar: {
    width: r(36),
    height: r(36),
    borderRadius: r(36),
    backgroundColor: colors.secondary100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarGlyph: {
    fontSize: spMin(16),
  },
  text: {
    flex: 1,
    marginLeft: r(12),
  },
  name: {
    ...textTheme.bodyMedium,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  crop: {
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.grey,
    marginTop: r(4),
  },
  score: {
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    marginLeft: r(8),
  },
  divider: {
    height: 1,
    // AppColors.grey @ 20%
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
});
