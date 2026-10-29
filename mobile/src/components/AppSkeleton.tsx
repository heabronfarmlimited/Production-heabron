/**
 * Screen shell — ported from lib/src/shared/app_skeleton.dart
 *
 * The Dart widget wrapped a Scaffold in a `LoadingOverlay` + `IgnorePointer`,
 * applied a default horizontal padding of 16, optionally painted a background
 * image, and dismissed the keyboard on background tap. Same contract here.
 */
import type { ReactNode } from 'react';
import type {
  ImageSourcePropType,
  StyleProp,
  ViewStyle} from 'react-native';
import {
  ImageBackground,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../core/theme/colors';
import { r } from '../core/theme/responsive';
import { textTheme } from '../core/theme/typography';

import { AppLoading } from './AppLoading';
import { BaseAppBar } from './BaseAppBar';

export interface AppSkeletonProps {
  /** Blocks interaction and shows the overlay spinner. */
  isBusy?: boolean;
  busyText?: string;
  children?: ReactNode;
  backgroundColor?: string;
  /** Renders a BaseAppBar with this title. */
  appBarTitle?: string;
  appBarTitleWidget?: ReactNode;
  appBarActions?: ReactNode;
  appBarLeading?: ReactNode;
  centerTitle?: boolean;
  /** Dart default: `EdgeInsets.symmetric(horizontal: 16)`. */
  bodyPadding?: StyleProp<ViewStyle>;
  /** Full-bleed background image, `BoxFit.cover`. */
  backgroundImage?: ImageSourcePropType;
  bottomBar?: ReactNode;
  /** Wraps children in a ScrollView. Most Dart screens scrolled their body. */
  scrollable?: boolean;
  /** Pull-to-refresh, when scrollable. */
  refreshControl?: React.ReactElement;
  /** Dart `resizeToAvoidBottomInset: isAuthSkeleton`. */
  avoidKeyboard?: boolean;
  testID?: string;
}

export function AppSkeleton({
  isBusy = false,
  busyText,
  children,
  backgroundColor,
  appBarTitle,
  appBarTitleWidget,
  appBarActions,
  appBarLeading,
  centerTitle = false,
  bodyPadding,
  backgroundImage,
  bottomBar,
  scrollable = false,
  refreshControl,
  avoidKeyboard = true,
  testID,
}: AppSkeletonProps) {
  const padding = bodyPadding ?? styles.defaultPadding;

  const body = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[padding, styles.scrollContent]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padding]}>{children}</View>
  );

  const content = (
    <>
      {appBarTitle || appBarTitleWidget || appBarActions || appBarLeading ? (
        <BaseAppBar
          title={appBarTitle}
          titleWidget={appBarTitleWidget}
          actions={appBarActions}
          leading={appBarLeading}
          centerTitle={centerTitle}
        />
      ) : null}
      {body}
      {bottomBar}
    </>
  );

  return (
    <SafeAreaView
      testID={testID}
      style={[styles.root, { backgroundColor: backgroundColor ?? colors.background }]}
      edges={['top', 'left', 'right']}
    >
      {/* Dart dismissed the keyboard via GestureDetector on the Scaffold. */}
      <Pressable
        style={styles.flex}
        onPress={avoidKeyboard ? () => Keyboard.dismiss() : undefined}
        // Taps must still reach children; this only catches background taps.
        android_disableSound
        accessible={false}
      >
        {backgroundImage ? (
          <ImageBackground
            source={backgroundImage}
            style={styles.flex}
            resizeMode="cover"
          >
            {content}
          </ImageBackground>
        ) : (
          content
        )}
      </Pressable>

      {isBusy ? (
        <View style={styles.overlay} pointerEvents="auto">
          <View style={styles.overlayCard}>
            <AppLoading color={colors.primary} size="large" />
            {busyText ? <Text style={styles.busyText}>{busyText}</Text> : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  defaultPadding: {
    paddingHorizontal: r(16),
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: r(24),
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Dart: Colors.white.withValues(alpha: .4)
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    width: r(100),
    height: r(100),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: r(12),
    backgroundColor: colors.white,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  busyText: {
    ...textTheme.bodySmall,
    marginTop: r(8),
    textAlign: 'center',
  },
});
