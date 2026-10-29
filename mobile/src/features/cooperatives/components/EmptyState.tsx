/**
 * List empty state — the `Center(child: Text(...))` the Flutter lists used,
 * plus the optional 64px glyph `FarmersView` showed above its message.
 *
 * NOTE — duplicates nothing yet, but it is the shape CONVENTIONS.md's screen
 * pattern references. Move to `src/components` once a second module needs it.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { textTheme } from '../../../core/theme/typography';

export interface EmptyStateProps {
  text: string;
  /** Rendered above the text, e.g. a 64px glyph. */
  glyph?: string;
  /** Fills the remaining space — use inside a flexed list. */
  fill?: boolean;
}

export function EmptyState({ text, glyph, fill = true }: EmptyStateProps) {
  return (
    <View style={[styles.container, fill && styles.fill]}>
      {glyph ? <Text style={styles.glyph}>{glyph}</Text> : null}
      {glyph ? <View style={{ height: h(12) }} /> : null}
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: r(40),
    paddingHorizontal: r(16),
  },
  fill: {
    flex: 1,
  },
  glyph: {
    fontSize: spMin(48),
  },
  text: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.secondary400,
    textAlign: 'center',
  },
});
