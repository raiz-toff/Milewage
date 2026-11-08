// Release signing for android/app/build.gradle, as pure text rewrites (tested in
// test/releaseSigning.test.ts). The key comes from environment variables at Gradle time, never from
// a file in the repository: scripts/phone-keystore.sh makes it, scripts/phone-signing-env.sh exports
// these. Without MILEWAGE_KEYSTORE_PATH the release build keeps the debug key, so dev builds work.
const MARKER = '// MileWage release signing (plugins/withReleaseSigning.js)';

const ENV = {
  path: 'MILEWAGE_KEYSTORE_PATH',
  storePassword: 'MILEWAGE_KEYSTORE_PASSWORD',
  alias: 'MILEWAGE_KEY_ALIAS',
  keyPassword: 'MILEWAGE_KEY_PASSWORD',
};

const RELEASE_CONFIG = [
  `        ${MARKER}`,
  `        if (System.getenv('${ENV.path}')) {`,
  '            release {',
  `                storeFile file(System.getenv('${ENV.path}'))`,
  `                storePassword System.getenv('${ENV.storePassword}')`,
  `                keyAlias System.getenv('${ENV.alias}')`,
  `                keyPassword System.getenv('${ENV.keyPassword}')`,
  '            }',
  '        }',
].join('\n');

const RELEASE_USES = `signingConfig System.getenv('${ENV.path}') ? signingConfigs.release : signingConfigs.debug`;

/**
 * Adds a `release` signing config read from the environment and makes the release build type use
 * it when the keystore path is set. Idempotent. Throws when the template no longer has the expected
 * shape, so a changed Expo template fails the build instead of silently signing with the debug key.
 */
function addReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;

  const signing = /^(\s*)signingConfigs \{\n/m;
  if (!signing.test(gradle)) throw new Error('withReleaseSigning: no signingConfigs block found');
  let out = gradle.replace(signing, (m) => `${m}${RELEASE_CONFIG}\n`);

  const release = /(\n\s*release \{\n(?:(?!\n\s*\}\n)[\s\S])*?)signingConfig signingConfigs\.debug/;
  const buildTypes = out.indexOf('buildTypes {');
  if (buildTypes < 0) throw new Error('withReleaseSigning: no buildTypes block found');
  const head = out.slice(0, buildTypes);
  const tail = out.slice(buildTypes);
  if (!release.test(tail)) {
    throw new Error(
      'withReleaseSigning: the release build type has no debug signingConfig to replace',
    );
  }
  out = head + tail.replace(release, (_m, before) => `${before}${RELEASE_USES}`);
  return out;
}

module.exports = { MARKER, ENV, RELEASE_CONFIG, RELEASE_USES, addReleaseSigning };
