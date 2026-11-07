// NativeWind as in Comma (commaApp babel.config.js). Jest skips it: class names have no
// stylesheet there, and the tests check behaviour, not paint.
module.exports = function (api) {
  const test = api.env('test');
  api.cache.using(() => test);
  return {
    presets: test
      ? ['babel-preset-expo']
      : [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
