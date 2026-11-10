#!/usr/bin/env bash
# Creates the phone app's upload keystore (Google Play App Signing: Play re-signs with its own app
# signing key; this key only proves an upload came from you). Run it ONCE, on the build machine.
#   scripts/phone-keystore.sh [--out PATH] [--dname "CN=..., O=..."]
# Writes the keystore to --out (default $HOME/.milewage/upload.keystore, never inside the repository)
# and $HOME/.milewage/keystore.env (or MILEWAGE_KEYSTORE_ENV), which scripts/phone-release-build.sh
# (through scripts/phone-signing-env.sh) reads. Refuses to overwrite either file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
out="$HOME/.milewage/upload.keystore"
env_file="${MILEWAGE_KEYSTORE_ENV:-$HOME/.milewage/keystore.env}"
dname="CN=MileWage, O=MileWage"
alias_name="milewage-upload"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="${2:?--out needs a path}"; shift 2 ;;
    --dname) dname="${2:?--dname needs a value}"; shift 2 ;;
    -h | --help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v keytool >/dev/null 2>&1 || { echo "keytool not found (install JDK 17)." >&2; exit 1; }

# Absolute, symlink-free paths, so the repository check below compares like with like.
abs() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
out="$(abs "$out")"
env_file="$(abs "$env_file")"
for f in "$out" "$env_file"; do
  dir="$(dirname "$f")"
  case "$dir/" in
    "$ROOT"/*) echo "Refusing to write $f inside the repository: keep the key out of git." >&2; exit 1 ;;
  esac
  mkdir -p -m 700 "$dir"
  case "$(cd "$dir" && pwd -P)/" in
    "$ROOT"/*) echo "Refusing to write $f inside the repository: keep the key out of git." >&2; exit 1 ;;
  esac
  if [ -e "$f" ]; then
    echo "Refusing to overwrite $f: it already exists. A second upload key is not a backup." >&2
    exit 1
  fi
done

# PKCS12 (keytool's default) has one password for the store and the key, so both variables hold it.
password="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
[ "${#password}" -ge 24 ] || { echo "Could not make a random password." >&2; exit 1; }

umask 077
if ! keytool -genkeypair -noprompt \
  -storetype PKCS12 -keystore "$out" -storepass "$password" -keypass "$password" \
  -alias "$alias_name" -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "$dname" >/dev/null 2>&1; then
  rm -f "$out"
  echo "keytool failed to create the keystore." >&2
  exit 1
fi
chmod 600 "$out"

cat >"$env_file" <<ENV
# MileWage upload key, made by scripts/phone-keystore.sh on $(date -u +%Y-%m-%d).
MILEWAGE_KEYSTORE_PATH='$out'
MILEWAGE_KEYSTORE_PASSWORD='$password'
MILEWAGE_KEY_ALIAS='$alias_name'
MILEWAGE_KEY_PASSWORD='$password'
ENV
chmod 600 "$env_file"

cat <<MSG
Upload keystore created.
  Keystore:  $out
  Settings:  $env_file (mode 600)
  Alias:     $alias_name
  Password:  $password   (store and key; shown only this once)

!!! BACK THIS UP NOW !!!
Put the keystore file and the password in your password manager (or another safe place off this
machine). Losing it means a new app identity on Google Play: you can no longer update the app
people already have until Google agrees to reset the upload key.
MSG
