/**
 * `StatPill` — declared inside `cooperative_details_view.dart`.
 *
 * Dart: primary-filled container, radius 14, padding 10/10; title 12sp w500 at
 * white@0.8, 16 vertical space, value 20sp w600 white. Column is centred.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface StatPillProps {
  title: string;
  value: string;
}

export function StatPill({ title, value }: StatPillProps) {
  return (
    <View style={styles.pill}>
      <Text style={styles.title}>{title}</Text>
      <View style={{ height: h(16) }} />
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingVertical: r(10),
    paddingHorizontal: r(10),
    backgroundColor: colors.primary,
    borderRadius: r(14),
    alignItems: 'center',
  },
  title: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    // Dart: AppColors.white.withValues(alpha: 0.8)
    color: 'rgba(255, 255, 255, 0.8)',
  },
  value: {
    ...textTheme.headlineSmall,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.white,
  },
});
