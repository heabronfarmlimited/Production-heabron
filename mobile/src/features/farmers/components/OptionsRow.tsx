/**
 * `OptionsRow` — ported from
 * modules/cooperatives/presentation/view/widgets/options_row.dart
 *
 * The bottom-sheet action row: a 40r tinted icon tile, a bold label, a grey
 * subtitle and a chevron, on an `AppColors.secondary100` card with radius 12
 * and 12 below. Used by both the farmer and cooperative action sheets.
 *
 * `icon` is a node rather than an `IconData`, so screens pass a glyph from
 * `features/auth/components/FieldIcons` or a plain emoji string.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

export interface OptionsRowProps {
  icon: ReactNode;
  label: string;
  subtitle: string;
  onPress: () => void;
  /** `AppColors.failure` on the destructive rows. */
  labelColor?: string;
  iconColor?: string;
  disabled?: boolean;
  testID?: string;
}

export function OptionsRow({
  icon,
  label,
  subtitle,
  onPress,
  labelColor,
  iconColor,
  disabled = false,
  testID,
}: OptionsRowProps) {
  // Dart: `(iconColor ?? AppColors.primary).withValues(alpha: 0.08)`.
  const tile =
    iconColor === colors.failure
      ? 'rgba(244, 67, 54, 0.08)'
      : 'rgba(46, 139, 87, 0.08)';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: tile }]}>{icon}</View>

      <View style={styles.text}>
        <Text style={[styles.label, labelColor ? { color: labelColor } : null]}>
          {label}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <Text accessible={false} style={styles.chevron}>
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: r(14),
    paddingVertical: r(14),
    marginBottom: r(12),
    backgroundColor: colors.secondary100,
    borderRadius: r(12),
  },
  iconTile: {
    width: r(40),
    height: r(40),
    borderRadius: r(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    marginLeft: r(14),
  },
  label: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  subtitle: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondary400,
    marginTop: r(4),
  },
  chevron: {
    fontSize: spMin(22),
    color: colors.grey,
    marginLeft: r(8),
  },
});
