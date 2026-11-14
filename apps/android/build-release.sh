#!/usr/bin/env bash
# Release APK of the native Android app (apps/android), on a machine with JDK 17 and the Android SDK.
# The release process calls it through scripts/phone-release-build.sh (same flags).
# Output: apps/android/app/build/outputs/apk/release/app-release.apk, and a copy beside it named
# milewage-<VERSION>.apk, the file attached to the GitHub release; and the App Bundle for Google Play,
# app/build/outputs/bundle/release/app-release.aab with milewage-<VERSION>.aab beside it.
# Signing: the upload key when $HOME/.milewage/keystore.env (or MILEWAGE_KEYSTORE_ENV) exists, made
# once by scripts/phone-keystore.sh and read by scripts/phone-signing-env.sh; otherwise the Android
# debug key (not for Google Play). Same key and applicationId (app.milewage.phone) as the retired
# Expo app, so this APK installs over it.
# versionName: the VERSION file. versionCode: MILEWAGE_VERSION_CODE, or the default in
# app/build.gradle.kts (`npm run version:check` keeps it at or above the last released one). Raise it
# for every build handed out.
# Runs the unit tests, lint and the manifest and dependency policy before building. --publish PATH
# (or MILEWAGE_APK_PUBLISH=PATH) then copies the APK where the server hands it out
# (scripts/publish-apk.sh). Other arguments go to Gradle.
set -euo pipefail

publish="${MILEWAGE_APK_PUBLISH:-}"
gradle_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) publish="${2:?--publish needs a path}"; shift 2 ;;
    *) gradle_args+=("$1"); shift ;;
  esac
done
case "$publish" in '' | /*) ;; *) publish="$PWD/$publish" ;; esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if ! java -version 2>&1 | grep -q '"17\.'; then
  echo "JDK 17 required on PATH (JAVA_HOME=${JAVA_HOME:-unset})." >&2
  exit 1
fi
if [[ ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "Android SDK not found at $ANDROID_HOME (set ANDROID_HOME)." >&2
  exit 1
fi

# shellcheck source=../../scripts/phone-signing-env.sh
. "$ROOT/scripts/phone-signing-env.sh"
milewage_signing_env

version="$(tr -d ' \r\n' <"$ROOT/VERSION")"
echo "MileWage $version, versionCode ${MILEWAGE_VERSION_CODE:-default (app/build.gradle.kts)}."

cd "$HERE"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" >local.properties
./gradlew --no-daemon test lint assembleRelease bundleRelease ${gradle_args[@]+"${gradle_args[@]}"}

apk=app/build/outputs/apk/release/app-release.apk
named="app/build/outputs/apk/release/milewage-$version.apk"
cp "$apk" "$named"
# The App Bundle for Google Play (npm run play:release uploads it).
aab=app/build/outputs/bundle/release/app-release.aab
named_aab="app/build/outputs/bundle/release/milewage-$version.aab"
cp "$aab" "$named_aab"
ls -l "$apk" "$named" "$aab" "$named_aab"
if [[ -n "$publish" ]]; then
  "$ROOT/scripts/publish-apk.sh" "$apk" "$publish"
fi
