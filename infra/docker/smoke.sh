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

"${compose[@]}" exec -T api test -f /app/diagnostics-migrations/diagnostics/0001_events.sql \
  || fail "diagnostics migrations are missing from the image"

# Trusted proxy (08 section 7.4): the API trusts X-Forwarded-For only from the compose network (a /24).
subnet="${MILEWAGE_PROXY_SUBNET:-172.29.88.0/24}"
prefix="${subnet%.*/24}."
[ "$("${compose[@]}" exec -T api printenv MILEWAGE_TRUST_PROXY)" = "$subnet" ] \
  || fail "MILEWAGE_TRUST_PROXY is not $subnet in the api container"
for svc in caddy api; do
  ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${project}-${svc}-1")"
  case "$ip" in "$prefix"*) ;; *) fail "$svc ($ip) is not inside the trusted subnet $subnet" ;; esac
done
# A request from inside the container (127.0.0.1, not trusted) cannot choose its own client address:
# eleven failed redeems with eleven different X-Forwarded-For values still share one limit bucket.
last="$("${compose[@]}" exec -T api node -e '
const go = async (i) => (await fetch("http://127.0.0.1:3000/api/v1/pairing/redeem", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113." + i },
  body: JSON.stringify({ token: "mwp_" + "x".repeat(43), device_name: "p", platform: "android" }),
})).status;
(async () => { let s; for (let i = 1; i <= 11; i++) s = await go(i); console.log(s); })();
')"
[ "$last" = "429" ] || fail "a spoofed X-Forwarded-For from an untrusted address was believed (got $last, want 429)"

echo "OK: /healthz reached through Caddy on 127.0.0.1:${MILEWAGE_HOST_PORT}"
