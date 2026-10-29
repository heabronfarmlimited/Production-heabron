/**
 * `CooperativeInfoCard` — the audit records this widget as dead code,
 * superseded by `StatPill`. It is kept because the two differ visually and the
 * card is the better fit for a left-aligned, labelled figure: primary fill,
 * radius 14, padding 16/16, label 13sp w500 at white@0.8, 8 space, value 22sp
 * w700 white, cross-axis start.
 *
 * Nothing in the module renders it today — the detail screen uses `StatPill`,
 * as the Flutter screen did. It is ported because the two differ visually and
 * this is the better fit for a left-aligned labelled figure; delete it if no
 * screen has adopted it by the time the module is reviewed.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface CooperativeInfoCardProps {
  label: string;
  value: string;
  /** Overrides the value colour — used for the tier, which is tier-coloured. */
  valueColor?: string;
  backgroundColor?: string;
}

export function CooperativeInfoCard({
  label,
  value,
  valueColor = colors.white,
  backgroundColor = colors.primary,
}: CooperativeInfoCardProps) {
  return (
    <View style={[styles.card, { backgroundColor }]}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ height: h(8) }} />
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: r(16),
    paddingHorizontal: r(16),
    borderRadius: r(14),
    alignItems: 'flex-start',
  },
  label: {
    ...textTheme.bodySmall,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  value: {
    ...textTheme.headlineSmall,
    fontSize: spMin(22),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
  },
});
