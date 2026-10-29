/**
 * Empty-state block — the `Icon(64) + Text` column `FarmersView` rendered in a
 * `SliverFillRemaining`, and the bare centred `Text` the four other list
 * screens used.
 *
 * Text is passed in so each screen keeps its exact Dart wording:
 *   'No farmers found' · 'No seasonal yield records found.' ·
 *   'No market access records found.' · 'No field notes found.'
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';

export interface EmptyStateProps {
  text: string;
  /** Optional glyph above the text — Dart used `Icons.person_off_outlined`. */
  icon?: ReactNode;
  /** A second, smaller line of explanation. */
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ text, icon, hint, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ? (
        <>
          {icon}
          <View style={{ height: h(16) }} />
        </>
      ) : null}

      <Text style={styles.text}>{text}</Text>

      {hint ? (
        <>
          <View style={{ height: h(8) }} />
          <Text style={styles.hint}>{hint}</Text>
        </>
      ) : null}

      {action ? (
        <>
          <View style={{ height: h(20) }} />
          {action}
        </>
      ) : null}
    </View>
  );
}

/** `Icons.person_off_outlined` at size 64, grey — the farmers list empty icon. */
export function PersonOffIcon() {
  return (
    <Text accessible={false} style={styles.bigGlyph}>
      🚫
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: r(48),
    paddingHorizontal: r(24),
  },
  text: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.grey,
    textAlign: 'center',
  },
  hint: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.secondary400,
    textAlign: 'center',
  },
  bigGlyph: {
    fontSize: spMin(52),
    color: colors.grey,
    textAlign: 'center',
  },
});
