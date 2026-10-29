/**
 * App bar + back buttons — ported from lib/src/shared/base_appbar.dart and the
 * `AppBackButton` / `AuthBackButton` widgets in app_button.dart.
 */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../core/theme/colors';
import { r, spMin } from '../core/theme/responsive';
import { fontWeights, textTheme } from '../core/theme/typography';

export interface BaseAppBarProps {
  title?: string;
  titleWidget?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  centerTitle?: boolean;
  /** Hides the default back button. */
  hideBack?: boolean;
}

export function BaseAppBar({
  title,
  titleWidget,
  actions,
  leading,
  centerTitle = false,
  hideBack = false,
}: BaseAppBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.leading}>
        {leading ?? (hideBack ? null : <AppBackButton />)}
      </View>

      <View style={[styles.titleWrap, centerTitle && styles.titleCentered]}>
        {titleWidget ??
          (title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null)}
      </View>

      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

/**
 * `AppBackButton` — plain arrow, pops if possible.
 * `hasBackground` renders it on a grey circle.
 */
export function AppBackButton({
  onPress,
  color,
  hasBackground = false,
}: {
  onPress?: () => void;
  color?: string;
  hasBackground?: boolean;
}) {
  const router = useRouter();
  const handle = onPress ?? (() => router.back());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={handle}
      hitSlop={8}
      style={hasBackground ? styles.backCircle : styles.backPlain}
    >
      <BackArrow color={color ?? colors.black} size={hasBackground ? 12 : 18} />
    </Pressable>
  );
}

/**
 * `AuthBackButton` — circular translucent button used on the auth screens.
 * Dart: `Color.fromRGBO(249, 250, 251, 0.65)`, `EdgeInsets.all(6.5)`.
 */
export function AuthBackButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={onPress ?? (() => router.back())}
      hitSlop={8}
      style={styles.authBack}
    >
      <BackArrow color={colors.black} size={20} />
    </Pressable>
  );
}

/** Material `Icons.arrow_back` drawn with views so no icon font is needed. */
function BackArrow({ color, size }: { color: string; size: number }) {
  const s = r(size);
  return (
    <View style={{ width: s, height: s, justifyContent: 'center' }}>
      <View
        style={{
          width: s * 0.55,
          height: s * 0.55,
          borderLeftWidth: 2,
          borderBottomWidth: 2,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginLeft: s * 0.1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: s * 0.1,
          right: 0,
          height: 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: r(56),
    paddingHorizontal: r(16),
    backgroundColor: colors.white,
  },
  leading: {
    minWidth: r(32),
  },
  titleWrap: {
    flex: 1,
    paddingHorizontal: r(8),
  },
  titleCentered: {
    alignItems: 'center',
  },
  title: {
    // Dart appBarTheme: headlineMedium @ 20sp w600
    ...textTheme.headlineMedium,
    fontSize: spMin(20),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: r(4),
  },
  backPlain: {
    width: r(30),
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backCircle: {
    width: r(30),
    height: r(30),
    borderRadius: r(100),
    // Dart: Colors.grey.shade200
    backgroundColor: '#EEEEEE',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: r(4),
  },
  authBack: {
    width: r(33),
    height: r(33),
    borderRadius: r(100),
    backgroundColor: 'rgba(249, 250, 251, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
