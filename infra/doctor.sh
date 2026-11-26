#!/usr/bin/env bash
# Checks a MileWage install and says what to do about each problem (install guide: infra/docs/install.md).
# One line per check: [ok], [warn] or [FAIL]; then the next step. Exit code 1 when anything failed.
# Changes nothing, and prints no secret: it reads only the port and the addresses from the .env, never the file as a whole.
# Works when the stack is down: it says so and gives the command to start it.
#
# Usage: infra/doctor.sh [--env-file PATH]
#   --env-file PATH  the .env the stack was installed with (default: infra/docker/.env)
# Environment: MILEWAGE_MIN_DISK_MB (default 1024), MILEWAGE_BACKUP_MAX_AGE_H (default 36), MILEWAGE_MAX_CLOCK_SKEW_S (default 120).
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/lib.sh
. "$here/lib.sh"
env_file="$here/docker/.env"
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file="${2:?--env-file needs a path}"; shift 2 ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

failed=0
next=""
ok() { printf '[ok]   %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*"; }
bad() { # message, next step
  printf '[FAIL] %s\n' "$1"
  failed=1
  [ -n "$next" ] || next="$2"
}

echo "MileWage check ($(cat "$here/../VERSION" 2>/dev/null || echo unknown))"

if ! mw_check_host 2>/dev/null; then
  bad "This system is not Linux or WSL2 on a 64-bit CPU." "Run MileWage on Linux, or inside WSL2 on Windows (see infra/docs/install.md)."
fi

# Docker
docker_ok=0
if ! command -v docker >/dev/null 2>&1; then
  bad "Docker is not installed." "Install Docker Engine (https://docs.docker.com/engine/install/), then run infra/install.sh."
elif ! derr="$(docker info 2>&1 >/dev/null)"; then
  if [[ "${derr,,}" == *"permission denied"* ]]; then
    bad "Docker is running but this user may not use it." "sudo usermod -aG docker \"\$USER\", then sign out and in again."
  else
    bad "Docker does not answer." "sudo systemctl start docker (on WSL2 with Docker Desktop: start Docker Desktop)."
  fi
elif ! docker compose version >/dev/null 2>&1; then
  bad "Docker Compose v2 is missing." "sudo apt-get install docker-compose-plugin"
else
  ok "Docker answers"
  docker_ok=1
fi

if [ ! -f "$env_file" ]; then
  bad "There is no $env_file: MileWage was not installed here." "Run infra/install.sh"
  echo
  echo "Next step: $next"
  exit 1
fi
port="$(mw_env_get "$env_file" MILEWAGE_HOST_PORT)"
port="${port:-8080}"
public_url="$(mw_env_get "$env_file" MILEWAGE_PUBLIC_URL)"
home_url="$(mw_env_get "$env_file" MILEWAGE_HOME_URL)"
compose=(docker compose --env-file "$env_file" -f "$here/docker/docker-compose.yml")
start_cmd="docker compose --env-file $env_file -f $here/docker/docker-compose.yml up -d"

# Containers
up=0
if [ "$docker_ok" = 1 ]; then
  states="$("${compose[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
  running=0
  for svc in api caddy; do
    line="$(printf '%s\n' "$states" | grep "^$svc " | head -n 1 || true)"
    case "$line" in
      "$svc running"*unhealthy*) bad "The $svc container is running but unhealthy." "docker compose --env-file $env_file -f $here/docker/docker-compose.yml logs $svc" ;;
      "$svc running"*) ok "The $svc container is running"; running=$((running + 1)) ;;
      *) bad "The $svc container is not running." "$start_cmd" ;;
    esac
  done
  [ "$running" = 2 ] && up=1
  if [ "$running" = 0 ]; then
    echo "       The stack is down. Start it with: $start_cmd"
  fi
fi

