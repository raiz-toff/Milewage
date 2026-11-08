#!/usr/bin/env bash
# Release APK build of the phone app on the `coder` machine (Node 22.22, JDK 17, Android SDK).
# Output: apps/phone/android/app/build/outputs/apk/release/app-release.apk
# Signing: with the upload key when $HOME/.milewage/keystore.env (or MILEWAGE_KEYSTORE_ENV) exists
# (made once by scripts/phone-keystore.sh; see scripts/phone-signing-env.sh), else the Expo debug key.
# versionCode: MILEWAGE_VERSION_CODE (integer, default 1; apps/phone/app.config.js). Raise it for
# every build uploaded to Google Play. versionName comes from the VERSION file.
# --publish PATH (or MILEWAGE_APK_PUBLISH=PATH): then copy it to PATH, where the server hands it out
# (scripts/publish-apk.sh; e.g. .dev/config/milewage.apk for `npm run dev`). Other arguments go to Gradle.
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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${NODE22_BIN:-$HOME/.local/node22/bin}:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

want="$(tr -d 'v \n' <"$ROOT/.nvmrc")"
have="$(node -p 'process.versions.node')"
if [[ "$have" != "$want"* ]]; then
  echo "Node $want required (found $have). Set NODE22_BIN to a Node 22.22 bin directory." >&2
  exit 1
fi
if ! java -version 2>&1 | grep -q '"17\.'; then
  echo "JDK 17 required on PATH (JAVA_HOME=${JAVA_HOME:-unset})." >&2
  exit 1
fi
if [[ ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "Android SDK not found at $ANDROID_HOME (set ANDROID_HOME)." >&2
  exit 1
fi

# shellcheck source=scripts/phone-signing-env.sh
. "$ROOT/scripts/phone-signing-env.sh"
milewage_signing_env

cd "$ROOT"
npm ci
cd apps/phone
npx expo prebuild --platform android --no-install --clean
printf 'sdk.dir=%s\n' "$ANDROID_HOME" >android/local.properties
cd android
./gradlew --no-daemon assembleRelease :comma-tracker:testDebugUnitTest :qr-scanner:testDebugUnitTest :net-check:testDebugUnitTest ${gradle_args[@]+"${gradle_args[@]}"}
ls -l app/build/outputs/apk/release/*.apk
if [[ -n "$publish" ]]; then
  "$ROOT/scripts/publish-apk.sh" app/build/outputs/apk/release/app-release.apk "$publish"
fi
