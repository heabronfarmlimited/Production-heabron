/**
 * `_buildSectionHeader` and `_buildDetailSection` from
 * .../view/financing/financing_details_view.dart, extracted so the 9 sections
 * of `FinancingDetailsScreen` are declarative.
 *
 * Dart section header: 13sp w700 black, letterSpacing 0.4.
 * Dart detail section: 12sp grey label, 6 space, then a radius-12 box with
 * 14/14 padding whose fill, border and value colour the caller supplies; the
 * value is 14sp w500.
 */
import { Children, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.header}>{title}</Text>;
}

export interface DetailSectionProps {
  label: string;
  value: string;
  valueColor?: string;
  bgColor?: string;
  borderColor?: string;
}

export function DetailSection({
  label,
  value,
  valueColor = colors.black,
  bgColor = colors.white,
  borderColor = colors.secondary200,
}: DetailSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ height: h(6) }} />
      <View style={[styles.box, { backgroundColor: bgColor, borderColor }]}>
        <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * The `Row(children: [Expanded, 12.horizontalSpace, Expanded])` pairing used
 * throughout the financing detail screen. Each child is wrapped in its own
 * flexed cell and separated by the Dart 12 gap.
 */
export function DetailRow({ children }: { children: ReactNode }) {
  const cells = Children.toArray(children);

  return (
    <View style={styles.row}>
      {cells.map((cell, index) => (
        // The index is the position in a fixed, locally-declared pair.
        // eslint-disable-next-line react/no-array-index-key
        <View key={index} style={[styles.half, index > 0 && styles.gap]}>
          {cell}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    color: colors.black,
    letterSpacing: 0.4,
  },
  container: {
    alignSelf: 'stretch',
  },
  label: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
  },
  box: {
    width: '100%',
    paddingHorizontal: r(14),
    paddingVertical: r(14),
    borderRadius: r(12),
    borderWidth: 1,
  },
  value: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  half: {
    flex: 1,
  },
  gap: {
    marginLeft: r(12),
  },
});
