#!/usr/bin/env bash
# Puts a built phone app where the server hands it out (plan 24 Q2, infra/docs/install.md section 3a),
# with a small `<destination>.json` beside it: the app's version (the VERSION file, which the
# Android build reads as versionName) and its build time. The server reads both on every request, so
# the new file is offered without a restart.
# Usage: scripts/publish-apk.sh <app-release.apk> <destination, e.g. .dev/config/milewage.apk>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${1:?Usage: scripts/publish-apk.sh <app.apk> <destination>}"
dest="${2:?Usage: scripts/publish-apk.sh <app.apk> <destination>}"
[ -f "$src" ] || { echo "No app file at $src" >&2; exit 1; }

version="$(tr -d ' \n' <"$ROOT/VERSION")"
built="$(date -u -r "$src" +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$(dirname "$dest")"
# Copy then rename, so a phone downloading at that moment never gets half a file.
cp "$src" "$dest.part"
mv -f "$dest.part" "$dest"
printf '{ "version": "%s", "built_at": "%s" }\n' "$version" "$built" >"$dest.json.part"
mv -f "$dest.json.part" "$dest.json"
echo "Published $dest (version ${version:-unknown}, built $built)."
