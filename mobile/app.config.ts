/**
 * Expo app config — replaces pubspec.yaml's flutter block, the
 * flutter_launcher_icons config, and the native manifest entries.
 *
 * Environment values are surfaced through `extra`, which `expo-constants`
 * reads at runtime. This is the RN equivalent of Flutter's
 * `--dart-define-from-file=env.json`.
 */
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Heabron',
  slug: 'heabron-mobile',
  version: '1.0.0',
  orientation: 'portrait', // main.dart locks portraitUp + portraitDown
  icon: './src/assets/images/app_icon.png',
  scheme: 'heabron',
  userInterfaceStyle: 'light', // the app ships a light theme only
  newArchEnabled: true,

  splash: {
    image: './src/assets/images/splash_image.png',
    resizeMode: 'cover',
    backgroundColor: '#FFFFFF',
  },

  assetBundlePatterns: ['**/*'],

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.heabron.mobile',
    buildNumber: '1',
    infoPlist: {
      // geolocator -> expo-location (farm boundary mapping)
      NSLocationWhenInUseUsageDescription:
        'Heabron uses your location to map farm boundaries and compute farm size.',
      // image_picker -> expo-image-picker
      NSCameraUsageDescription:
        'Heabron uses the camera to capture farmer photos, ID documents and payment receipts.',
      NSPhotoLibraryUsageDescription:
        'Heabron needs access to your photos to attach farmer documents and receipts.',
    },
  },

  android: {
    package: 'com.heabron.mobile',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './src/assets/images/app_icon.png',
      backgroundColor: '#FFFFFF',
    },
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'READ_EXTERNAL_STORAGE',
      'INTERNET',
    ],
  },

  plugins: [
    'expo-router',
    [
      'expo-font',
      {
        fonts: [
          './src/assets/fonts/Manrope-ExtraLight.ttf',
          './src/assets/fonts/Manrope-Light.ttf',
          './src/assets/fonts/Manrope-Regular.ttf',
          './src/assets/fonts/Manrope-Medium.ttf',
          './src/assets/fonts/Manrope-SemiBold.ttf',
          './src/assets/fonts/Manrope-Bold.ttf',
          './src/assets/fonts/Manrope-ExtraBold.ttf',
        ],
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Heabron needs access to your photos to attach farmer documents and receipts.',
        cameraPermission:
          'Heabron uses the camera to capture farmer photos, ID documents and payment receipts.',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Heabron uses your location to map farm boundaries and compute farm size.',
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  /**
   * Values read by src/core/config/env.ts.
   *
   * The base URL MUST include the `/api` suffix — e.g.
   *   https://heabron-coopscore.vercel.app/api
   * as documented in env_example.json and APP_DEV_HANDOFF.md.
   */
  extra: {
    stagingBaseUrl: process.env.STAGING_BASE_URL,
    productionBaseUrl: process.env.PRODUCTION_BASE_URL,
    useStaging: process.env.USE_STAGING !== 'false',
  },
};

export default config;
