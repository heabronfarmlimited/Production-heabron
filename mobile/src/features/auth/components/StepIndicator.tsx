/**
 * Registration progress bars — ported from
 * modules/authentication/presentation/view/widgets/step_indicator.dart
 *
 * Dart: a Row of `steps.length` pills, 6h, radius 100, 22r gap, filled with
 * `AppColors.primary` when `index <= currentStep` else `AppColors.grey`, with
 * 'Step {n} of {total}' below in primary 16sp w500.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface StepIndicatorProps {
  /** Zero-based. */
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <View style={styles.container}>
      <View
        style={styles.row}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: totalSteps, now: currentStep + 1 }}
      >
        {Array.from({ length: totalSteps }, (_, index) => (
          <View
            key={index}
            style={[
              styles.pill,
              { backgroundColor: index <= currentStep ? colors.primary : colors.grey },
            ]}
          />
        ))}
      </View>

      <View style={{ height: h(8) }} />

      <Text style={styles.label}>
        Step {currentStep + 1} of {totalSteps}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    alignItems: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    // Dart: Row(spacing: 22.r)
    gap: r(22),
  },
  pill: {
    flex: 1,
    height: h(6),
    borderRadius: r(100),
  },
  label: {
    ...textTheme.bodySmall,
    fontSize: spMin(16),
    color: colors.primary,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
  },
});
