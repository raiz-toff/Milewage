#!/usr/bin/env bash
# Release APK build of the phone app on the `coder` machine (Node 22.22, JDK 17, Android SDK).
# Output: apps/phone/android/app/build/outputs/apk/release/app-release.apk
# The APK is signed with the Expo template's debug key; the signed pipeline is M10.3.
set -euo pipefail

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

cd "$ROOT"
npm ci
cd apps/phone
npx expo prebuild --platform android --no-install --clean
printf 'sdk.dir=%s\n' "$ANDROID_HOME" >android/local.properties
cd android
./gradlew --no-daemon assembleRelease "$@"
ls -l app/build/outputs/apk/release/*.apk
