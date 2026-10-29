/**
 * `_buildTierCard` from .../view/financing/financing_details_view.dart.
 *
 * Dart: white box, radius 12, 1px `secondary200` border, 16/14 padding;
 * title 12sp grey, 6 space, `tier.toUpperCase()` at 22sp w800 coloured by
 * `resolveCoopTier`, 4 space, subtitle 11sp grey ellipsised to one line.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { resolveCoopTierColor } from '../../../core/utils/format';

export interface TierCardProps {
  title: string;
  /** Raw tier value; rendered uppercase. An em-dash when unknown. */
  tier: string;
  subtitle: string;
}

export function TierCard({ title, tier, subtitle }: TierCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={{ height: h(6) }} />
      <Text style={[styles.tier, { color: resolveCoopTierColor(tier) }]}>
        {tier.toUpperCase()}
      </Text>
      <View style={{ height: h(4) }} />
      <Text style={styles.subtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: r(12),
    borderWidth: 1,
    borderColor: colors.secondary200,
    paddingHorizontal: r(16),
    paddingVertical: r(14),
  },
  title: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  tier: {
    ...textTheme.headlineMedium,
    fontSize: spMin(22),
    fontFamily: fontWeights.extraBold,
    fontWeight: '800',
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.grey,
  },
});
