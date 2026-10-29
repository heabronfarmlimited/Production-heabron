/**
 * Splash — ported from
 * modules/startup/presentation/view/splash_view.dart
 *
 * Dart layout: `splash_bg.png` as a cover background with `splash_image.png`
 * centred at 261w x 154h, and a fixed 2-second delay before routing.
 *
 * FIXED — the Dart version decided the route with only
 * `if (user?.status != 'active') -> under-review`, so a *rejected* agent could
 * never reach the NIN correction screen on a cold start; they had to log out
 * and sign in again for `LoginController` to route them there. Routing now
 * goes through `resolveSessionRoute`, shared with login.
 *
 * It also waited the full 2s even when a session was already cached. Here the
 * delay runs concurrently with a profile refresh, so the splash is never
 * longer than it needs to be but never flashes either.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Image, ImageBackground, StyleSheet, View } from 'react-native';

import { sessionRoutePath } from '../../../core/navigation/routes';
import { authStorage } from '../../../core/storage/authStorage';
import { images } from '../../../core/theme/assets';
import { h, w } from '../../../core/theme/responsive';
import * as authApi from '../../auth/api/authApi';
import { resolveSessionRoute, useAuthStore } from '../../auth/model/authStore';

/** Dart: `Future.delayed(const Duration(seconds: 2))`. */
const SPLASH_MS = 2000;

export function SplashScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const navigated = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const hasToken = authStorage.isAuthenticated();
      const cached = authStorage.getCachedUser() ?? null;

      // Hold the brand frame for the same 2s the Dart app did, while
      // refreshing the profile in parallel so status changes (an approval
      // granted since last launch) are picked up immediately.
      const minimumWait = new Promise<void>((resolve) =>
        setTimeout(resolve, SPLASH_MS),
      );

      const profile = hasToken
        ? authApi
            .fetchMe()
            .then((user) => {
              if (!cancelled) setUser(user);
              return user;
            })
            // A failed refresh (offline, or an expired refresh token) falls
            // back to the cached user rather than stranding the agent here.
            .catch(() => cached)
        : Promise.resolve(null);

      const [user] = await Promise.all([profile, minimumWait]);

      if (cancelled || navigated.current) return;
      navigated.current = true;

      const target = resolveSessionRoute(
        user ?? cached,
        authStorage.isAuthenticated(),
      );
      router.replace(sessionRoutePath[target]);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, setUser]);

  return (
    <View style={styles.root}>
      <ImageBackground
        source={images.splashBg}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.center}>
          <Image
            source={images.splashImage}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Heabron CoopScore"
          />
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    // Dart: width: 261.w, height: 154.h
    width: w(261),
    height: h(154),
  },
});
