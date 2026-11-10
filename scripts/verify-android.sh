#!/usr/bin/env bash
# The Android half of `npm run verify` (npm run verify:android): the unit tests of every module of
# apps/android, Android lint, and the manifest and dependency policy check for both variants (no
# Google Play Services, no Firebase, no permission outside policyPermissions in app/build.gradle.kts).
# Needs JDK 17 and the Android SDK (ANDROID_HOME, default $HOME/android-sdk); stops with the fix
# when either is missing. Extra arguments are added to the Gradle tasks (CI adds assembleDebug).
#   scripts/verify-android.sh --only <task...>   runs only the tasks given (npm run crosscheck:engine)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

tasks=(test lint :app:checkDebugPolicy :app:checkReleasePolicy)
if [[ "${1:-}" == "--only" ]]; then
  shift
  tasks=()
fi
tasks+=("$@")
[[ ${#tasks[@]} -gt 0 ]] || { echo "--only needs at least one Gradle task." >&2; exit 2; }

if ! command -v java >/dev/null 2>&1; then
  echo "verify:android needs JDK 17: no java on PATH. Install a JDK 17 and put its bin first on PATH." >&2
  exit 1
fi
if ! java -version 2>&1 | grep -q '"17\.'; then
  echo "verify:android needs JDK 17; java on PATH is:" >&2
  java -version 2>&1 | head -1 >&2
  echo "Put a JDK 17 bin first on PATH (JAVA_HOME=${JAVA_HOME:-unset})." >&2
  exit 1
fi
if [[ ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "verify:android needs the Android SDK: none at $ANDROID_HOME. Set ANDROID_HOME to it." >&2
  exit 1
fi

cd "$ROOT/apps/android"
echo "Gradle: ${tasks[*]}"
./gradlew "${tasks[@]}"
