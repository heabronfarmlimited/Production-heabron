/**
 * `OptionsRow` — ported from .../view/widgets/options_row.dart
 *
 * DUPLICATE — the farmers module owns the canonical copy
 * (`src/features/farmers/components/OptionsRow.tsx`), which did not exist when
 * this module was built. De-duplicate by deleting this file and importing from
 * there once it lands; the props below are the intended shared contract, with
 * Dart's `IconData` becoming a ReactNode glyph and `onTap` becoming `onPress`.
 *
 * Dart: `secondary100` row, radius 12, padding 14/14, margin-bottom 12; a 40r
 * tile filled with the icon colour at 8% holding a 20r icon, 14 horizontal
 * space, label 14sp w600, 4 space, subtitle 12sp w400 `secondary400`, then a
 * grey chevron.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';

import { Chevron } from './Chevron';

export interface OptionsRowProps {
  icon: ReactNode;
  label: string;
  subtitle: string;
  onPress: () => void;
  labelColor?: string;
  /** Tints the icon tile; Dart used it to turn the delete row red. */
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
  iconColor = colors.primary,
  disabled = false,
  testID,
}: OptionsRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${subtitle}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: tint(iconColor) }]}>
        {icon}
      </View>

      <View style={{ width: r(14) }} />

      <View style={styles.text}>
        <Text style={[styles.label, labelColor ? { color: labelColor } : null]}>
          {label}
        </Text>
        <View style={{ height: h(4) }} />
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <Chevron size={24} />
    </Pressable>
  );
}

/** Dart: `(iconColor ?? primary).withValues(alpha: 0.08)`. */
function tint(color: string): string {
  if (color === colors.primary) return 'rgba(46, 139, 87, 0.08)';
  if (color === colors.failure) return 'rgba(244, 67, 54, 0.08)';
  return 'rgba(0, 0, 0, 0.08)';
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary100,
    borderRadius: r(12),
    paddingHorizontal: r(14),
    paddingVertical: r(14),
    marginBottom: r(12),
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
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
  },
});
