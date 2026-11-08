const { withAppBuildGradle } = require('expo/config-plugins');
const { addReleaseSigning } = require('./releaseSigning');

/**
 * Signs the release APK with the upload key from the environment (plugins/releaseSigning.js) after
 * `expo prebuild` writes android/app/build.gradle. Falls back to the debug key when it is unset.
 */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: android/app/build.gradle must be Groovy');
    }
    cfg.modResults.contents = addReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
