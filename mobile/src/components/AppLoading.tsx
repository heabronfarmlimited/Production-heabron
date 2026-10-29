/**
 * Spinner — ported from lib/src/shared/app_loading.dart
 *
 * Dart: `CircularProgressIndicator(color: color ?? AppColors.white, strokeWidth: 2)`
 * wrapped in a FittedBox. The `value` parameter supported determinate
 * progress; RN's ActivityIndicator is indeterminate only, so a determinate
 * bar is drawn instead when `value` is supplied.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '../core/theme/colors';
import { r } from '../core/theme/responsive';

export interface AppLoadingProps {
  /** 0..1 for determinate progress; omit for a spinner. */
  value?: number;
  /** Dart default: `AppColors.white`. */
  color?: string;
  size?: 'small' | 'large';
}

export function AppLoading({ value, color = colors.white, size = 'small' }: AppLoadingProps) {
  if (value != null) {
    const pct = Math.max(0, Math.min(1, value));
    return (
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]}
        />
      </View>
    );
  }

  return <ActivityIndicator size={size} color={color} />;
}

const styles = StyleSheet.create({
  track: {
    height: r(3),
    borderRadius: r(2),
    backgroundColor: colors.secondary200,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  fill: {
    height: '100%',
    borderRadius: r(2),
  },
});
