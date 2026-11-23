// A pretend host for the shell-script tests (install.sh, upgrade.sh, doctor.sh): a bin folder that is the
// whole PATH, holding the few real tools the scripts use and stubs for docker, curl, uname, df and tailscale,
// so the machine the tests run on is never touched. Not a test file.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REAL_TOOLS = [
  'sed',
  'grep',
  'head',
  'tail',
  'seq',
  'sleep',
  'mkdir',
  'cat',
  'dirname',
  'basename',
  'tr',
  'sort',
  'date',
  'mv',
  'git',
];

/**
 * The PATH value for a fake bin folder: the folder alone. In Git Bash on Windows (no symlinks) the shell's own
 * tools follow it, so the stubs still come first.
 */
function pathFor(bin) {
  if (process.platform !== 'win32') return bin;
  const dirs = spawnSync('bash', ['-c', 'cygpath -w /usr/bin "$(dirname "$(command -v git)")"'], {
    encoding: 'utf8',
  }).stdout.split(String.fromCharCode(10));
  return [bin, ...dirs.map((d) => d.trim()).filter(Boolean)].join(';');
}

const link = (real, to) => {
  try {
    symlinkSync(real, to);
  } catch {
    try {
      copyFileSync(real, to); // no symlinks without privileges on Windows
    } catch {
      // these tests need Linux: there the symlink above works
    }
  }
};

/**
 * @param {string} dir  a fresh folder of the test; `<dir>/bin` becomes the PATH
 * @param {object} o
 * @param {string} [o.os] `uname -s`
 * @param {string} [o.arch] `uname -m`
 * @param {string} [o.kernel] `uname -r`
 * @param {number} [o.freeKb] free space `df` reports
 * @param {'ok'|'permission'|'down'|'missing'} [o.docker] how the docker stub behaves
 * @param {boolean} [o.compose] `docker compose version` works
 * @param {boolean} [o.curl] a curl stub exists (when false, curl is missing)
 * @param {string} [o.ps] what `docker compose ps` prints
 * @param {string|null} [o.backup] path the newest backup has in the volume, or null for none
 * @param {boolean} [o.backupFresh] whether `find -mmin` says it is recent
 * @param {number} [o.dateOffsetS] seconds the server's Date header is ahead of this host
 * @param {boolean} [o.healthy] whether /healthz answers
 */
export function fakeBin(dir, o = {}) {
  const {
    os = 'Linux',
    arch = 'x86_64',
    kernel = '6.1.0-generic',
    freeKb = 50_000_000,
    docker = 'ok',
    compose = true,
    curl = true,
    ps = '',
    backup = null,
    backupFresh = true,
    dateOffsetS = 0,
    healthy = true,
  } = o;
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const tool of REAL_TOOLS) {
    const real = spawnSync('bash', ['-c', `command -v ${tool}`], {
      encoding: 'utf8',
    }).stdout.trim();
    if (real) link(real, join(bin, tool));
  }
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "$*" >>"${dir}/${name}.log"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake(
    'uname',
    `case "$1" in -s) echo '${os}' ;; -m) echo '${arch}' ;; -r) echo '${kernel}' ;; esac`,
  );
  fake(
    'df',
    `echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'; echo '/dev/x 100000000 1 ${freeKb} 1% /'`,
  );
  if (docker !== 'missing') {
    const info = {
      ok: 'exit 0',
      permission:
        'echo "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock" >&2; exit 1',
      down: 'echo "Cannot connect to the Docker daemon. Is the docker daemon running?" >&2; exit 1',
    }[docker];
    writeFileSync(join(dir, 'ps.txt'), ps);
    fake(
      'docker',
      `case "$1" in
  info) ${info} ;;
  compose)
    shift
    while [ "$1" = --env-file ] || [ "$1" = -f ]; do shift 2; done
    case "$1" in
      version) ${compose ? 'exit 0' : 'exit 1'} ;;
      ps) cat "${dir}/ps.txt" ;;
      run)
        case "$*" in
          *"ls -t"*) ${backup ? `echo '${backup}'` : 'true'} ;;
          *find*) ${backup && backupFresh ? `echo '${backup}'` : 'true'} ;;
          *" cat "*) printf 'encrypted-backup-bytes' ;;
        esac ;;
      up) [ -f "${dir}/up.fails" ] && exit 1; exit 0 ;;
    esac ;;
esac
exit 0`,
    );
  }
  if (curl) {
    const date = `date -u -d "@$(( $(date +%s) + (${dateOffsetS}) ))" '+%a, %d %b %Y %H:%M:%S GMT'`;
    fake(
      'curl',
      healthy
        ? `case "$*" in *" -fsSI "*|*-fsSI*) echo "HTTP/1.1 200 OK"; echo "Date: $(${date})" ;; *) echo '{"ok":true}' ;; esac`
        : 'exit 22',
    );
  }
  return { bin: pathFor(bin), fake };
}

/** Runs a script with the fake host as the whole PATH. */
export function runScript(script, args, { bin, env = {}, input = '' }) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    input,
    env: { PATH: bin, MILEWAGE_INSTALL_RETRY_S: '0', ...env },
  });
}
