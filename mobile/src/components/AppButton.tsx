/**
 * Button — ported from lib/src/shared/app_button.dart
 *
 * The Dart version used `OutlinedButton.icon` for both filled and outlined
 * styles, driven by `isOutlined`. That is reproduced here with a Pressable so
 * the disabled colour, loading state and icon alignment all behave the same.
 *
 * Disabled background is `Color.fromRGBO(205, 187, 187, 0.5)`, applied in Dart
 * whenever `onPressed == null`. Here the same rule applies when `disabled` is
 * set, `onPress` is absent, or `loading` is true.
 */
import type { ReactNode } from 'react';
import type {
  StyleProp,
  ViewStyle} from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { colors } from '../core/theme/colors';
import { h, r, spMin } from '../core/theme/responsive';
import { fontWeights } from '../core/theme/typography';

export interface AppButtonProps {
  /** Button label. */
  text: string;
  onPress?: () => void;
  /** Dart default: `double.maxFinite` — fills the parent. */
  fullWidth?: boolean;
  width?: number;
  /** Dart default: 49 (scaled with `.h`). */
  height?: number;
  /** Outlined style instead of filled. */
  isOutlined?: boolean;
  /** Dart default: `IconAlignment.end`. */
  iconAlignment?: 'start' | 'end';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Dart default: `AppColors.primary`. */
  bgColor?: string;
  textColor?: string;
  loadingColor?: string;
  /** Dart default: `AppColors.grey`. */
  outlineColor?: string;
  borderRadius?: number;
  /** Dart default: `EdgeInsets.all(14)`. */
  padding?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** `Color.fromRGBO(205, 187, 187, 0.5)` */
const DISABLED_BG = 'rgba(205, 187, 187, 0.5)';

export function AppButton({
  text,
  onPress,
  fullWidth = true,
  width,
  height = 49,
  isOutlined = false,
  iconAlignment = 'end',
  icon,
  loading = false,
  disabled = false,
  bgColor = colors.primary,
  textColor,
  loadingColor,
  outlineColor = colors.grey,
  borderRadius,
  padding = 14,
  style,
  testID,
}: AppButtonProps) {
  const isDisabled = disabled || loading || !onPress;

  const resolvedBg = isDisabled
    ? DISABLED_BG
    : isOutlined
      ? colors.background
      : bgColor;

  const resolvedTextColor =
    textColor ?? (isOutlined ? outlineColor : colors.white);

  const spinner = (
    <ActivityIndicator
      size="small"
      color={loadingColor ?? (isOutlined ? outlineColor : colors.white)}
    />
  );

  const leading = iconAlignment === 'start' ? (loading ? spinner : icon) : null;
  const trailing = iconAlignment === 'end' ? (loading ? spinner : icon) : null;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height: h(height),
          padding: r(padding),
          backgroundColor: resolvedBg,
          borderColor: isOutlined ? outlineColor : 'transparent',
          borderRadius: borderRadius != null ? r(borderRadius) : r(4),
          opacity: pressed && !isDisabled ? 0.85 : 1,
        },
        fullWidth && !width ? styles.fullWidth : null,
        width != null ? { width } : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {leading ? <View style={styles.iconStart}>{leading}</View> : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.label, { color: resolvedTextColor }]}
        >
          {text}
        </Text>
        {trailing ? <View style={styles.iconEnd}>{trailing}</View> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    // Dart: bodyMedium.copyWith(fontSize: 20.spMin, fontWeight: w600)
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  iconStart: {
    marginRight: r(8),
  },
  iconEnd: {
    marginLeft: r(8),
  },
});
