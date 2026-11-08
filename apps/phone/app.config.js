// Expo app config (was app.json). CommonJS, read by Expo, jest and scripts/version.mjs.
// `version` is the root VERSION file (scripts/version.mjs check asserts it); `android.versionCode`
// is MILEWAGE_VERSION_CODE, an integer that must grow with every build uploaded to Google Play.
const { readFileSync } = require('fs');
const { join } = require('path');

// Google Play's largest allowed versionCode.
const MAX_VERSION_CODE = 2100000000;

function versionCode(raw = process.env.MILEWAGE_VERSION_CODE) {
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > MAX_VERSION_CODE) {
    throw new Error(
      `MILEWAGE_VERSION_CODE must be a whole number from 1 to ${MAX_VERSION_CODE}, got "${raw}"`,
    );
  }
  return n;
}

const version = readFileSync(join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();

module.exports = {
  expo: {
    name: 'MileWage',
    slug: 'milewage',
    version,
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    scheme: 'milewage',
    android: {
      package: 'app.milewage.phone',
      versionCode: versionCode(),
      predictiveBackGestureEnabled: false,
      permissions: [
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'ACTIVITY_RECOGNITION',
        'POST_NOTIFICATIONS',
        'POST_PROMOTED_NOTIFICATIONS',
        'CAMERA',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
        backgroundColor: '#101214',
      },
    },
    plugins: [
      './plugins/withManifestPolicy',
      './plugins/withReleaseSigning',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 160,
          resizeMode: 'contain',
          backgroundColor: '#101214',
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            minSdkVersion: 24,
            // Plan 28: http only to home-network addresses, enforced in ApiClient (Android's
            // network security config cannot express IP ranges, so the platform allows it).
            usesCleartextTraffic: true,
            allowBackup: false,
          },
        },
      ],
    ],
    icon: './assets/icon.png',
    backgroundColor: '#101214',
  },
};