# HTTP
body=""
if [ "$up" = 1 ] && command -v curl >/dev/null 2>&1; then
  base="http://127.0.0.1:$port"
  body="$(curl -fsS --max-time 5 "$base/healthz" 2>/dev/null || true)"
  if [ "$body" = '{"ok":true}' ]; then
    ok "The server answers at $base/healthz"
  else
    bad "The server does not answer at $base/healthz." "docker compose --env-file $env_file -f $here/docker/docker-compose.yml logs api"
  fi
  for pair in "public:$public_url" "home network:$home_url"; do
    label="${pair%%:*}"
    u="${pair#*:}"
    if [ -z "$u" ]; then
      echo "       The $label address is not set (that is fine if you do not use it)."
    elif curl -fsS --max-time 8 "$u/healthz" >/dev/null 2>&1; then
      ok "The $label address answers: $u"
    elif [ "$label" = public ]; then
      bad "The public address does not answer: $u" "tailscale serve status  (it should proxy to port $port; if not: tailscale serve --bg $port)"
    else
      bad "The home network address does not answer: $u" "Check that this host still has that address (ip addr), then: infra/install.sh --lan"
    fi
  done
  # Clock: the host's against the server's (the Date header). A phone or a backup with a wrong clock misleads.
  if [ -n "$body" ]; then
    hdr="$(curl -fsSI --max-time 5 "$base/healthz" 2>/dev/null | sed -n 's/^[Dd]ate: *//p' | head -n 1 | tr -d '\r' || true)"
    server_t=""
    [ -n "$hdr" ] && server_t="$(date -d "$hdr" +%s 2>/dev/null || true)"
    if [ -n "$server_t" ]; then
      skew=$(($(date +%s) - server_t))
      skew=${skew#-}
      if [ "$skew" -le "${MILEWAGE_MAX_CLOCK_SKEW_S:-120}" ]; then
        ok "The clocks agree (${skew}s apart)"
      else
        bad "This host's clock and the server's are ${skew}s apart." "sudo timedatectl set-ntp true  (then check the time with: date)"
      fi
    else
      warn "Could not read the server's time, so the clock check was skipped."
    fi
  fi
fi

# Disk
min_mb="${MILEWAGE_MIN_DISK_MB:-1024}"
if free_mb="$(mw_free_mb "$here")"; then
  if [ "$free_mb" -ge "$min_mb" ]; then
    ok "Disk space: $free_mb MB free"
  else
    bad "Only $free_mb MB of disk are free (less than $min_mb MB)." "Free space: 'docker system df' shows what Docker uses; then check the Backups page."
  fi
else
  warn "Could not read the free disk space."
fi

# Last backup (read from the backups volume; works with the stack stopped, if the image is built)
if [ "$docker_ok" = 1 ]; then
  max_h="${MILEWAGE_BACKUP_MAX_AGE_H:-36}"
  newest="$("${compose[@]}" run --rm --no-deps -T api sh -c 'ls -t /app/backups/*.db.gz.age 2>/dev/null | head -n 1' 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  if [ -z "$newest" ]; then
    if [ "$up" = 1 ]; then
      bad "There is no backup yet." "Open MileWage, Backups page, \"Back up now\"."
    else
      warn "Could not look for backups (the stack is down or not built)."
    fi
  elif [ -n "$("${compose[@]}" run --rm --no-deps -T api find "$newest" -mmin "-$((max_h * 60))" 2>/dev/null | head -n 1 || true)" ]; then
    ok "The newest backup is under $max_h hours old"
  else
    bad "The newest backup is more than $max_h hours old." "Open MileWage, Backups page, \"Back up now\"; if it fails: docker compose --env-file $env_file -f $here/docker/docker-compose.yml logs api"
  fi
fi

# Tailscale (optional)
if command -v tailscale >/dev/null 2>&1; then
  serve="$(tailscale serve status 2>&1 || true)"
  case "$serve" in
    *"$port"*) ok "Tailscale serves this port" ;;
    *)
      if [ -n "$public_url" ]; then
        bad "Tailscale is not serving port $port, but the public address is $public_url." "tailscale serve --bg $port  (if it says port 443 is taken: tailscale serve status; undo with tailscale serve --https=443 off)"
      else
        echo "       Tailscale is installed and not serving MileWage (optional: tailscale serve --bg $port)."
      fi
      ;;
  esac
else
  echo "       Tailscale is not installed (optional; needed only to reach MileWage away from home)."
fi

echo
if [ "$failed" = 0 ]; then
  echo "Everything checked is fine."
  exit 0
fi
echo "Next step: $next"
exit 1
