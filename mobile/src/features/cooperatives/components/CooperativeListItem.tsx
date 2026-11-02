/**
 * `CooperativeListItem` — ported from
 * .../view/widgets/cooperative_list_item.dart
 *
 * Dart: 48r circular logo over `AppColors.secondary100`, 14 horizontal space,
 * name 15sp w600, 6 space, location 13sp w500 grey, a 20r grey chevron, all
 * inside 13 vertical padding, followed by a `Divider(grey@0.2, height: 1)`.
 *
 * `AppImage(NetworkImage(...))` becomes expo-image, which handles a missing or
 * broken URL by rendering the placeholder tile rather than an error glyph —
 * the Dart widget was handed `logoUrl ?? ''` and showed a broken image.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RemoteImage } from '../../../components/RemoteImage';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { initials } from '../../../core/utils/format';

import { Chevron } from './Chevron';

export interface CooperativeListItemProps {
  name: string;
  location: string;
  logoUrl?: string | null;
  onPress?: () => void;
  testID?: string;
}

export function CooperativeListItem({
  name,
  location,
  logoUrl,
  onPress,
  testID,
}: CooperativeListItemProps) {
  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${name}${location ? `, ${location}` : ''}`}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {/*
          FIXED — this rendered `null` with no logo and had no failure
          fallback either, so a cooperative without one, or with an expired
          URL, was an empty coloured circle. A list of them was a column of
          identical blanks. `RemoteImage` shows the initials underneath and
          caches the logo to disk, so a scroll back up does not re-download
          every one.
        */}
        <RemoteImage
          uri={logoUrl}
          fallback={initials(name)}
          radius={r(48)}
          style={styles.logo}
          transition={150}
        />

        <View style={{ width: r(14) }} />

        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <View style={{ height: h(6) }} />
          <Text style={styles.location} numberOfLines={1}>
            {location}
          </Text>
        </View>

        <Chevron size={20} />
      </Pressable>

      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: r(13),
  },
  pressed: {
    opacity: 0.6,
  },
  logo: {
    width: r(48),
    height: r(48),
    borderRadius: r(48),
    backgroundColor: colors.secondary100,
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  text: {
    flex: 1,
  },
  name: {
    ...textTheme.bodyLarge,
    fontSize: spMin(15),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  location: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.grey,
  },
  divider: {
    height: 1,
    // Dart: AppColors.grey.withValues(alpha: 0.2)
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
});
