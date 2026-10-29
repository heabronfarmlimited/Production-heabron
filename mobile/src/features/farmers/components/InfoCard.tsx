/**
 * `_buildInfoCard` / `_InfoRow` from farmer_details_view.dart and
 * `_buildInfoCard` / `_buildDetailRow` from production_yield_details_view.dart
 * — one card and two row variants instead of four near-identical private
 * builders.
 *
 * Dart card: white, radius 16, 1px `AppColors.grey @ 20%`, 16 padding.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

/** `AppColors.grey.withValues(alpha: 0.2)` */
const CARD_BORDER = 'rgba(107, 114, 128, 0.2)';

export function InfoCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export interface DetailRowProps {
  label: string;
  value: string;
  valueColor?: string;
  onPress?: () => void;
  /** Renders a trailing arrow — the Dart `label.isEmpty` action-row variant. */
  isAction?: boolean;
  /** Dart `decoration: underline` when a row is tappable. */
  underline?: boolean;
  testID?: string;
}

/**
 * The farmer-details row: label left (grey w500 14sp), value right.
 * When `isAction` is set the label is dropped and the value renders with a
 * trailing arrow — the Dart code keyed that off an empty label string.
 */
export function DetailRow({
  label,
  value,
  valueColor,
  onPress,
  isAction = false,
  underline = false,
  testID,
}: DetailRowProps) {
  const body = (
    <View style={styles.row}>
      {isAction ? null : <Text style={styles.label}>{label}</Text>}

      <View style={styles.valueWrap}>
        <Text
          style={[
            styles.value,
            isAction ? styles.valueAction : null,
            valueColor ? { color: valueColor } : null,
            underline ? styles.underline : null,
          ]}
        >
          {value}
        </Text>
        {isAction ? (
          <Text
            accessible={false}
            style={[styles.arrow, valueColor ? { color: valueColor } : null]}
          >
            {' →'}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={isAction ? value : `${label}: ${value}`}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

/**
 * The yield-details row: 2:3 split, 13sp, right-aligned value, underlined when
 * tappable.
 */
export function SplitDetailRow({
  label,
  value,
  valueColor,
  onPress,
}: Omit<DetailRowProps, 'isAction' | 'underline'>) {
  const body = (
    <View style={styles.splitRow}>
      <Text style={styles.splitLabel}>{label}</Text>
      <Text
        style={[
          styles.splitValue,
          valueColor ? { color: valueColor } : null,
          onPress ? styles.underline : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

/** `StatPill` — primary-tinted title/value pill. */
export function StatPill({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillValue}>{value}</Text>
      <Text style={styles.pillTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    paddingVertical: r(16),
    paddingHorizontal: r(16),
    backgroundColor: colors.white,
    borderRadius: r(16),
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: r(10),
  },
  label: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.grey,
    flexShrink: 1,
    marginRight: r(12),
  },
  valueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  value: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.black,
    textAlign: 'right',
    flexShrink: 1,
  },
  valueAction: {
    textAlign: 'left',
  },
  arrow: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.black,
  },
  underline: {
    textDecorationLine: 'underline',
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: r(6),
  },
  splitLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    color: colors.grey,
    flex: 2,
    marginRight: r(8),
  },
  splitValue: {
    ...textTheme.bodyMedium,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
    flex: 3,
    textAlign: 'right',
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: r(14),
    paddingHorizontal: r(12),
    borderRadius: r(12),
    // AppColors.primary @ 10%
    backgroundColor: 'rgba(46, 139, 87, 0.1)',
  },
  pillValue: {
    ...textTheme.bodyMedium,
    fontSize: spMin(16),
    fontFamily: fontWeights.bold,
    fontWeight: '700',
    color: colors.primary,
  },
  pillTitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.grey,
    marginTop: r(4),
  },
});
