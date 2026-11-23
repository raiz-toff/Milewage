#!/usr/bin/env bash
# Upgrade MileWage to the newest version of this checkout's branch (install guide: infra/docs/upgrade.md).
# Refuses, with the exact fix, when the checkout is not clean or has diverged, or when there is no recent backup.
# Order: checks, copy the newest backup out of the stack, git pull --ff-only, rebuild, wait healthy, print the version.
# Safe to run again: with nothing new to pull it changes nothing.
#
# Usage: infra/upgrade.sh [--env-file PATH]
#   --env-file PATH  the .env the stack was installed with (default: infra/docker/.env)
# Environment: MILEWAGE_BACKUP_MAX_AGE_H (default 36) how old the newest backup may be;
#              MILEWAGE_BACKUP_COPY_DIR (default infra/docker/backups-before-upgrade) where the copy goes.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/lib.sh
. "$here/lib.sh"
repo="$(cd "$here/.." && pwd)"
env_file="$here/docker/.env"

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file="${2:?--env-file needs a path}"; shift 2 ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

mw_check_host || exit 1
mw_check_docker || exit 1
command -v git >/dev/null 2>&1 || { mw_fail "git is not installed. On Ubuntu or Debian: sudo apt-get install git, then run this again."; exit 1; }
command -v curl >/dev/null 2>&1 || { mw_fail "curl is not installed. On Ubuntu or Debian: sudo apt-get install curl, then run this again."; exit 1; }
if [ ! -f "$env_file" ]; then
  mw_fail "There is no $env_file, so there is nothing to upgrade. Install first: infra/install.sh"
  exit 1
fi

git_r() { git -C "$repo" "$@"; }
if ! git_r rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mw_fail "$repo is not a git checkout, so it cannot be pulled. Clone it again with git, or unpack the newer release over it by hand."
  exit 1
fi
if [ -n "$(git_r status --porcelain --untracked-files=no)" ]; then
  mw_fail "This checkout has changes of its own, so pulling could clash with them. See them: git status"
  mw_fail "Then either undo them (git checkout -- <file>) or keep them aside (git stash), and run this again."
  exit 1
fi
if ! upstream="$(git_r rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  mw_fail "This branch does not follow a remote branch. Set it, then run this again:"
  mw_fail "  git branch --set-upstream-to=origin/main"
  exit 1
fi
if ! git_r fetch --quiet; then
  mw_fail "Could not reach the remote to look for a new version. Check this host's internet connection (git fetch), then run this again."
  exit 1
fi
ahead="$(git_r rev-list --count '@{u}..HEAD')"
behind="$(git_r rev-list --count 'HEAD..@{u}')"
if [ "$ahead" != 0 ]; then
  mw_fail "This checkout has $ahead commit(s) that $upstream does not have, so it cannot be moved forward cleanly."
  mw_fail "Keep them on a branch (git branch my-changes) and go back to the published version: git reset --hard $upstream"
  mw_fail "Then run this again."
  exit 1
fi

old_version="$(cat "$repo/VERSION" 2>/dev/null || echo unknown)"
compose=(docker compose --env-file "$env_file" -f "$here/docker/docker-compose.yml")
port="$(mw_env_get "$env_file" MILEWAGE_HOST_PORT)"
port="${port:-8080}"

if [ "$behind" = 0 ]; then
  echo "Already on the newest version ($old_version). Nothing to upgrade."
  echo "If something is wrong with the running stack: infra/doctor.sh"
  exit 0
fi

# A backup first. The server writes them nightly and after every shift; the newest one is copied out of the
# backups volume to this host (it is encrypted, only the recovery key opens it). `run --no-deps` reads the
# volume whether or not the stack is running.
max_h="${MILEWAGE_BACKUP_MAX_AGE_H:-36}"
newest="$("${compose[@]}" run --rm --no-deps -T api sh -c 'ls -t /app/backups/*.db.gz.age 2>/dev/null | head -n 1' 2>/dev/null | head -n 1 | tr -d '\r' || true)"
backup_help="Make one: open MileWage in a browser, Backups page, \"Back up now\", then run this again."
if [ -z "$newest" ]; then
  mw_fail "There is no backup yet, and an upgrade changes the database. $backup_help"
  exit 1
fi
fresh="$("${compose[@]}" run --rm --no-deps -T api find "$newest" -mmin "-$((max_h * 60))" 2>/dev/null | head -n 1 | tr -d '\r' || true)"
if [ -z "$fresh" ]; then
  mw_fail "The newest backup ($(basename "$newest")) is more than $max_h hours old. $backup_help"
  exit 1
fi
copy_dir="${MILEWAGE_BACKUP_COPY_DIR:-$here/docker/backups-before-upgrade}"
mkdir -p "$copy_dir"
copy="$copy_dir/$(basename "$newest")"
if [ ! -s "$copy" ]; then
  (umask 077; "${compose[@]}" run --rm --no-deps -T api cat "$newest" >"$copy.part" 2>/dev/null) || true
  if [ ! -s "$copy.part" ]; then
    mw_fail "Could not copy the backup out of the stack, so nothing was changed. See: docker compose -f infra/docker/docker-compose.yml logs api"
    exit 1
  fi
  mv "$copy.part" "$copy"
fi
echo "Backup copied to $copy (encrypted; the recovery key opens it). Keep a copy on another machine too."

echo "Upgrading from $old_version: git pull --ff-only"
if ! git_r pull --ff-only --quiet; then
  mw_fail "git pull did not go through. Nothing was rebuilt. Look at: git status"
  exit 1
fi
new_version="$(cat "$repo/VERSION" 2>/dev/null || echo unknown)"

echo "Rebuilding and restarting (a few minutes)..."
if ! "${compose[@]}" up -d --build --remove-orphans --wait --wait-timeout 300; then
  mw_fail "The new version did not become healthy. See: docker compose -f infra/docker/docker-compose.yml logs api"
  mw_fail "Your data is safe: the server keeps it, and made its own pre-migration backup. To go back, see infra/docs/upgrade.md, \"Roll back\"."
  exit 1
fi
if ! curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null; then
  mw_fail "The stack is up but http://127.0.0.1:$port/healthz does not answer. Run: infra/doctor.sh"
  exit 1
fi

echo
echo "MileWage is now $new_version (was $old_version) and answers on port $port."
# Release notes: the "Version notes" sections of upgrade.md for every version after the old one up to the new.
notes=""
while read -r v; do
  [ "$v" != "$old_version" ] || continue
  if [ "$(printf '%s\n%s\n' "$old_version" "$v" | sort -V | head -n 1)" = "$old_version" ] &&
    [ "$(printf '%s\n%s\n' "$v" "$new_version" | sort -V | head -n 1)" = "$v" ]; then
    notes="$notes $v"
  fi
done < <(sed -n 's/^### \([0-9][0-9.]*\).*/\1/p' "$here/docs/upgrade.md" | sort -V)
if [ -n "$notes" ]; then
  echo "Read before you use it: infra/docs/upgrade.md, \"Version notes\" for:$notes"
  echo "(they say, for example, when the phone app must be installed again)."
fi
echo "Check everything: infra/doctor.sh"
