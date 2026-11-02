/**
 * Root layout — replaces lib/main.dart and lib/app.dart.
 *
 * main.dart did: `ensureInitialized()` -> `initDb()` (Hive) ->
 * `setupLocator()` (get_it) -> portrait lock -> `runApp(ProviderScope(...))`.
 * app.dart then wrapped a `MaterialApp` in `ToastificationWrapper` and
 * `ScreenUtilInit`, set the theme and `onGenerateRoute`, and started at
 * `SplashView.route`.
 *
 * Here: storage needs no init, DI is plain imports, orientation is locked in
 * app.config.ts, and routing is file-based. What remains is the provider tree,
 * fonts, the toast host, and the responsive-dimension subscription.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreenModule from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { setSessionExpiredHandler } from '../core/api/client';
import { queryClient } from '../core/api/queryClient';
import { colors } from '../core/theme/colors';
import { preloadAssets } from '../core/theme/preloadAssets';
import { subscribeToDimensions } from '../core/theme/responsive';
import { applyTextScalingPolicy } from '../core/theme/textScaling';
import { useSessionExpiredHandler } from '../features/auth/hooks/useAuth';
import { useOfflineFarmerQueue } from '../features/farmers/hooks/useOfflineFarmerQueue';

// Keep the native splash up until fonts are ready, so the first frame isn't
// unstyled text.
void SplashScreenModule.preventAutoHideAsync();

// Bound the OS font-size multiplier before anything renders. The user's
// accessibility setting is still honoured — just capped, so a 3x system font
// cannot overflow fixed-height rows, buttons and the tab bar.
applyTextScalingPolicy();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Manrope-ExtraLight': require('../assets/fonts/Manrope-ExtraLight.ttf'),
    'Manrope-Light': require('../assets/fonts/Manrope-Light.ttf'),
    'Manrope-Regular': require('../assets/fonts/Manrope-Regular.ttf'),
    'Manrope-Medium': require('../assets/fonts/Manrope-Medium.ttf'),
    'Manrope-SemiBold': require('../assets/fonts/Manrope-SemiBold.ttf'),
    'Manrope-Bold': require('../assets/fonts/Manrope-Bold.ttf'),
    'Manrope-ExtraBold': require('../assets/fonts/Manrope-ExtraBold.ttf'),
  });

  /**
   * The bundled images are warmed alongside the fonts.
   *
   * FIXED — the splash used to lift on the fonts alone, so the first screen
   * painted its layout and then its background artwork snapped in behind the
   * text a moment later. On a mid-range Android that reads as the app
   * lagging, and it was: work happening in front of the agent instead of
   * behind the splash, where a loading indicator is already showing.
   *
   * `preloadAssets` never rejects, so a missing image cannot hold the splash.
   */
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void preloadAssets().finally(() => {
      if (!cancelled) setAssetsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps `w()/h()/r()/spMin()` correct across rotation and split screen,
  // which is what ScreenUtilInit did.
  useEffect(() => subscribeToDimensions(), []);

  const ready = (fontsLoaded || fontError) && assetsLoaded;

  useEffect(() => {
    // A font or image failure must not leave the app stuck behind the splash.
    if (ready) void SplashScreenModule.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AppShell />
          {/* Toast host must sit above the navigator — toastification's
              ToastificationWrapper did the same in Dart. */}
          <Toast />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Lives inside the providers so it can use router- and query-aware hooks.
 */
function AppShell() {
  const handleSessionExpired = useSessionExpiredHandler();

  // The axios interceptor calls this when a token refresh fails, instead of
  // reaching into the route table as the Dart NetworkInterceptor did.
  useEffect(() => {
    setSessionExpiredHandler(handleSessionExpired);
  }, [handleSessionExpired]);

  // Mounting this attaches the connectivity listener that drains the offline
  // farmer queue. In Flutter the equivalent lived in `FarmersController.init()`,
  // which nothing ever called — so auto-sync never actually ran.
  useOfflineFarmerQueue();

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          // Dart PageTransitionsTheme: OpenUpwards on Android, Cupertino on iOS.
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}
