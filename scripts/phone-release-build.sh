#!/usr/bin/env bash
# Release APK build of the phone app, the native Android app in apps/android, on the owner's machine
# (JDK 17, Android SDK; ANDROID_HOME defaults to $HOME/android-sdk). Runs apps/android/build-release.sh,
# which runs the unit tests, lint and the manifest and dependency policy, then builds and signs.
# Output: apps/android/app/build/outputs/apk/release/app-release.apk, and milewage-<VERSION>.apk
# beside it, the file attached to the GitHub release.
# Signing: with the upload key when $HOME/.milewage/keystore.env (or MILEWAGE_KEYSTORE_ENV) exists
# (made once by scripts/phone-keystore.sh; see scripts/phone-signing-env.sh), else the Android debug key.
# versionCode: MILEWAGE_VERSION_CODE (a whole number; default in apps/android/app/build.gradle.kts).
# Raise it for every build handed out. versionName comes from the VERSION file.
# --publish PATH (or MILEWAGE_APK_PUBLISH=PATH): then copy it to PATH, where the server hands it out
# (scripts/publish-apk.sh; e.g. .dev/config/milewage.apk for `npm run dev`). Other arguments go to Gradle.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/apps/android/build-release.sh" "$@"
