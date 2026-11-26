# shellcheck shell=bash
# Shared by infra/install.sh, infra/upgrade.sh and infra/doctor.sh. Sourced, never run.
# Only bash builtins and sed/head/df/uname are used, so it works on Linux and WSL2 alike. Every check that
# fails prints what is wrong and the next command to run, and returns 1.

mw_fail() { printf '%s\n' "$*" >&2; }

# The value of KEY in an env file (first match; surrounding double quotes removed). Never sources the file.
mw_env_get() {
  [ -f "$1" ] || return 0
  local v
  v="$(sed -n "s/^$2=//p" "$1" | head -n 1)"
  v="${v%\"}"
  v="${v#\"}"
  printf '%s' "$v"
}

# Sets KEY=VALUE in an env file: replaces the line or appends one. No `sed -i` (differs between GNU and BSD),
# and the file is rewritten in place, so its owner-only mode stays.
mw_set_env() {
  local file="$1" key="$2" value="$3" out="" line found=0
  if [ -f "$file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        "$key="*) out+="$key=$value"$'\n'; found=1 ;;
        *) out+="$line"$'\n' ;;
      esac
    done <"$file"
  fi
  [ "$found" = 1 ] || out+="$key=$value"$'\n'
  printf '%s' "$out" >"$file"
}

# Free space, in MB, of the file system that holds the directory $1. Fails when df cannot say.
mw_free_mb() {
  local line avail
  line="$(df -Pk "$1" 2>/dev/null | sed -n '2p')" || return 1
  [ -n "$line" ] || return 1
  read -r _ _ _ avail _ <<<"$line"
  case "$avail" in '' | *[!0-9]*) return 1 ;; esac
  echo $((avail / 1024))
}

# Linux or WSL2, on a 64-bit CPU.
mw_check_host() {
  local os arch kernel
  os="$(uname -s 2>/dev/null || echo unknown)"
  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "$os" in
    Linux)
      kernel="$(uname -r 2>/dev/null || true)"
      case "$kernel" in
        *WSL2* | *microsoft-standard*) ;;
        *[Mm]icrosoft*)
          mw_fail "This is WSL 1, which cannot run Docker. Convert this distribution to WSL 2, in a Windows PowerShell:"
          mw_fail "  wsl --set-version <your distribution> 2"
          mw_fail "Then open it again and run this script again."
          return 1
          ;;
      esac
      ;;
    MINGW* | MSYS* | CYGWIN*)
      mw_fail "This script does not run in Git Bash or on native Windows. Use WSL2 (Ubuntu): in a Windows PowerShell run"
      mw_fail "  wsl --install"
      mw_fail "then open Ubuntu from the Start menu, clone MileWage there and run this script again."
      return 1
      ;;
    Darwin)
      mw_fail "macOS is not supported. Run MileWage on a Linux machine (a home server or a Raspberry Pi), or on Windows inside WSL2."
      return 1
      ;;
    *)
      mw_fail "Unsupported system: $os. MileWage's scripts run on Linux, or on Windows inside WSL2."
      return 1
      ;;
  esac
  case "$arch" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *)
      mw_fail "This computer's CPU ($arch) is not 64-bit, so the MileWage images cannot run on it."
      mw_fail "On a Raspberry Pi, install the 64-bit version of Raspberry Pi OS, then run this script again."
      return 1
      ;;
  esac
}

# Docker installed, its service reachable by this user, compose v2.
mw_check_docker() {
  local err
  if ! command -v docker >/dev/null 2>&1; then
    mw_fail "Docker is not installed. Install Docker Engine: https://docs.docker.com/engine/install/ ."
    mw_fail "On Windows with WSL2, either install it inside Ubuntu the same way, or turn on WSL integration in Docker Desktop."
    mw_fail "Then run this script again."
    return 1
  fi
  if ! err="$(docker info 2>&1 >/dev/null)"; then
    if [[ "${err,,}" == *"permission denied"* ]]; then
      mw_fail "Docker is running, but this user is not allowed to use it. Run:"
      mw_fail "  sudo usermod -aG docker \"\$USER\""
      mw_fail "then sign out and in again (in WSL2: run 'wsl --shutdown' in Windows PowerShell and open Ubuntu again), and run this script again."
    else
      mw_fail "Docker is installed but its service does not answer. Start it:"
      mw_fail "  sudo systemctl start docker"
      mw_fail "(on WSL2 with Docker Desktop: start Docker Desktop on Windows). Then run this script again."
    fi
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    mw_fail "Docker Compose v2 is not installed ('docker compose version' fails). On Ubuntu or Debian:"
    mw_fail "  sudo apt-get install docker-compose-plugin"
    mw_fail "(other systems: https://docs.docker.com/compose/install/linux/). Then run this script again."
    return 1
  fi
}

# This host's address on the home network, or nothing. MILEWAGE_LAN_IP overrides the detection. Only a private
# IPv4 address counts, and not Docker's (172.17.x, bridges, veth) or a VPN's (tun, tap, wg, tailscale) interfaces.
mw_lan_ok() { # address interface
  case "$1" in
    172.17.*) return 1 ;;
    10.* | 192.168.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) ;;
    *) return 1 ;;
  esac
  case "$2" in
    docker* | br-* | veth* | virbr* | tun* | tap* | wg* | tailscale* | ts[0-9]* | zt* | ppp* | utun* | vboxnet* | lxc* | cni* | flannel*) return 1 ;;
  esac
  return 0
}
mw_lan_ip() {
  if [ -n "${MILEWAGE_LAN_IP:-}" ]; then
    case "$MILEWAGE_LAN_IP" in
      10.* | 192.168.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) echo "$MILEWAGE_LAN_IP" ;;
    esac
    return 0
  fi
  local line dev addr _i _f _r
  if command -v ip >/dev/null 2>&1; then
    line="$(ip -4 route get 1.1.1.1 2>/dev/null | head -n 1 || true)"
    dev="$(printf '%s' "$line" | sed -n 's/.* dev \([^ ]*\).*/\1/p')"
    addr="$(printf '%s' "$line" | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
    if [ -n "$addr" ] && mw_lan_ok "$addr" "$dev"; then
      echo "$addr"
      return 0
    fi
    # The default route goes through Docker or a VPN: take the first usable address of any interface.
    while read -r _i dev _f addr _r; do
      addr="${addr%/*}"
      if mw_lan_ok "$addr" "$dev"; then
        echo "$addr"
        return 0
      fi
    done < <(ip -4 -o addr show scope global 2>/dev/null || true)
  fi
  if command -v hostname >/dev/null 2>&1; then
    for addr in $(hostname -I 2>/dev/null || true); do
      if mw_lan_ok "$addr" ""; then
        echo "$addr"
        return 0
      fi
    done
  fi
  return 0
}
