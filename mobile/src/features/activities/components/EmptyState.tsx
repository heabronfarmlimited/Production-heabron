/**
 * Empty list placeholder — ports `_EmptyState` from activities_view.dart and
 * the two inline copies in recent_activity_logs_view.dart.
 *
 * Dart: centred, 24r horizontal padding, a 64r circle at `grey @ 5%` holding a
 * 28px icon, 16 space, then the message at 14sp grey, centred.
 *
 * No fake rows ever stand in for an empty list (CONVENTIONS rule 1).
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';
import { withAlpha } from '../utils/color';

import { AssignmentIcon } from './ActivityIcons';

export interface EmptyStateProps {
  message: string;
  /** Defaults to `assignment_late_outlined`, as every Dart call site used. */
  icon?: ReactNode;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.circle}>
        {icon ?? <AssignmentIcon color={colors.grey} size={28} />}
      </View>
      <View style={styles.gap} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: r(24),
  },
  circle: {
    width: r(64),
    height: r(64),
    borderRadius: r(64),
    backgroundColor: withAlpha(colors.grey, 0.05),
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: {
    height: r(16),
  },
  message: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
    textAlign: 'center',
  },
});
