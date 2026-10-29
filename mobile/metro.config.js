/**
 * Metro config — adds SVG support so `assets/icons/*.svg` can be imported as
 * React components (the Flutter app used `flutter_svg` for the logo, nav icons
 * and the account-under-review illustration).
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve(
  'react-native-svg-transformer',
);
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
