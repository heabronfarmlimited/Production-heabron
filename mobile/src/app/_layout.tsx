/**
 * Root layout — replaces lib/main.dart and lib/app.dart.
 *
 * main.dart did: `ensureInitialized()` -> `initDb()` (Hive) ->
 * `setupLocator()` (get_it) -> portrait lock -> `runApp(ProviderScope(...))`.
 * app.dart then wrapped a `MaterialApp` in `ToastificationWrapper` and
 * `ScreenUtilInit`, set the theme and `onGenerateRoute`, and started at
 * `SplashView.route`.
 *
 * Here: MMKV needs no init, DI is plain imports, orientation is locked in
 * app.config.ts, and routing is file-based. What remains is the provider tree,
 * fonts, the toast host, and the responsive-dimension subscription.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreenModule from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { setSessionExpiredHandler } from '../core/api/client';
import { queryClient } from '../core/api/queryClient';
import { colors } from '../core/theme/colors';
import { subscribeToDimensions } from '../core/theme/responsive';
import { useSessionExpiredHandler } from '../features/auth/hooks/useAuth';
import { useOfflineFarmerQueue } from '../features/farmers/hooks/useOfflineFarmerQueue';

// Keep the native splash up until fonts are ready, so the first frame isn't
// unstyled text.
void SplashScreenModule.preventAutoHideAsync();

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

  // Keeps `w()/h()/r()/spMin()` correct across rotation and split screen,
  // which is what ScreenUtilInit did.
  useEffect(() => subscribeToDimensions(), []);

  useEffect(() => {
    // A font failure must not leave the app stuck behind the splash.
    if (fontsLoaded || fontError) void SplashScreenModule.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

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
