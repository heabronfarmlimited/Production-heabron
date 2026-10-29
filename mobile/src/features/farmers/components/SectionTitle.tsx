/**
 * `_SectionTitle` — extracted from add_farmer_view.dart / edit_farmer_view.dart,
 * where it was declared privately in both files.
 *
 * Dart: `bodyMedium.copyWith(w700, 16.spMin, color: AppColors.primary)`.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export function SectionTitle({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {title}
    </Text>
  );
}

/**
 * `_buildSectionHeader` from production_yield_details_view.dart —
 * `bodyMedium.copyWith(w600, 16.spMin, color: AppColors.black)` with 12 below.
 */
export function DetailSectionHeader({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={styles.detailHeader}>
      {title}
    </Text>
  );
}

/** `titleMedium.copyWith(w600)` — the Record Yields sub-section headings. */
export function FormSectionHeading({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" style={styles.formHeading}>
      {title}
    </Text>
  );
}

/** Dart `const Divider()`. */
export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  title: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    color: colors.primary,
  },
  detailHeader: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
    marginBottom: r(12),
  },
  formHeading: {
    ...textTheme.titleMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    // Flutter's Divider colour at the default theme opacity.
    backgroundColor: 'rgba(107, 114, 128, 0.3)',
    alignSelf: 'stretch',
  },
});
