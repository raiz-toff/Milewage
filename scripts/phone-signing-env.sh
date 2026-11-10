# Sourced by apps/android/build-release.sh (which scripts/phone-release-build.sh runs): picks the
# key the release APK is signed with. Reads MILEWAGE_KEYSTORE_ENV (default
# $HOME/.milewage/keystore.env, written by scripts/phone-keystore.sh) when it exists, then exports
# the four MILEWAGE_KEY* variables that the Gradle signing config (apps/android/app/build.gradle.kts)
# reads. Variables already set in the environment are used when there is no file.
# Without either, the release APK is signed with the Android debug key.

milewage_signing_env() {
  local file="${MILEWAGE_KEYSTORE_ENV:-$HOME/.milewage/keystore.env}"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck source=/dev/null
    . "$file"
    set +a
  elif [[ -n "${MILEWAGE_KEYSTORE_ENV:-}" ]]; then
    echo "MILEWAGE_KEYSTORE_ENV points at $file, which does not exist." >&2
    return 1
  fi
  if [[ -z "${MILEWAGE_KEYSTORE_PATH:-}" ]]; then
    echo "Signing with the Android DEBUG key: no upload key ($file not found). Not for Google Play."
    return 0
  fi
  local v
  for v in MILEWAGE_KEYSTORE_PASSWORD MILEWAGE_KEY_ALIAS MILEWAGE_KEY_PASSWORD; do
    if [[ -z "${!v:-}" ]]; then
      echo "$v is not set (from $file); the upload key cannot be used." >&2
      return 1
    fi
  done
  if [[ ! -f "$MILEWAGE_KEYSTORE_PATH" ]]; then
    echo "Keystore $MILEWAGE_KEYSTORE_PATH not found (from $file)." >&2
    return 1
  fi
  export MILEWAGE_KEYSTORE_PATH MILEWAGE_KEYSTORE_PASSWORD MILEWAGE_KEY_ALIAS MILEWAGE_KEY_PASSWORD
  echo "Signing with the upload key $MILEWAGE_KEYSTORE_PATH (alias $MILEWAGE_KEY_ALIAS)."
}
