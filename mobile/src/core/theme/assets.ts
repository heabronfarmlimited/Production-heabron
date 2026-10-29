/**
 * Asset registry — ported from lib/src/core/utils/app_assets.dart
 *
 * Flutter referenced assets by string path. React Native resolves them at
 * build time through `require`, so these are module references, not strings.
 * SVGs are imported as components via `react-native-svg-transformer`.
 */

/** Raster images — pass straight to <Image source={...} />. */
export const images = {
  splashImage: require('../../assets/images/splash_image.png'),
  splashBg: require('../../assets/images/splash_bg.png'),
  authBg: require('../../assets/images/auth_bg.png'),
  appBarBg: require('../../assets/images/app_bar_bg.png'),
  appIcon: require('../../assets/images/app_icon.png'),
  preAuthIconCenter: require('../../assets/icons/preauth_icon_center.png'),
} as const;

/**
 * SVG paths. These are imported as React components where used, e.g.
 *   import LogoIcon from '@/assets/icons/logo_icon.svg';
 * The registry below exists for parity with AppAssets and for any
 * dynamic lookup by name.
 */
export const svgNames = {
  logoIcon: 'logo_icon',
  logoVerticalText: 'logo_text_icon',
  accountUnderReview: 'account_under_review',
  navHome: 'nav/home',
  navCooperatives: 'nav/cooperatives',
  navWallet: 'nav/wallet',
  navFarmers: 'nav/farmers',
  navActivities: 'nav/activities',
} as const;

/** Static JSON — the state/LGA dataset backing StateLgaDropdown. */
export const data = {
  nigeriaStatesLga: require('../../assets/json/nigeria_states_lga.json'),
} as const;
