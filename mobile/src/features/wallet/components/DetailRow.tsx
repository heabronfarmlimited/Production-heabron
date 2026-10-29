/**
 * Label / value row — ports `_DetailRow` from
 * wallet_transaction_details_view.dart.
 *
 * Dart: 16w/14h padding, a fixed 120w label column (12sp grey) and a
 * right-aligned value (13sp w500, optional colour, optional monospace for
 * UUIDs). The bottom hairline is `grey.withValues(alpha: isLast ? 0 : 0.15)`,
 * i.e. the border is always laid out but transparent on the last row, which
 * keeps every card the same height.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin, w } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { withAlpha } from '../utils/color';

export interface DetailRowProps {
  label: string;
  value: string;
  valueColor?: string;
  isLast?: boolean;
  /** Renders the value in a monospaced face — used for raw UUIDs. */
  mono?: boolean;
}

export function DetailRow({
  label,
  value,
  valueColor,
  isLast = false,
  mono = false,
}: DetailRowProps) {
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: withAlpha(colors.grey, isLast ? 0 : 0.15) },
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          mono ? styles.mono : null,
          valueColor ? { color: valueColor } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: w(16),
    paddingVertical: h(14),
    borderBottomWidth: 1,
  },
  label: {
    ...textTheme.bodySmall,
    width: w(120),
    fontSize: spMin(12),
    color: colors.grey,
  },
  value: {
    ...textTheme.bodyMedium,
    flex: 1,
    fontSize: spMin(13),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
    textAlign: 'right',
  },
  mono: {
    // Dart asked for `fontFamily: 'monospace'`, which only resolves on Android.
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: spMin(12),
    letterSpacing: r(0.2),
  },
});
