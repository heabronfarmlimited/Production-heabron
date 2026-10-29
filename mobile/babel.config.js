module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Must be listed last.
      'react-native-reanimated/plugin',
    ],
  };
};
