#!/usr/bin/env bash
# Builds the stack, starts it on a throwaway loopback port and checks /healthz through Caddy.
# Self-checking: exits 0 only if every check passed; exits 2 (skipped) when Docker is missing.
# Usage: infra/docker/smoke.sh
set -euo pipefail

cd "$(dirname "$0")"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "SKIP: docker is not available; the smoke check did not run" >&2
  exit 2
fi

export MILEWAGE_HOST_PORT="${MILEWAGE_HOST_PORT:-18080}"
project="milewage-smoke"
compose=(docker compose -p "$project" -f docker-compose.yml)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; "${compose[@]}" logs --tail=40 >&2 || true; exit 1; }

"${compose[@]}" up -d --build --wait --wait-timeout 120 || fail "stack did not become healthy"

base="http://127.0.0.1:${MILEWAGE_HOST_PORT}"
body="$(curl -fsS "$base/healthz")" || fail "/healthz unreachable through Caddy"
[ "$body" = '{"ok":true}' ] || fail "/healthz returned: $body"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/nope")" = "404" ] || fail "unknown path is not 404"
curl -fsS "$base/api/v1/setup/status" >/dev/null || fail "/api/v1/setup/status unreachable"

published="$(docker port "${project}-caddy-1" 8080/tcp)"
case "$published" in
  127.0.0.1:*) ;;
  *) fail "Caddy is published on $published, expected loopback only" ;;
esac
[ -z "$(docker port "${project}-api-1")" ] || fail "the api container publishes a port"

echo "OK: /healthz reached through Caddy on 127.0.0.1:${MILEWAGE_HOST_PORT}"
