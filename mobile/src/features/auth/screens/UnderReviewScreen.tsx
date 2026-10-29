/**
 * Account under review — ported from
 * modules/authentication/presentation/view/profile_under_review.dart
 *
 * Dart layout: `auth_bg.png` cover background, 193 space,
 * `account_under_review.svg`, 38 space, 'We’re verifying your Identity'
 * (20sp w600 white), 17 space, "We'll let you know once it's complete"
 * (16sp w500 white, centred). White bottom sheet with 'Back to Login',
 * which cleared storage and returned to login.
 *
 * IMPROVED — the Dart screen was a dead end: it never re-checked status, so an
 * agent approved by an admin had to clear storage and sign in again to get in.
 * This refreshes the profile on focus and on pull/tap, and routes onward the
 * moment the account becomes active (or to NIN correction if it was rejected).
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AccountUnderReview from '../../../assets/images/account_under_review.svg';
import { AppButton } from '../../../components/AppButton';
import { AppLoading } from '../../../components/AppLoading';
import { sessionRoutePath } from '../../../core/navigation/routes';
import { images } from '../../../core/theme/assets';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import * as authApi from '../api/authApi';
import { useLogout } from '../hooks/useAuth';
import { resolveSessionRoute, useAuthStore } from '../model/authStore';

export function UnderReviewScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const { mutate: logout, isPending: loggingOut } = useLogout();
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const user = await authApi.fetchMe();
      setUser(user);

      const target = resolveSessionRoute(user, true);
      // Only move if the account is no longer simply pending.
      if (target !== 'under-review') {
        router.replace(sessionRoutePath[target]);
      }
    } catch {
      // Offline or an expired session — stay put; the agent can retry.
    } finally {
      setChecking(false);
    }
  }, [router, setUser]);

  // Re-check whenever the screen comes into view.
  useFocusEffect(
    useCallback(() => {
      void checkStatus();
    }, [checkStatus]),
  );

  return (
    <View style={styles.root}>
      <ImageBackground
        source={images.authBg}
        style={styles.background}
        resizeMode="cover"
      >
        <SafeAreaView style={styles.flex} edges={['top']}>
          <View style={styles.body}>
            <View style={{ height: h(193) }} />

            <AccountUnderReview width={r(160)} height={r(160)} />

            <View style={{ height: h(38) }} />

            <Text style={styles.title}>We’re verifying your Identity</Text>

            <View style={{ height: h(17) }} />

            <Text style={styles.subtitle}>
              We&apos;ll let you know once it&apos;s complete
            </Text>

            <View style={{ height: h(24) }} />

            <Pressable
              accessibilityRole="button"
              onPress={checkStatus}
              disabled={checking}
              hitSlop={8}
              style={styles.refreshRow}
            >
              {checking ? (
                <AppLoading color={colors.white} />
              ) : (
                <Text style={styles.refreshText}>Check status again</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>

        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetInner}>
            <View style={{ height: h(32) }} />
            <AppButton
              text="Back to Login"
              loading={loggingOut}
              onPress={() => logout()}
              testID="under-review-logout"
            />
            <View style={{ height: h(32) }} />
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  background: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingHorizontal: r(16),
    alignItems: 'center',
  },
  title: {
    ...textTheme.headlineMedium,
    fontSize: spMin(20),
    color: colors.white,
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    ...textTheme.headlineMedium,
    fontSize: spMin(16),
    color: colors.white,
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    textAlign: 'center',
  },
  refreshRow: {
    minHeight: r(24),
    justifyContent: 'center',
  },
  refreshText: {
    ...textTheme.bodySmall,
    fontSize: spMin(14),
    color: colors.white,
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: r(24),
    borderTopRightRadius: r(24),
    overflow: 'hidden',
  },
  sheetInner: {
    paddingHorizontal: r(16),
    paddingVertical: r(24),
  },
});
