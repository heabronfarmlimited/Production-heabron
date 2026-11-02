/**
 * Expo app config — replaces pubspec.yaml's flutter block, the
 * flutter_launcher_icons config, and the native manifest entries.
 *
 * Environment values are surfaced through `extra`, which `expo-constants`
 * reads at runtime. This is the RN equivalent of Flutter's
 * `--dart-define-from-file=env.json`.
 */
import type { ExpoConfig } from 'expo/config';

/**
 * The API base URL, checked at BUILD time.
 *
 * `src/core/config/env.ts` throws when the URL is missing, which is right for
 * a developer running `expo start` — but on a release build that throw
 * happens on a tester's phone, on launch, as a white screen. By then the
 * build has taken fifteen minutes and been sent out.
 *
 * EAS sets `EAS_BUILD=true` on its builders, so the same mistake is caught
 * there instead, before anything is compiled. The `/api` suffix is checked
 * too: without it every request 404s and the app looks broken rather than
 * misconfigured, and it is the single most common mistake with this value.
 */
function assertBuildEnv(): void {
  if (process.env.EAS_BUILD !== 'true') return;

  const useStaging = process.env.USE_STAGING !== 'false';
  const name = useStaging ? 'STAGING_BASE_URL' : 'PRODUCTION_BASE_URL';
  const url = process.env[name];
  const profile = process.env.EAS_BUILD_PROFILE || 'unknown';

  if (!url) {
    throw new Error(
      `[app.config] ${name} is not set for the "${profile}" build profile.\n` +
        `Set it under build.${profile}.env in eas.json. The app cannot reach ` +
        'any server without it, and would install and then fail on launch.',
    );
  }
  if (!/^https:\/\//.test(url)) {
    throw new Error(
      `[app.config] ${name} must be https — got "${url}". Android blocks ` +
        'cleartext traffic in a release build, so http:// cannot work on a phone.',
    );
  }
  if (!/\/api\/?$/.test(url)) {
    throw new Error(
      `[app.config] ${name} must end with /api — got "${url}". Without the ` +
        'suffix every request 404s and the app looks broken rather than misconfigured.',
    );
  }
}

assertBuildEnv();

const config: ExpoConfig = {
  name: 'Heabron',
  slug: 'heabron-mobile',
  version: '1.0.0',
  /**
   * The Expo account that owns the EAS project.
   *
   * Written here rather than left to whoever is logged in: without it, a
   * second person running `eas build` from their own account creates a
   * SEPARATE project with its own keystore, and the APKs it produces will
   * not install over the ones already on testers' phones.
   */
  owner: 'dammy-v',
  orientation: 'portrait', // main.dart locks portraitUp + portraitDown
  icon: './src/assets/images/app_icon.png',
  scheme: 'heabron',
  userInterfaceStyle: 'light', // the app ships a light theme only

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
      'expo-splash-screen',
      {
        image: './src/assets/images/splash_image.png',
        resizeMode: 'cover',
        backgroundColor: '#FFFFFF',
      },
    ],
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

    /**
     * The EAS project, from `eas init`.
     *
     * `eas init` writes this itself into a static app.json, but this config
     * is TypeScript — it cannot edit code — so it prints the value and stops
     * with "Cannot automatically write to dynamic config". Pasting it here is
     * the documented completion of that step, not a workaround.
     *
     * Not a secret: it identifies the project, it does not grant access to
     * it. Builds are authorised by the account you log in with.
     */
    eas: {
      projectId: '730a4e60-40b3-4e69-b841-d44fd9c54e62',
    },
  },
};

export default config;