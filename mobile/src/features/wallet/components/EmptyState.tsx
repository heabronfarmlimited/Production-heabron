/**
 * Empty list placeholder for the wallet screens.
 *
 * Two shapes appear in the Dart views:
 *   transaction_history_view.dart — bare centred text after a 100h spacer
 *   settlement_history_view.dart  — a 48r `receipt_long_outlined` at
 *                                   `grey.withValues(alpha: 0.4)`, 16 space,
 *                                   then the message
 *   wallet_view.dart              — bare centred text, 24r vertical padding
 *
 * `icon` and `topSpacing` select between them. No fake rows ever stand in for
 * an empty list (CONVENTIONS rule 1).
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';

export interface EmptyStateProps {
  text: string;
  /** Rendered above the message, as the settlement list does. */
  icon?: ReactNode;
  /** Dart pushed the list empty states down by 100h. */
  topSpacing?: number;
  /** Dart used 24r vertical padding for the inline wallet empty state. */
  verticalPadding?: number;
}

export function EmptyState({
  text,
  icon,
  topSpacing = 0,
  verticalPadding = 0,
}: EmptyStateProps) {
  return (
    <View style={[styles.wrap, { paddingVertical: r(verticalPadding) }]}>
      {topSpacing > 0 ? <View style={{ height: h(topSpacing) }} /> : null}
      {icon ? (
        <>
          {icon}
          <View style={styles.gap} />
        </>
      ) : null}
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: {
    height: r(16),
  },
  text: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
    textAlign: 'center',
  },
});
