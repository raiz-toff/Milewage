#!/usr/bin/env bash
# Release APK of the native Android app (apps/android), on a machine with JDK 17 and the Android SDK.
# Output: apps/android/app/build/outputs/apk/release/app-release.apk
# Signing: the upload key when $HOME/.milewage/keystore.env (or MILEWAGE_KEYSTORE_ENV) exists, read
# by scripts/phone-signing-env.sh exactly as for the Expo app (same key, same applicationId
# app.milewage.phone, so this APK installs over the Expo one); otherwise the debug key.
# versionName: the VERSION file. versionCode: MILEWAGE_VERSION_CODE (default 3, above the Expo
# app's last release, 2). Raise it for every build handed out.
# Runs the unit tests and lint before building. --publish PATH (or MILEWAGE_APK_PUBLISH=PATH) then
# copies the APK where the server hands it out (scripts/publish-apk.sh). Other arguments go to Gradle.
# Not yet the release process: scripts/phone-release-build.sh still builds the Expo app.
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
[[ -n "${MILEWAGE_KEYSTORE_PATH:-}" ]] || echo "(For this app: the Android debug key.)"

cd "$HERE"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" >local.properties
./gradlew --no-daemon test lint assembleRelease ${gradle_args[@]+"${gradle_args[@]}"}

apk=app/build/outputs/apk/release/app-release.apk
ls -l "$apk"
if [[ -n "$publish" ]]; then
  "$ROOT/scripts/publish-apk.sh" "$apk" "$publish"
fi
