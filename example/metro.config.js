const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
module.exports = (async () => {
  // react-native-monorepo-config is ESM-only; require() of an ES module is
  // only supported from Node 20.19/22.12, so load it with a dynamic import
  // to keep this config working on any Node version (metro awaits promise
  // exports).
  const { withMetroConfig } = await import('react-native-monorepo-config');
  return withMetroConfig(getDefaultConfig(__dirname), {
    root,
    dirname: __dirname,
    conditions: ['azzapp-react-native-skia-video-source'],
  });
})();
