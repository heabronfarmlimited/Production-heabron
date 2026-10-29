/**
 * Metro config — adds SVG support so `assets/icons/*.svg` can be imported as
 * React components (the Flutter app used `flutter_svg` for the logo, nav icons
 * and the account-under-review illustration).
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The `/expo` entry delegates to Expo's own Babel transformer; the default
// entry delegates to React Native's, which does not understand Expo's config.
config.transformer.babelTransformerPath = require.resolve(
  'react-native-svg-transformer/expo',
);
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
