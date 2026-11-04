// Android permission policy of 09 section 5.3, in one place for the config plugin and the lint test.
const PREFIX = 'android.permission.';

/** The only permissions the app declares. */
const ALLOWED = [
  'ACCESS_FINE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_LOCATION',
  'ACTIVITY_RECOGNITION',
  'POST_NOTIFICATIONS',
];

/** Never requested (09 section 5.2 and 5.3); transitive copies are stripped by the plugin. */
const FORBIDDEN = [
  'SYSTEM_ALERT_WINDOW',
  'RECEIVE_BOOT_COMPLETED',
  'SCHEDULE_EXACT_ALARM',
  'RECORD_AUDIO',
  'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  // Pulled in by expo-secure-store's library manifest; the app never asks for biometrics.
  'USE_BIOMETRIC',
  'USE_FINGERPRINT',
  // Pulled in by expo-file-system (an Expo dependency); the app reads and writes only its own storage.
  'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE',
].map((n) => PREFIX + n);

/** Names of the permissions a manifest XML text really requests (`tools:node="remove"` is not a request). */
function requestedPermissions(xml) {
  const names = [];
  for (const tag of xml.match(/<uses-permission\b[^>]*>/g) ?? []) {
    if (/tools:node="remove"/.test(tag)) continue;
    const name = /android:name="([^"]+)"/.exec(tag);
    if (name) names.push(name[1]);
  }
  return names;
}

/** Forbidden permissions found in a manifest XML text (empty means clean). */
function forbiddenIn(xml) {
  return requestedPermissions(xml).filter((n) => FORBIDDEN.includes(n));
}

module.exports = { PREFIX, ALLOWED, FORBIDDEN, requestedPermissions, forbiddenIn };
