const { withAndroidManifest } = require('expo/config-plugins');
const { FORBIDDEN } = require('./manifestPolicy');

/**
 * Strips forbidden permissions that autolinked libraries or React Native pull in (for example
 * SYSTEM_ALERT_WINDOW). `tools:node="remove"` makes the manifest merger drop every copy.
 */
module.exports = function withManifestPolicy(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    const own = manifest['uses-permission'] || [];
    manifest['uses-permission'] = own
      .filter((p) => !(p.$ && FORBIDDEN.includes(p.$['android:name'])))
      .concat(FORBIDDEN.map((name) => ({ $: { 'android:name': name, 'tools:node': 'remove' } })));
    return cfg;
  });
};
