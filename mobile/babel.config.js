module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo adds the react-native-worklets plugin itself when
    // react-native-reanimated 4 is installed, so no manual plugin entry.
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
  };
};
